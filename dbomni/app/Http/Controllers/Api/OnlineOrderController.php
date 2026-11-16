<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\MembershipTier;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\Promotion;
use App\Models\Setting;
use App\Models\Voucher;
use App\Models\VoucherUsage;
use App\Services\InventoryService;
use App\Services\LoyaltyService;
use App\Services\NdamapsService;
use App\Services\PromotionService;
use App\Support\CancelReasonCodes;
use App\Support\CatalogCache;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

// Gói 6 (2026-10-05): API public cho Zalo Mini App đặt món.
// - Không cần đăng nhập: định danh KH bằng SĐT.
// - Đơn tạo ở trạng thái chờ xác nhận (chưa trừ kho, chưa tích điểm);
//   nhân viên xác nhận thanh toán -> trừ kho, vào KDS, in tem, tích điểm.
class OnlineOrderController extends Controller
{
    use \App\Traits\ValidatesEmployeeBranch;
    // Danh sách chi nhánh (kèm địa chỉ + tọa độ để tính ship)
    public function branches(): JsonResponse
    {
        // Bộ nhớ đệm thực đơn (spec 2026-11-05): chỉ đệm payload hiển thị
        // này; header X-Catalog-Cache để vòng đo nhìn thấy trạng thái đệm.
        [$data, $status] = CatalogCache::remember(
            CatalogCache::branchesKey(),
            CatalogCache::TTL,
            function () {
                // Gói 55 p1: thêm phone; p2: thêm opening_hours để Mini App hiện trạng thái mở cửa
                return Branch::select('id', 'name', 'address', 'phone', 'opening_hours', 'latitude', 'longitude')
                    ->get()->toArray();
            }
        );
        return response()->json(['success' => true, 'data' => $data])
            ->header('X-Catalog-Cache', $status);
    }

    // Thực đơn cho Mini App (ẩn món "Phí dịch vụ")
    public function menu(): JsonResponse
    {
        $menu = Category::where('is_active', true)
            ->orderBy('sort_order', 'asc')
            ->with(['products' => function ($query) {
                $query->where('is_active', true)->where('is_service_fee', false)->with(['options', 'prices.priceList', 'categoryPrices']);
            }])
            ->get();

        // Gói 49i: gắn giá kênh online cho Mini App
        $menu->each(function ($cat) {
            $cat->products->each(function ($p) {
                $p->setAppends(array_unique(array_merge($p->getAppends(), ['online_price'])));
            });
        });

        return response()->json(['success' => true, 'data' => $menu]);
    }

    // Gói 9: thông tin hiển thị trang chủ Mini App (cover + điểm thưởng giới thiệu)
    public function shopInfo(Request $request): JsonResponse
    {
        $branchId = (int) $request->query('branch_id', 0);
        // Bộ nhớ đệm thực đơn (spec 2026-11-05): cover lưu trong đệm ở
        // dạng GỐC như trong DB (có thể là đường dẫn tương đối) — bước
        // ghép host tuyệt đối (Gói 50b) tách ra ngoài phần được đệm và
        // chạy lại theo request sau khi lấy dữ liệu, kẻo đệm ghim host
        // của request đầu tiên (Admin/zma dùng chung API) vào mọi khách.
        [$data, $status] = CatalogCache::remember(
            CatalogCache::shopInfoKey($branchId),
            CatalogCache::TTL,
            function () use ($branchId) {
                // Gói 10f: ưu tiên cover riêng của chi nhánh, chưa có thì dùng cover chung
                $cover = Setting::get('shop_cover_url', '');
                if ($branchId > 0) {
                    $branchCover = Branch::where('id', $branchId)->value('cover_url');
                    if ($branchCover) $cover = $branchCover;
                }
                return [
                    'cover_url' => $cover,
                    // Gói Mini App 2026-10-30: cờ hiện mục Quét QR tích điểm ở trang Tài
                    // khoản — mặc định ẩn, Admin bật ở trang Zalo Mini App khi cần dùng.
                    'qr_claim_entry' => filter_var(Setting::get('miniapp_qr_claim_entry', '0'), FILTER_VALIDATE_BOOLEAN),
                ];
            }
        );
        // Gói 50b: chuẩn hóa thành URL tuyệt đối theo host thật (sửa dữ liệu cũ relative/localhost)
        if (!empty($data['cover_url']) && !preg_match('#^https?://#i', $data['cover_url'])) {
            $data['cover_url'] = $request->getSchemeAndHttpHost() . '/' . ltrim($data['cover_url'], '/');
        }
        return response()->json(['success' => true, 'data' => $data])
            ->header('X-Catalog-Cache', $status);
    }

    // Gói 9: món đang giảm giá (KM scope theo món/danh mục, áp dụng kênh online)
    public function saleProducts(): JsonResponse
    {
        // Bộ nhớ đệm thực đơn (spec 2026-11-05): chỉ đệm payload hiển thị
        // này; header X-Catalog-Cache để vòng đo nhìn thấy trạng thái đệm.
        [$data, $status] = CatalogCache::remember(
            CatalogCache::saleProductsKey(),
            CatalogCache::TTL,
            function () {
                $now = now();
                $promos = Promotion::where('is_active', true)
                    ->whereIn('scope', ['product', 'category', 'menu']) // Gói 10: thêm phạm vi Thực đơn
                    ->whereIn('type', ['percent', 'fixed_price'])
                    ->where(function ($q) use ($now) {
                        $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
                    })
                    ->where(function ($q) use ($now) {
                        $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now);
                    })
                    ->get()
                    ->filter(function ($p) {
                        $channels = $p->channels ?? [];
                        return empty($channels) || in_array('online', $channels);
                    });

                $best = []; // product_id => ['sale_price'=>x, 'promo_name'=>y]
                foreach ($promos as $promo) {
                    // Gói 10: resolve món theo phạm vi product/category/menu
                    $ids = match ($promo->scope) {
                        'product' => ($promo->scope_ids ?? []),
                        'category' => Product::whereIn('category_id', $promo->scope_ids ?? [])->pluck('id')->all(),
                        'menu' => \Illuminate\Support\Facades\DB::table('menu_product')
                            ->whereIn('menu_id', $promo->scope_ids ?? [])
                            ->distinct()->pluck('product_id')->all(),
                        default => [],
                    };
                    foreach ($ids as $pid) {
                        $product = Product::where('id', $pid)->where('is_active', true)
                            ->where('is_service_fee', false)->with(['prices.priceList', 'categoryPrices'])->first();
                        if (!$product) continue;
                        $base = $product->online_price;
                        $sale = $promo->type === 'percent'
                            ? $base * (1 - (float) $promo->value / 100)
                            : min($base, (float) $promo->value);
                        if ($sale < $base && (!isset($best[$pid]) || $sale < $best[$pid]['sale_price'])) {
                            $best[$pid] = [
                                'product' => $product,
                                'sale_price' => round($sale),
                                'promo_name' => $promo->name,
                            ];
                        }
                    }
                }

                return collect($best)->map(function ($b) {
                    $p = $b['product'];
                    return [
                        'id' => $p->id,
                        'name' => $p->name,
                        'image_url' => $p->image_url,
                        'base_price' => (float) $p->base_price,
                        'online_price' => $p->online_price,
                        'sale_price' => $b['sale_price'],
                        'promo_name' => $b['promo_name'],
                    ];
                })->values()->all();
            }
        );

        return response()->json(['success' => true, 'data' => $data])
            ->header('X-Catalog-Cache', $status);
    }

    // Gói 34: top 10 món bán chạy trong 30 ngày qua (theo tổng số lượng, chỉ đơn completed)
    // GET /api/online/top-products?branch_id=
    public function topProducts(Request $request): JsonResponse
    {
        $branchId = (int) $request->query('branch_id', 0);
        // Bộ nhớ đệm thực đơn (spec 2026-11-05): top-products KHÔNG theo
        // phiên bản catalog (nguồn là đơn hàng đổi liên tục) — chỉ sống
        // bằng TTL 120s. Header X-Catalog-Cache để vòng đo nhìn thấy trạng
        // thái đệm.
        [$data, $status] = CatalogCache::remember(
            CatalogCache::topProductsKey($branchId),
            CatalogCache::TOP_TTL,
            function () use ($branchId) {
                $since = now()->subDays(30);
                $rows = DB::table('order_items')
                    ->join('orders', 'orders.id', '=', 'order_items.order_id')
                    ->where('orders.status', 'completed')
                    ->whereNotNull('order_items.product_id')
                    ->where('orders.created_at', '>=', $since)
                    ->when($branchId > 0, fn ($q) => $q->where('orders.branch_id', $branchId))
                    ->groupBy('order_items.product_id')
                    ->selectRaw('order_items.product_id, SUM(order_items.quantity) AS total_sold')
                    ->orderByDesc('total_sold')
                    ->limit(10)
                    ->get();

                return $rows->map(fn ($r) => [
                    'product_id' => (int) $r->product_id,
                    'total_sold' => (int) $r->total_sold,
                ])->values()->all();
            }
        );

        return response()->json(['success' => true, 'data' => $data])
            ->header('X-Catalog-Cache', $status);
    }

    // Cấu hình phí ship
    public function shipConfig(): JsonResponse
    {
        $deliveryService = app(\App\Services\Delivery\DeliveryService::class);
        return response()->json(['success' => true, 'data' => [
            'base_fee' => (float) Setting::get('ship_base_fee', 20000),
            'base_km' => (float) Setting::get('ship_base_km', 2),
            'per_km' => (float) Setting::get('ship_per_km', 8000),
            // Spec phí giao một nguồn mục 4.3: quán hỗ trợ phí ship áp thống
            // nhất — client hiển thị đúng số server sẽ chốt (hỗ trợ là lớp
            // giảm trên phí bảng, cùng nguồn cấu hình với applySupport).
            'support_threshold' => $deliveryService->supportThreshold(),
            'support_amount' => $deliveryService->supportAmount(),
            // Gói mở COD giao hàng (2026-11-11): phí thu hộ COD phẳng do
            // quán tự đặt — client hiển thị dòng gợi ý + gộp dòng tổng kết
            // (phương án B). Số chốt lấy từ snapshot trên đơn, không tính
            // lại từ giá trị này.
            'ship_cod_fee' => (float) Setting::get('ship_cod_fee', 0),
        ]]);
    }

    // Gói 50e: geocode qua backend (Zalo WebView chặn domain lạ, backend gọi OSM với User-Agent chuẩn)
    // Spec bỏ ghim — tra tọa độ từ địa chỉ chữ (Đại Vương phán 2026-11-12
    // ~23:28, spec-dia-chi-don-giao-tra-tu-chu-bo-ghim.md mục 2): endpoint
    // này chạy TRUY VẤN BẬC THANG, dừng ở kết quả dùng được đầu tiên và đáp
    // kèm ladder_step (1/2/3) để TESTER/PM đo tỉ lệ rơi xuống mức đoạn
    // đường:
    //   Bậc 1: chuỗi đầy đủ client gửi (số nhà + đường + phường + tỉnh).
    //   Bậc 2: ghép lại từ 3 trường cấu trúc (số nhà + đường, phường, tỉnh)
    //          — cấp quận/huyện nếu khách gõ lẫn trong ô đường bị cắt bỏ.
    //   Bậc 3: chỉ số nhà + tên đường (đoạn trước dấu phẩy đầu tiên của ô
    //          đường) kèm khung ưu tiên quanh chi nhánh đang chọn. Trong
    //          bậc này, nếu số nhà dạng hẻm kép "212B/C79" tra rỗng thì
    //          thử lại với phần trước dấu "/" ("212B") — Nominatim không
    //          hiểu số nhà kép (đo sống 2026-11-12: "212B/C79 Nguyễn
    //          Trãi" rỗng mọi dạng truy vấn, "212B Nguyễn Trãi" trúng
    //          đúng cụm hẻm); vẫn tính là bậc 3, không thêm bậc mới.
    // Cả thang rỗng → 422 mã dropoff_geocode_failed (mã lỗi DUY NHẤT của
    // gói — dùng chung với chốt store()).
    // Khoanh vùng (2026-11-13): mỗi bậc lấy tối đa 5 ứng viên kèm
    // addressdetails, cả 3 bậc đều kèm khung ưu tiên quanh chi nhánh, rồi
    // pickDropoffCandidate LỌC CỨNG theo tỉnh khách đã chọn và lấy điểm
    // gần chi nhánh nhất — không còn lấy mù top-1 (top-1 đổi theo lần gọi
    // và có lần nhảy tỉnh, sự cố §HI).
    public function geocode(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $street = trim((string) $request->query('street', ''));
        $ward = trim((string) $request->query('ward', ''));
        $province = trim((string) $request->query('province', ''));
        $branchLat = (float) $request->query('branch_lat', 0);
        $branchLng = (float) $request->query('branch_lng', 0);

        // Khung ưu tiên ~3km quanh chi nhánh đang chọn — tính MỘT lần dùng
        // cho cả 3 bậc (khoanh vùng 2026-11-13: trước đây chỉ bậc 3 có;
        // bậc 1-2 trần nên top-1 của Nominatim có lần nhảy sang tỉnh khác,
        // xem pickDropoffCandidate). bounded = 0: chỉ thiên vị thứ hạng,
        // vẫn trả kết quả ngoài khung khi trong khung rỗng — TUYỆT ĐỐI
        // không để bounded = 1 (khách xa chi nhánh sẽ tra rỗng cả thang).
        $viewbox = [];
        if ($branchLat && $branchLng) {
            $d = 0.03;
            $viewbox = [
                'viewbox' => ($branchLng - $d) . ',' . ($branchLat + $d) . ',' . ($branchLng + $d) . ',' . ($branchLat - $d),
                'bounded' => 0,
            ];
        }

        $steps = [];
        if (mb_strlen($q) >= 5) {
            $steps[1] = array_merge(['q' => $q], $viewbox);
        }
        if ($street !== '' && $ward !== '') {
            // Cắt đoạn cấp quận/huyện/thành phố trực thuộc nếu khách gõ lẫn
            // vào ô số nhà + đường (vd "35 Nguyễn Thái Học, Quận 1").
            $streetCore = preg_replace('/,\s*(quận|huyện|thị xã|thành phố|tp\.?)\b.*$/iu', '', $street);
            $q2 = implode(', ', array_filter([$streetCore, $ward, $province]));
            if (mb_strlen($q2) >= 5 && $q2 !== $q) {
                $steps[2] = array_merge(['q' => $q2], $viewbox);
            }
        }
        if ($street !== '') {
            $streetOnly = trim(explode(',', $street)[0]);
            if (mb_strlen($streetOnly) >= 5) {
                $candidates = [$streetOnly];
                // Số nhà hẻm kép "212B/C79 ..." → thử thêm dạng cắt tại "/".
                if (preg_match('/^(\S+)\//', $streetOnly, $mSlash)) {
                    $truncated = preg_replace('/^\S+/', $mSlash[1], $streetOnly, 1);
                    if ($truncated !== $streetOnly && mb_strlen($truncated) >= 5) {
                        $candidates[] = $truncated;
                    }
                }
                foreach ($candidates as $cand) {
                    if (($steps[1]['q'] ?? null) === $cand || ($steps[2]['q'] ?? null) === $cand) continue;
                    $steps[3][] = array_merge(['q' => $cand], $viewbox);
                }
            }
        }

        foreach ($steps as $stepNo => $paramSets) {
            // Bậc 1/2: một bộ tham số duy nhất. Bậc 3: có thể thêm biến thể
            // cắt số hẻm — vẫn cùng một bậc, trúng biến thể nào cũng là 3.
            if (isset($paramSets['q'])) $paramSets = [$paramSets];
            foreach ($paramSets as $params) {
                $hit = $this->pickDropoffCandidate(
                    $this->nominatimSearchList($params),
                    $province, $branchLat, $branchLng
                );
                if ($hit !== null) {
                    // Vá §HP (2026-11-13): điểm trúng thang phải trả
                    // source 'ladder' — từ vựng của cột dropoff_source
                    // (store() chỉ chấp nhận ladder|ndamaps_place|
                    // ndamaps_forward|saved). Trả 'nominatim' (tên nhà
                    // cung cấp) thì client gửi nguyên văn làm dropoff_source
                    // → store() 422, mọi đơn giao đường thang đều chết ở
                    // chốt đơn. 'nominatim' CHỈ còn là từ vựng của đường
                    // gợi ý geocodeSuggest (spec §2.4), không đụng tới.
                    return response()->json(['success' => true, 'data' => [
                        'lat' => $hit['lat'],
                        'lng' => $hit['lng'],
                        'label' => $hit['label'],
                        'ladder_step' => $stepNo,
                        'source' => 'ladder',
                    ]]);
                }
            }
        }
        // Gói geocode lai NDAMaps (spec 2026-11-13 mục 3.2) — CỨU CÁNH:
        // chỉ gọi khi thang đã chạy hết 3 bậc và rỗng hẳn (khoảnh khắc
        // hiện tại sẽ trả 422). Ngoài điều kiện này không gọi forward ở
        // bất kỳ đâu trong đường chốt đơn. Cứu cánh có điểm → trả điểm đó
        // kèm source 'ndamaps_forward', ladder_step null (không thuộc bậc
        // nào); cứu cánh cũng rỗng/hỏng → giữ 422 hiện hành, nguyên văn.
        $rescueText = $q !== '' ? $q : implode(', ', array_filter([$street, $ward, $province]));
        if (mb_strlen($rescueText) >= 5) {
            $rescue = (new NdamapsService())->forwardRescue($rescueText, $province, $branchLat, $branchLng);
            if ($rescue !== null) {
                return response()->json(['success' => true, 'data' => [
                    'lat' => $rescue['lat'],
                    'lng' => $rescue['lng'],
                    'label' => $rescue['label'],
                    'ladder_step' => null,
                    'source' => 'ndamaps_forward',
                ]]);
            }
        }
        return response()->json([
            'success' => false,
            'code' => 'dropoff_geocode_failed',
            'message' => 'Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.',
        ], 422);
    }

    // Một lượt tra Nominatim lấy tối đa 5 ứng viên kèm chi tiết địa chỉ
    // (addressdetails) — nguyên liệu cho khoanh vùng ở
    // pickDropoffCandidate(). Lỗi kết nối cũng tính là không có kết quả
    // để bậc thang còn cơ hội rơi xuống bậc dưới.
    private function nominatimSearchList(array $params): array
    {
        try {
            $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query(array_merge([
                'format' => 'json', 'limit' => 5, 'countrycodes' => 'vn', 'addressdetails' => 1,
            ], $params));
            $ctx = stream_context_create(['http' => [
                'timeout' => 8,
                'header' => "User-Agent: CoffeePOS-ZaloMiniApp/1.0\r\nAccept: application/json\r\n",
            ]]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) return [];
            $data = json_decode($raw, true);
            if (!is_array($data)) return [];
            $out = [];
            foreach ($data as $row) {
                if (empty($row['lat']) || empty($row['lon'])) continue;
                $addr = $row['address'] ?? [];
                $out[] = [
                    'lat' => (float) $row['lat'],
                    'lng' => (float) $row['lon'],
                    'label' => $row['display_name'] ?? '',
                    'province' => (string) ($addr['state'] ?? $addr['city'] ?? ''),
                ];
            }
            return $out;
        } catch (\Throwable $e) {
            return [];
        }
    }

    // Khoanh vùng theo dữ liệu khách đã chọn (Đại Vương chốt 2026-11-13,
    // sau sự cố §HI: bậc 1 có lần trả điểm ở tỉnh khác làm phí ship của
    // đơn 3556 nhảy 25.000đ → 61.000đ):
    //   1. LỌC CỨNG theo tỉnh/thành khách chọn ở form — ứng viên khác
    //      tỉnh loại hết, dù đứng đầu danh sách (top-1 của Nominatim đổi
    //      theo từng lần gọi và có thể nhảy tỉnh; vd "35 Nguyễn Thái
    //      Học" có lần rơi về Thủ Dầu Một). Ứng viên không đọc được tỉnh
    //      trong addressdetails cũng loại — không kiểm chứng được thì
    //      không chốt. Bậc lọc xong còn 0 ứng viên thì coi như bậc đó
    //      rỗng, thang rơi tiếp như luật cũ; cả thang rỗng → 422 như cũ.
    //   2. Trong số còn lại chọn điểm GẦN CHI NHÁNH NHẤT (không còn lấy
    //      mù top-1). Thiếu tọa độ chi nhánh → lấy ứng viên đầu tiên còn
    //      lại sau lọc.
    // Khách không gửi tỉnh (target rỗng) → không lọc, giữ hành vi cũ.
    // Phường KHÔNG lọc cứng: đoạn đường cắt qua phường là thường; phường
    // vẫn nằm trong câu truy vấn như cũ.
    private function pickDropoffCandidate(array $candidates, string $province, float $branchLat, float $branchLng): ?array
    {
        if (!$candidates) return null;
        $target = $this->normProvinceName($province);
        if ($target !== '') {
            $candidates = array_values(array_filter($candidates, function ($c) use ($target) {
                return $this->normProvinceName($c['province'] ?? '') === $target;
            }));
            if (!$candidates) return null;
        }
        if (!$branchLat || !$branchLng) {
            $first = $candidates[0];
            return ['lat' => $first['lat'], 'lng' => $first['lng'], 'label' => $first['label']];
        }
        $best = null;
        $bestKm = null;
        foreach ($candidates as $c) {
            $km = $this->haversineKm($branchLat, $branchLng, $c['lat'], $c['lng']);
            if ($bestKm === null || $km < $bestKm) {
                $bestKm = $km;
                $best = $c;
            }
        }
        return ['lat' => $best['lat'], 'lng' => $best['lng'], 'label' => $best['label']];
    }

    // Chuẩn hóa tên tỉnh/thành để so khớp: bỏ dấu tiếng Việt, thường
    // hóa, bỏ ký tự lạ và tiền tố "Thành phố"/"Tỉnh"/"TP" — "TP. Hồ Chí
    // Minh" của form, "Thành phố Hồ Chí Minh" trong addressdetails của
    // Nominatim đều về một dạng "ho chi minh". Ủy quyền về
    // NdamapsService để thang và đường cứu cánh dùng đúng 1 bộ chuẩn hóa.
    private function normProvinceName(?string $name): string
    {
        return NdamapsService::normalizeProvince($name);
    }

    // Khoảng cách chim bay km (cùng công thức haversine ở
    // pinnedDistanceKm).
    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return 2 * 6371 * asin(sqrt($a));
    }

    // Gói 55 p11ac: proxy danh sách tỉnh/thành (Zalo WebView chặn domain lạ)
    public function provinces(): JsonResponse
    {
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 8]]);
            $raw = @file_get_contents('https://provinces.open-api.vn/api/v2/p/', false, $ctx);
            if ($raw === false) throw new \RuntimeException('Không kết nối được');
            return response()->json(['success' => true, 'data' => json_decode($raw, true) ?: []]);
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e), 'data' => []], 502);
        }
    }

    // Gói 55 p11ac: proxy xã/phường theo mã tỉnh
    public function wards(Request $request): JsonResponse
    {
        $code = (int) $request->query('province', 0);
        if ($code <= 0) return response()->json(['success' => false, 'message' => 'Thiếu mã tỉnh', 'data' => []], 422);
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 8]]);
            $raw = @file_get_contents("https://provinces.open-api.vn/api/v2/p/{$code}?depth=2", false, $ctx);
            if ($raw === false) throw new \RuntimeException('Không kết nối được');
            $data = json_decode($raw, true);
            return response()->json(['success' => true, 'data' => $data['wards'] ?? []]);
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e), 'data' => []], 502);
        }
    }

    // Gói 50f: gợi ý địa chỉ khi user gõ (trả tối đa 5 kết quả để chọn nhanh)
    // Gói geocode lai NDAMaps (spec 2026-11-13 mục 2): đường CHÍNH là
    // NDAMaps autocomplete khoanh 5km quanh chi nhánh + place; gặp bất kỳ
    // tín hiệu hỏng nào → cùng request này chạy geocodeSuggest Nominatim
    // nguyên hành vi hiện tại (đường dự phòng). Hợp đồng đáp sau gói:
    // data = {source: 'ndamaps' | 'nominatim', items: [...]}; item
    // NDAMaps = {place_id, label, short} (chưa có tọa độ), item Nominatim
    // = {lat, lng, label, short} như hiện tại. Client phân biệt theo
    // source + có/không place_id.
    public function geocodeSuggest(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 5) {
            return response()->json(['success' => true, 'data' => ['source' => 'nominatim', 'items' => []]]);
        }
        // Gói 55 p3: ưu tiên kết quả gần vị trí user (nếu có lat/lon)
        $lat = (float) $request->query('lat', 0);
        $lon = (float) $request->query('lon', 0);
        $session = $request->query('session');
        $items = (new NdamapsService())->autocomplete($q, $lat, $lon, is_string($session) ? $session : null);
        if ($items !== null) {
            return response()->json(['success' => true, 'data' => ['source' => 'ndamaps', 'items' => $items]]);
        }
        try {
            $params = [
                'format' => 'json', 'limit' => 5, 'countrycodes' => 'vn',
                'addressdetails' => 1, 'q' => $q,
            ];
            if ($lat && $lon) {
                // Viewbox ~2km quanh vị trí user để ưu tiên địa chỉ gần
                $d = 0.02;
                $params['viewbox'] = ($lon - $d) . ',' . ($lat + $d) . ',' . ($lon + $d) . ',' . ($lat - $d);
                $params['bounded'] = 0; // 0 = ưu tiên trong viewbox nhưng vẫn trả ngoài nếu không có
            }
            $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query($params);
            $ctx = stream_context_create(['http' => [
                'timeout' => 8,
                'header' => "User-Agent: CoffeePOS-ZaloMiniApp/1.0\r\nAccept: application/json\r\n",
            ]]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) throw new \RuntimeException('Không kết nối được bản đồ');
            $data = json_decode($raw, true) ?: [];
            $out = [];
            foreach (array_slice($data, 0, 5) as $r) {
                if (empty($r['lat']) || empty($r['lon'])) continue;
                $a = $r['address'] ?? [];
                // Gói 55 p3: label theo cấu trúc "Số nhà, Tên đường, Phường/Xã, Tỉnh/Thành"
                $parts = [];
                $streetLine = trim(($a['house_number'] ?? '') . ' ' . ($a['road'] ?? ''));
                if ($streetLine !== '') $parts[] = $streetLine;
                $ward = $a['suburb'] ?? $a['village'] ?? $a['hamlet'] ?? '';
                if ($ward !== '') $parts[] = $ward;
                $city = $a['city'] ?? $a['town'] ?? $a['county'] ?? $a['state'] ?? '';
                if ($city !== '') $parts[] = $city;
                $label = implode(', ', $parts) ?: ($r['display_name'] ?? '');
                $out[] = [
                    'lat' => (float) $r['lat'],
                    'lng' => (float) $r['lon'],
                    'label' => $label,
                    // Tên gọn: số nhà + đường (nếu có)
                    'short' => $streetLine ?: mb_substr($label, 0, 60),
                ];
            }
            return response()->json(['success' => true, 'data' => ['source' => 'nominatim', 'items' => $out]]);
        } catch (\Throwable $e) {
            return response()->json(['success' => true, 'data' => ['source' => 'nominatim', 'items' => []]]);
        }
    }

    // Gói geocode lai NDAMaps (spec 2026-11-13 mục 2.2): tọa độ bản ghi
    // khi khách chọn 1 gợi ý NDAMaps. Server đối chiếu điểm trước khi trả
    // (tỉnh khớp tỉnh khách đã chọn + cách chi nhánh ≤ 30km); điểm không
    // dùng được (lệch tỉnh / quá xa / place lỗi — mọi tín hiệu mục 4) →
    // data null: client chỉ điền chữ như chọn gợi ý Nominatim, điểm chốt
    // do đường B quyết ở bước tính phí. Khách không thấy lỗi gì.
    public function geocodePlace(Request $request): JsonResponse
    {
        $placeId = trim((string) $request->query('place_id', ''));
        if ($placeId === '') {
            return response()->json(['success' => false, 'message' => 'Thiếu place_id', 'data' => null], 422);
        }
        $session = $request->query('session');
        $province = trim((string) $request->query('province', ''));
        $branchLat = (float) $request->query('lat', 0);
        $branchLng = (float) $request->query('lon', 0);
        $hit = (new NdamapsService())->place(
            $placeId,
            is_string($session) ? $session : null,
            $province, $branchLat, $branchLng
        );
        if ($hit === null) {
            return response()->json(['success' => true, 'data' => null, 'usable' => false]);
        }
        return response()->json(['success' => true, 'data' => [
            'lat' => $hit['lat'],
            'lng' => $hit['lng'],
            'label' => $hit['label'],
            'place_id' => $placeId,
        ], 'usable' => true]);
    }

    // Gói 55 p3: reverse geocode — từ GPS (lat/lon) ra địa chỉ để điền vào form
    public function geocodeReverse(Request $request): JsonResponse
    {
        $lat = (float) $request->query('lat', 0);
        $lon = (float) $request->query('lon', 0);
        if (!$lat || !$lon) {
            return response()->json(['success' => false, 'message' => 'Thiếu tọa độ'], 422);
        }
        try {
            $url = 'https://nominatim.openstreetmap.org/reverse?' . http_build_query([
                'format' => 'json', 'lat' => $lat, 'lon' => $lon,
                'addressdetails' => 1, 'accept-language' => 'vi',
            ]);
            $ctx = stream_context_create(['http' => [
                'timeout' => 8,
                'header' => "User-Agent: CoffeePOS-ZaloMiniApp/1.0\r\nAccept: application/json\r\n",
            ]]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) throw new \RuntimeException('Không kết nối được bản đồ');
            $r = json_decode($raw, true) ?: [];
            $addr = $r['address'] ?? [];
            return response()->json(['success' => true, 'data' => [
                'lat' => $lat,
                'lng' => $lon,
                'label' => $r['display_name'] ?? '',
                'road' => $addr['road'] ?? '',
                'house_number' => $addr['house_number'] ?? '',
                'suburb' => $addr['suburb'] ?? $addr['village'] ?? '',
                'city' => $addr['city'] ?? $addr['town'] ?? $addr['county'] ?? '',
                'state' => $addr['state'] ?? '',
            ]]);
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }
    }

    private function calcShipFee(float $km): float
    {
        $baseFee = (float) Setting::get('ship_base_fee', 20000);
        $baseKm = (float) Setting::get('ship_base_km', 2);
        $perKm = (float) Setting::get('ship_per_km', 8000);
        if ($km <= $baseKm) {
            return $baseFee;
        }
        return $baseFee + ceil($km - $baseKm) * $perKm;
    }

    // Gói mở COD giao hàng (spec 2026-11-11): NGUỒN DUY NHẤT của khoản phí
    // thu hộ COD — trả về số cộng thêm vào phí giao khi ĐỦ 4 điều kiện:
    // đơn giao hàng + kênh COD + công tắc delivery_cod_enabled BẬT +
    // setting ship_cod_fee > 0. Ngữ cảnh (giao/COD) do caller suy từ dữ
    // kiện đơn; helper này chỉ đọc cấu hình — không nơi nào khác được tự
    // cộng khoản này, không nhận số phí từ client.
    private function codFeeFor(bool $isDelivery, bool $isCod): float
    {
        if (!$isDelivery || !$isCod) {
            return 0;
        }
        if (!(bool) Setting::get('delivery_cod_enabled', '0')) {
            return 0;
        }
        return max(0, (float) Setting::get('ship_cod_fee', 0));
    }

    // Sổ #95: gương openStatus() của Mini App (utils/openingHours.js) — trả
    // thông điệp đóng cửa nếu quán đang đóng, null nếu đang mở HOẶC không đủ
    // cấu hình giờ để kết luận (client: openStatus null = không coi là đóng).
    // Nguồn giờ duy nhất là branch.opening_hours — cùng dữ kiện client đọc.
    // Văn bản gương banner UI: "Quán đã đóng cửa" + "(mở lại HH:MM)" khi biết
    // giờ mở; ngày nghỉ theo chế độ daily thì không có giờ mở để báo.
    private function closedNowMessage(Branch $branch): ?string
    {
        $oh = $branch->opening_hours;
        if (!is_array($oh) || $oh === []) return null;
        $open = null;
        $close = null;
        if (($oh['mode'] ?? null) === 'daily' && !empty($oh['days']) && is_array($oh['days'])) {
            $cfg = $oh['days'][(int) now()->format('w')] ?? null;
            if (!$cfg || !empty($cfg['off'])) {
                return 'Quán đã đóng cửa';
            }
            $open = $cfg['open'] ?? null;
            $close = $cfg['close'] ?? null;
        } else {
            $open = $oh['open'] ?? null;
            $close = $oh['close'] ?? null;
        }
        if (!$open || !$close) return null;
        $op = explode(':', (string) $open);
        $cp = explode(':', (string) $close);
        $o = ((int) ($op[0] ?? 0)) * 60 + ((int) ($op[1] ?? 0));
        $c = ((int) ($cp[0] ?? 0)) * 60 + ((int) ($cp[1] ?? 0));
        $cur = (int) now()->format('H') * 60 + (int) now()->format('i');
        $isOpen = $o <= $c ? ($cur >= $o && $cur < $c) : ($cur >= $o || $cur < $c);
        if ($isOpen) return null;

        return 'Quán đã đóng cửa (mở lại ' . $open . ')';
    }

    // Spec phí giao MỘT NGUỒN (2026-11-06): khoảng cách = haversine giữa tọa
    // độ chi nhánh và tọa độ điểm giao trên đơn (client gửi kèm — nguồn điểm
    // từ 2026-11-12 là tra địa chỉ chữ ở checkout, spec bỏ ghim) — làm tròn
    // 0,1 km như công thức ở mọi tầng. Server KHÔNG geocode
    // lại chuỗi địa chỉ (hàm serverDistanceKm cũ đã xóa hẳn theo spec mục 3).
    // Trả về null khi thiếu tọa độ ở một trong hai đầu -> phí để quán xác nhận.
    private function pinnedDistanceKm($branch, array $validated): ?float
    {
        if (!$branch || empty($branch->latitude) || empty($branch->longitude)) return null;
        if (!isset($validated['delivery_dropoff_lat']) || !isset($validated['delivery_dropoff_lng'])) return null;
        $lat1 = deg2rad((float) $branch->latitude);
        $lon1 = deg2rad((float) $branch->longitude);
        $lat2 = deg2rad((float) $validated['delivery_dropoff_lat']);
        $lon2 = deg2rad((float) $validated['delivery_dropoff_lng']);
        $dLat = $lat2 - $lat1; $dLon = $lon2 - $lon1;
        $a = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLon / 2) ** 2;
        return round(2 * 6371 * asin(sqrt($a)), 1);
    }

    // KM đủ điều kiện cho kênh online
    public function eligiblePromotions(Request $request, PromotionService $service): JsonResponse
    {
        $validated = $request->validate([
            'subtotal' => 'required|numeric|min:0',
            'items' => 'nullable|array',
            'customer_id' => 'nullable|exists:customers,id',
            'shipping_fee' => 'nullable|numeric|min:0', // Gói 10c: để tính KM phí ship
            // Spec KM chống mã (2026-10-21) Phần B: định danh đi kèm để tin customer_id
            'phone' => 'nullable|string|max:20',
            'member_code' => 'nullable|string|max:20',
            'zalo_id' => 'nullable|string|max:100',
            // Gói Ưu đãi hợp nhất (2026-10-31): chế độ hợp nhất cho Checkout Mini App
            'unified' => 'nullable|boolean',
        ]);
        // customer_id trần KHÔNG được tin: chỉ dùng khi định danh khớp đúng khách đó,
        // ngược lại tính KM như khách vãng lai (KM công khai vẫn hiện, KM theo hạng thì không).
        $effectiveCustomerId = null;
        if (!empty($validated['customer_id'])) {
            $verified = \App\Services\CustomerIdentityService::verifiedCustomer($validated);
            if ($verified && (int) $verified->id === (int) $validated['customer_id']) {
                $effectiveCustomerId = $verified->id;
            }
        }
        $params = [
            'subtotal' => (float) $validated['subtotal'],
            'items' => $validated['items'] ?? [],
            'customer_id' => $effectiveCustomerId,
            'channel' => 'online',
            'shipping_fee' => (float) ($validated['shipping_fee'] ?? 0),
        ];
        if (!empty($validated['unified'])) {
            return response()->json(['success' => true, 'data' => $this->unifiedOffers($service, $params)]);
        }
        // Không kèm cờ unified → response y hệt trước gói (mảng KM đủ điều kiện)
        return response()->json(['success' => true, 'data' => $service->eligiblePromotions($params)]);
    }

    /**
     * Gói Ưu đãi hợp nhất (2026-10-31): danh sách hợp nhất KM chung + coupon ví
     * cho panel Ưu đãi của Checkout — gồm cả mã chưa đủ điều kiện (kèm lý do và
     * số tiền còn thiếu do server xác định) để client hiển thị mờ. Mọi số giảm
     * đều do server tính bằng đúng các hàm của đường eligible/validateCoupon;
     * client không tự tính % của bất kỳ mã nào.
     * Sắp xếp: nhóm chọn được theo số giảm giảm dần (KM tặng món cuối nhóm;
     * hòa số giảm thì coupon ví trước) → nhóm chưa đủ điều kiện theo số giảm
     * tiềm năng giảm dần.
     */
    private function unifiedOffers(PromotionService $service, array $params): array
    {
        $subtotal = (float) $params['subtotal'];
        $items = $params['items'] ?? [];
        $shippingFee = (float) ($params['shipping_fee'] ?? 0);
        $customer = !empty($params['customer_id']) ? \App\Models\Customer::find($params['customer_id']) : null;
        $now = now();
        $ctx = [
            'subtotal' => $subtotal,
            'items' => $items,
            'customer' => $customer,
            'channel' => 'online',
            'shipping_fee' => $shippingFee,
            'at' => $now,
        ];
        $out = [];

        // --- KM chung: chỉ chương trình đang trong cửa sổ hiệu lực (chưa bắt
        // đầu/đã kết thúc thì không xuất hiện, tránh rác danh sách) ---
        $promotions = \App\Models\Promotion::where('is_active', true)
            ->where(function ($q) use ($now) {
                $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
            })
            ->where(function ($q) use ($now) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now);
            })
            ->get();
        foreach ($promotions as $promo) {
            // Hotfix 2026-11-01: mẫu chiến dịch coupon (auto_config có trigger) không
            // thuộc phía KM chung của danh sách hợp nhất — chỉ xuất hiện qua ví coupon.
            if (!empty($promo->auto_config['trigger'])) {
                continue;
            }
            $chk = $service->checkConditions($promo, $ctx);
            if ($promo->type === 'shipping') {
                // KM phí ship chỉ có nghĩa khi đơn có phí ship (giao hàng)
                if ($shippingFee <= 0) {
                    continue;
                }
                $shipDiscount = (float) $promo->value <= 0
                    ? $shippingFee
                    : min((float) $promo->value, $shippingFee);
                if ($shipDiscount <= 0) {
                    continue;
                }
                $base = [
                    'kind' => 'promotion', 'promotion_id' => (int) $promo->id,
                    'code' => $promo->code, 'name' => $promo->name, 'type' => $promo->type,
                    'is_shipping' => true, 'stack_with_coupon' => (bool) $promo->stack_with_coupon,
                    'gift_product_name' => null,
                ];
                if ($chk['ok']) {
                    $out[] = $base + ['discount' => (int) round($shipDiscount), 'eligible' => true];
                } else {
                    $out[] = $base + ['discount' => 0, 'eligible' => false,
                        'reason_code' => $chk['reason'], 'reason_text' => $chk['message'],
                        'missing_amount' => $chk['reason'] === 'MIN_ORDER' ? (int) ceil((float) $promo->min_order_amount - $subtotal) : null,
                        'would_discount' => (int) round($shipDiscount)];
                }
                continue;
            }
            // menuProductIds() là private của service — resolve tại đây bằng
            // đúng 1 truy vấn bảng menu_product như service vẫn làm
            $menuProductIds = $promo->scope === 'menu' && !empty($promo->scope_ids)
                ? \Illuminate\Support\Facades\DB::table('menu_product')->whereIn('menu_id', $promo->scope_ids)->distinct()->pluck('product_id')->all()
                : [];
            $calc = $service->calculateDiscount($promo, $subtotal, $items, $menuProductIds);
            $base = [
                'kind' => 'promotion', 'promotion_id' => (int) $promo->id,
                'code' => $promo->code, 'name' => $promo->name, 'type' => $promo->type,
                'is_shipping' => false, 'stack_with_coupon' => (bool) $promo->stack_with_coupon,
                'gift_product_name' => $calc['gift_product_name'],
            ];
            if ($chk['ok']) {
                // Khớp đường eligible hiện tại: giảm 0 và không phải tặng món → không phải ưu đãi thật, bỏ qua
                if ($calc['discount'] <= 0 && $promo->type !== 'gift') {
                    continue;
                }
                $out[] = $base + ['discount' => (int) round($calc['discount']), 'eligible' => true];
            } else {
                $out[] = $base + ['discount' => 0, 'eligible' => false,
                    'reason_code' => $chk['reason'], 'reason_text' => $chk['message'],
                    'missing_amount' => $chk['reason'] === 'MIN_ORDER' ? (int) ceil((float) $promo->min_order_amount - $subtotal) : null,
                    'would_discount' => (int) round(max(0, $calc['discount']))];
            }
        }

        // --- Coupon ví của khách đã xác thực: đúng pipeline của validateCoupon
        // (chủ sở hữu → checkConditions → checkTrigger → discountFor) ---
        if ($customer) {
            $coupons = \App\Models\CustomerCoupon::with('promotion')
                ->where('customer_id', $customer->id)
                ->where('status', 'active')
                ->where(function ($q) use ($now) {
                    $q->whereNull('expires_at')->orWhere('expires_at', '>', $now);
                })
                ->orderByDesc('issued_at')
                ->get();
            foreach ($coupons as $coupon) {
                $promo = $coupon->promotion;
                if (!$promo) {
                    continue;
                }
                // Coupon phí ship không có nghĩa khi đơn không có phí ship (như KM ship ở trên)
                if ($promo->type === 'shipping' && $shippingFee <= 0) {
                    continue;
                }
                $chk = $service->checkConditions($promo, $ctx);
                $trig = $chk['ok'] ? $service->checkTrigger($promo, $coupon, $customer) : $chk;
                $calc = $service->discountFor($promo, $subtotal, $items, $shippingFee);
                $base = [
                    'kind' => 'wallet_coupon', 'customer_coupon_id' => (int) $coupon->id,
                    'code' => $coupon->code, 'name' => $promo->name, 'type' => $promo->type,
                    'is_shipping' => (bool) $calc['is_shipping'],
                    'stack_with_coupon' => (bool) $promo->stack_with_coupon,
                    'gift_product_name' => $calc['gift_product_name'],
                    // L2 (2026-10-31): hạn dùng của coupon — dữ kiện phân biệt các
                    // coupon trùng tên/chiến dịch trong ví (cộng thêm, chỉ ở chế độ unified)
                    'expires_at' => $coupon->expires_at
                        ? \Carbon\Carbon::parse($coupon->expires_at)->format('Y-m-d')
                        : null,
                ];
                if ($trig['ok'] && !$calc['unsupported']) {
                    $out[] = $base + ['discount' => (int) round($calc['discount']), 'eligible' => true];
                } else {
                    $reason = !$trig['ok'] ? $trig['reason'] : 'UNSUPPORTED_TYPE';
                    $out[] = $base + ['discount' => 0, 'eligible' => false,
                        'reason_code' => $reason,
                        'reason_text' => PromotionService::reasonText($reason, $promo),
                        'missing_amount' => $reason === 'MIN_ORDER' ? (int) ceil((float) $promo->min_order_amount - $subtotal) : null,
                        'would_discount' => $calc['unsupported'] ? 0 : (int) round(max(0, $calc['discount']))];
                }
            }
        }

        // Sắp xếp theo spec 2.7
        $kindRank = fn(array $it) => $it['kind'] === 'wallet_coupon' ? 0 : 1;
        usort($out, function ($a, $b) use ($kindRank) {
            if ($a['eligible'] !== $b['eligible']) {
                return $a['eligible'] ? -1 : 1;
            }
            if ($a['eligible']) {
                $aGift = $a['type'] === 'gift' ? 1 : 0;
                $bGift = $b['type'] === 'gift' ? 1 : 0;
                if ($aGift !== $bGift) {
                    return $aGift <=> $bGift;
                }
                if ($a['discount'] !== $b['discount']) {
                    return $b['discount'] <=> $a['discount'];
                }
            } else {
                if ($a['would_discount'] !== $b['would_discount']) {
                    return $b['would_discount'] <=> $a['would_discount'];
                }
            }
            // L2 (2026-10-31): hòa giữa 2 coupon ví → coupon sắp hết hạn xếp trước
            // (khách dùng coupon cận hạn trước); các tầng sắp xếp khác giữ nguyên
            if ($a['kind'] === 'wallet_coupon' && $b['kind'] === 'wallet_coupon') {
                $aExp = $a['expires_at'] ?? null;
                $bExp = $b['expires_at'] ?? null;
                if ($aExp !== $bExp) {
                    if ($aExp === null) {
                        return 1;
                    }
                    if ($bExp === null) {
                        return -1;
                    }
                    return strcmp($aExp, $bExp);
                }
            }
            return $kindRank($a) <=> $kindRank($b);
        });

        // Trần cộng dồn cho giỏ hiện tại — đúng định nghĩa §5d của store()
        $maxDiscountPct = (float) \App\Models\Setting::get('promo_max_discount_pct', 50);
        $cap = ($maxDiscountPct > 0 && $maxDiscountPct < 100)
            ? (int) round($subtotal * $maxDiscountPct / 100)
            : (int) $subtotal;

        return ['items' => $out, 'stack_cap_amount' => $cap];
    }

    /**
     * Audit toàn diện 2026-10-21 🟠8: validate voucher gõ tay để Mini App HIỂN THỊ
     * đúng số giảm + đưa vào tổng trước khi khách xác nhận (trước đây voucher chỉ áp
     * ở server lúc tạo đơn → tổng khách thấy cao hơn số bị thu thật).
     * Chỉ TÍNH THỬ bằng đúng công thức của store() — không trừ lượt, không khóa bản ghi;
     * store() vẫn kiểm lại toàn bộ khi chốt đơn. per_customer_limit chỉ kiểm khi định
     * danh khách đã xác thực (phone + member_code khớp).
     */
    public function validateVoucher(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => 'required|string|max:50',
            'subtotal' => 'required|numeric|min:0',
            'phone' => 'nullable|string|max:20',
            'member_code' => 'nullable|string|max:20',
            'zalo_id' => 'nullable|string|max:100',
        ]);
        $fail = fn (string $message) => response()->json(['success' => false, 'message' => $message], 422);

        $code = strtoupper(trim($validated['code']));
        $voucher = Voucher::where('code', $code)->where('is_active', true)->first();
        if (!$voucher) {
            return $fail('Mã voucher không hợp lệ.');
        }
        if ($voucher->usage_limit && $voucher->used_count >= $voucher->usage_limit) {
            return $fail('Voucher đã hết lượt sử dụng.');
        }
        if ($voucher->expires_at && now()->isAfter($voucher->expires_at)) {
            return $fail('Voucher đã hết hạn.');
        }
        if ($voucher->starts_at && now()->isBefore($voucher->starts_at)) {
            return $fail('Voucher chưa đến thời gian áp dụng.');
        }
        $subtotal = (float) $validated['subtotal'];
        if ($subtotal < (float) $voucher->min_order_amount) {
            // Gói Ưu đãi hợp nhất (2026-10-31): kèm missing_amount để client hiện
            // "Đặt thêm {X}đ" (số tiền còn thiếu do server tính, client không tự suy)
            $missing = (int) ceil((float) $voucher->min_order_amount - $subtotal);
            return response()->json(['success' => false,
                'message' => 'Chưa đạt giá trị tối thiểu của voucher. Đặt thêm ' . number_format($missing, 0) . 'đ để dùng mã này.',
                'data' => ['missing_amount' => $missing]], 422);
        }
        if ($voucher->per_customer_limit) {
            $customer = \App\Services\CustomerIdentityService::verifiedCustomer($validated);
            if ($customer) {
                $usedTimes = VoucherUsage::where('voucher_id', $voucher->id)
                    ->where('customer_id', $customer->id)->count();
                if ($usedTimes >= $voucher->per_customer_limit) {
                    return $fail('Bạn đã dùng hết lượt của mã khuyến mãi này.');
                }
            }
        }
        $discount = $voucher->type === 'fixed'
            ? (float) $voucher->value
            : ($subtotal * (float) $voucher->value) / 100;
        if ($voucher->max_discount_amount) {
            $discount = min($discount, (float) $voucher->max_discount_amount);
        }
        $discount = min($discount, $subtotal);

        return response()->json(['success' => true, 'data' => [
            'code' => $voucher->code,
            'name' => $voucher->name,
            'discount' => (int) round($discount),
            // Cờ cộng dồn với KM để frontend ước lượng phía thắng khi hiển thị tổng
            // (server quyết định cuối). Cờ coupon+coupon đã bỏ hẳn (tối đa 1 coupon/đơn).
            'stack_with_promotion' => (bool) $voucher->stack_with_promotion,
        ]]);
    }

    // Thông tin tích điểm của KH theo SĐT
    public function customer(Request $request): JsonResponse
    {
        // Gói 11: đăng nhập bằng SĐT + Mã TV (bỏ tra cứu tự do bằng SĐT để bảo mật)
        // Audit 2026-10-21 🟠10: member_code cho phép RỖNG — khách chưa có mã TV nhận
        // data=null (khách vãng lai) thay vì lỗi 422 (lỗi này từng làm danh sách KM —
        // kể cả KM công khai — trống lặng lẽ ở checkout). Vẫn KHÔNG tra khách chỉ bằng
        // SĐT (giữ nguyên tắc bảo mật Gói 11).
        // Spec đăng nhập SĐT + mật khẩu §3.2: token phiên được xét TRƯỚC cặp
        // SĐT + mã; cặp chỉ còn hiệu lực khi tài khoản chưa đặt mật khẩu và
        // mã không mang tiền tố IMP. Đường cứu "tra bằng mã IMP để xoay mã"
        // của spec B §5.2 bị RÚT ở gói này (§7.2): cặp IMP chết ở mọi lớp,
        // không xoay ở đây nữa (xoay chỉ còn ở lần xác thực Zalo đầu tiên).
        $customer = \App\Services\CustomerSessionService::resolveFromToken($request->bearerToken());
        $codeRotated = false;
        if (!$customer) {
            $validated = $request->validate([
                'phone' => 'required|string|max:20',
                'member_code' => 'nullable|string|max:20',
            ]);
            if (empty($validated['member_code'])) {
                return response()->json(['success' => true, 'data' => null]);
            }
            $customer = Customer::with('tier')
                ->where('phone', $validated['phone'])
                ->where('member_code', $validated['member_code'])
                ->first();
            if (!$customer || !\App\Services\CustomerIdentityService::pairUsable($customer)) {
                return response()->json(['success' => true, 'data' => null]);
            }
            // Đăng nhập bằng mã lần đầu mà chưa có mốc đồng ý → ghi mốc
            // 'code_login' (chỉ ghi khi đang trống). Vá dứt điểm NĐ13
            // (2026-11-13): chỉ ghi khi request mang cờ consent_agreed =
            // true — lượt tra cứu hồ sơ tự động theo cặp mã không phải
            // thời điểm đồng ý; khách đặt đơn đóng dấu qua cổng cờ ở
            // store() (nguồn 'checkout').
            if ($request->boolean('consent_agreed') && empty($customer->consent_agreed_at)) {
                $customer->consent_agreed_at = now();
                $customer->consent_source = 'code_login';
                $customer->save();
            }
        } else {
            $customer->load('tier');
        }
        // Gói 12a + phán Đại Vương 2026-11-09: lịch sử Tài khoản ẩn đơn ĐÃ KẾT
        // THÚC (hoàn thành HOẶC hủy) quá 24h kể từ mốc kết thúc; đơn chưa kết
        // thúc vẫn hiện kể cả qua ngày. Mốc kết thúc = completed_at / cancelled_at,
        // đơn cũ thiếu dấu mốc thì dùng updated_at (khuôn fallback của 12a).
        $cutoff = now()->subHours(24);
        $orders = $customer->orders()
            ->where(function ($q) use ($cutoff) {
                $q->whereNotIn('status', ['completed', 'cancelled'])
                    ->orWhere(function ($q2) use ($cutoff) {
                        $q2->where('status', 'completed')
                            ->where('completed_at', '>', $cutoff);
                    })
                    ->orWhere(function ($q2) use ($cutoff) {
                        // Đơn cũ hoàn thành trước khi có cột completed_at: dùng updated_at làm mốc
                        $q2->where('status', 'completed')
                            ->whereNull('completed_at')->where('updated_at', '>', $cutoff);
                    })
                    ->orWhere(function ($q2) use ($cutoff) {
                        $q2->where('status', 'cancelled')
                            ->where('cancelled_at', '>', $cutoff);
                    })
                    ->orWhere(function ($q2) use ($cutoff) {
                        // Đơn hủy thiếu dấu cancelled_at: dùng updated_at làm mốc
                        $q2->where('status', 'cancelled')
                            ->whereNull('cancelled_at')->where('updated_at', '>', $cutoff);
                    });
            })
            ->limit(10)->get(['id', 'code', 'total_amount', 'status', 'payment_status', 'created_at']);
        return response()->json(['success' => true, 'data' => [
            'id' => $customer->id,
            'name' => $customer->name,
            'phone' => $customer->phone,
            'member_code' => $customer->member_code,
            'code_rotated' => $codeRotated,
            // Spec mật khẩu §3.4/§5.4/§7.3: client dựa vào 3 cờ để chọn
            // màn bảo mật, ô email và ô đồng ý ở Checkout.
            'has_password' => !empty($customer->password_hash),
            'email' => $customer->email,
            'has_consented' => !empty($customer->consent_agreed_at),
            'points' => $customer->points,
            'total_spent' => (float) $customer->total_spent,
            'tier' => $customer->tier?->name,
            // Loyalty 2.0: bỏ redeem_points/redeem_amount (tỷ giá trừ điểm trực
            // tiếp cũ) — thay bằng payload loyalty đầy đủ (spec mục 8).
            'loyalty' => app(LoyaltyService::class)->loyaltyPayload($customer),
            'orders' => $orders,
        ]]);
    }

    /**
     * Tạo đơn online. Trạng thái: chờ nhân viên xác nhận (chưa trừ kho).
     */
    public function store(
        Request $request,
        PromotionService $promotionService,
        LoyaltyService $loyaltyService
    ): JsonResponse {
        // Chuẩn hóa IN HOA khi tra cứu voucher (backlog Spec 5, 2026-10-21): chỉ chuẩn hóa
        // phía đầu vào tra cứu (gõ thường/hoa đều trúng) — mã lưu trong DB giữ nguyên.
        // (Endpoint validateVoucher đã chuẩn hóa sẵn từ trước, không đổi.)
        if ($request->filled('voucher_code')) {
            $request->merge(['voucher_code' => strtoupper(trim((string) $request->input('voucher_code')))]);
        }
        $validated = $request->validate([
            'client_key' => 'nullable|string|max:64', // Gói 55 p11ac: idempotency key
            'branch_id' => 'required|exists:branches,id',
            'order_type' => ['required', \Illuminate\Validation\Rule::in(array_values(array_intersect(\App\Models\SharedCategory::activeCodes('order_types'), ['takeaway', 'delivery'])))], // Spec danh mục dùng chung: validate động, đơn online không có tại bàn
            'customer_name' => 'required|string|max:100',
            'customer_phone' => 'required|string|max:20',
            // Spec KM chống mã (2026-10-21) Phần B: mã TV để xác thực quyền lợi theo SĐT
            'member_code' => 'nullable|string|max:20',
            // Spec mật khẩu §7.3: email tự nguyện ở checkout (không bắt buộc,
            // không ghi đè — chỉ điền khi hồ sơ đang trống, xem trong transaction).
            'email' => 'nullable|email|max:150',
            // Spec mật khẩu §5.4: cờ đồng ý NĐ 13 ở đơn đầu (cổng cứng ở server).
            'consent_agreed' => 'nullable|boolean',
            'zalo_user_id' => 'nullable|string|max:100',
            'delivery_address' => 'required_if:order_type,delivery|nullable|string|max:255',
            'distance_km' => 'nullable|numeric|min:0|max:100', // Gói 55 p11ac: chỉ để tham khảo, server tự tính lại
            'scheduled_at' => 'nullable|date|after:now',
            'payment_method' => 'required|in:transfer,pay_at_store',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id',
            // SPEC-02: coupon từ ví cá nhân
            'customer_coupon_id' => 'nullable|exists:customer_coupons,id',
            // Loyalty 2.0: 'points_redeem' cố ý KHÔNG validate nữa — client cũ
            // gửi kèm sẽ bị bỏ qua im lặng (spec mục 4.2).
            'note' => 'nullable|string|max:255',
            'referred_by' => 'nullable|string|max:20', // Gói 9: mã TV người giới thiệu
            // Gói 64: bỏ VAT đơn online — giữ validate lỏng để không gãy client cũ (luôn bỏ qua khi tạo đơn)
            'delivery_note' => 'nullable|string|max:500',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            // Gói 60: gói giao hàng khách chọn từ báo giá live + phí đã khóa
            'delivery_package' => 'nullable|in:nhanh,sieu_toc',
            'delivery_quoted_fee' => 'nullable|numeric|min:0',
            'delivery_provider' => 'nullable|in:ahamove,lalamove',
            // Gói 61b: tọa độ điểm giao (từ GPS/gợi ý địa chỉ ở checkout).
            // Spec bỏ ghim — tra tọa độ từ địa chỉ chữ (2026-11-12): rule ở
            // đây CHỈ để nullable qua — toàn bộ kiểm hợp lệ cho đơn giao
            // nằm ở chốt cứng dropoff_geocode_failed ngay dưới (để mọi ca
            // sai đều trả đúng một mã lỗi thay vì lỗi validate rời rạc).
            'delivery_dropoff_lat' => 'nullable',
            'delivery_dropoff_lng' => 'nullable',
            // Gói geocode lai NDAMaps (2026-11-13 mục 3.3): nguồn điểm giao
            // của đơn — chỉ validate thuộc tập 4 giá trị rồi lưu; cổng,
            // phí, trạng thái không đổi hành vi (cờ là thông tin cho nhân
            // viên). Thiếu trường → null (tương thích ngược).
            'dropoff_source' => 'nullable|in:ladder,ndamaps_place,ndamaps_forward,saved',
            'items' => 'required|array|min:1|max:50',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.product_option_id' => 'nullable|exists:product_options,id',
            'items.*.option_ids' => 'nullable|array', // Gói 8a: tùy chọn từ nhóm (size/topping)
            'items.*.option_ids.*' => 'exists:product_options,id',
            'items.*.quantity' => 'required|integer|min:1|max:20',
            'items.*.note' => 'nullable|string|max:255',
        ]);

        // Spec phí giao một nguồn mục 5 (2026-11-06; thay chốt S8 cũ): đơn
        // GIAO HÀNG không bao giờ trả-tại-quán-thật. Đơn giao chỉ thu tiền mặt
        // qua kênh COD của cổng Zalo — và chỉ khi CẢ 2 công tắc cùng bật:
        // kênh COD (zalo_pay_cod_enabled) + thu hộ cho đơn giao
        // (delivery_cod_enabled, mặc định TẮT = giai đoạn đầu chỉ chuyển khoản).
        // pay_channel chỉ có ở đường /checkout-orders (PaymentController kiểm
        // kênh trước khi gọi tới đây); đường thường không gửi → coi là
        // trả-tại-quán-thật → chặn như chốt S8 trước đây. Cờ
        // zalo_pay_cod_takeaway_only thu hẹp về đúng vai trò này (mục 5.1).
        if (($validated['payment_method'] ?? null) === 'pay_at_store'
            && ($validated['order_type'] ?? null) === 'delivery') {
            $isCodChannel = ($request->input('pay_channel') === 'COD');
            $codAllowed = $isCodChannel
                && (bool) Setting::get('zalo_pay_cod_enabled', '1')
                && (bool) Setting::get('delivery_cod_enabled', '0');
            $blocked = $isCodChannel
                ? !$codAllowed
                : (bool) Setting::get('zalo_pay_cod_takeaway_only', '1');
            if ($blocked) {
                return response()->json([
                    'success' => false,
                    'message' => 'Trả tại quán chỉ áp dụng cho đơn mang về/hẹn giờ.',
                ], 422);
            }
        }

        // Spec bỏ ghim — tra tọa độ từ địa chỉ chữ (Đại Vương phán
        // 2026-11-12 ~23:28; thay cổng ghim của Phương án 1 cùng ngày):
        // đơn GIAO HÀNG online bắt buộc có tọa độ điểm giao HỢP LỆ —
        // LUẬT CỨNG, không công tắc cấu hình; chỉ đổi NGUỒN tọa độ: điểm
        // tra từ địa chỉ chữ ở checkout (bậc thang ở geocode()) hoặc điểm
        // đã lưu của địa chỉ trong sổ. Thiếu/rỗng/không phải số/ngoài
        // miền (lat −90..90, lng −180..180)/cặp (0,0)
        // → 422 dropoff_geocode_failed, KHÔNG tạo đơn. Chốt đặt tại store()
        // duy nhất: PaymentController::checkoutOrders ủy quyền store() tạo
        // đơn trước khi phát tham số SDK nên đường SDK thừa hưởng — đơn bị
        // chặn ở đây thì không phát sinh giao dịch SDK nào. Đơn mang về/
        // tại quán không qua chốt này; đơn nhóm đi controller riêng.
        if (($validated['order_type'] ?? null) === 'delivery') {
            $pinLat = $validated['delivery_dropoff_lat'] ?? null;
            $pinLng = $validated['delivery_dropoff_lng'] ?? null;
            $pinValid = is_numeric($pinLat) && is_numeric($pinLng)
                && (float) $pinLat >= -90 && (float) $pinLat <= 90
                && (float) $pinLng >= -180 && (float) $pinLng <= 180
                && !((float) $pinLat === 0.0 && (float) $pinLng === 0.0);
            if (!$pinValid) {
                return response()->json([
                    'success' => false,
                    'code' => 'dropoff_geocode_failed',
                    'message' => 'Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.',
                ], 422);
            }
        }

        // Sổ #95 (2026-11-05): chốt giờ đóng cửa ở SERVER — trước đây chỉ UI
        // khóa, gọi API trực tiếp ngoài giờ vẫn tạo được đơn tức thời (mẫu vật
        // HD20261105000906 lúc 06:30, quán mở 07:00). Gương luật Mini App:
        // đóng cửa thì chỉ nhận đơn CÓ hẹn giờ (scheduled_at đã qua validate
        // after:now). checkout-orders và chốt đơn nhóm đều dùng chung store()
        // này nên được phủ luôn; POS dùng OrderController, không đụng.
        if (empty($validated['scheduled_at'])) {
            $branchForHours = Branch::find($validated['branch_id']);
            $closedMsg = $branchForHours ? $this->closedNowMessage($branchForHours) : null;
            if ($closedMsg !== null) {
                return response()->json(['success' => false, 'message' => $closedMsg], 422);
            }
        }

        // Spec mật khẩu §5.4: cổng cứng đồng ý NĐ 13 ở đơn đầu — khách chưa
        // từng đồng ý thì đơn phải kèm cờ consent_agreed (mã lỗi riêng để
        // client hiện ô đồng ý và cho đặt lại). Áp ở cả 2 đường tạo đơn
        // (đường thường + checkout-orders; chốt đơn nhóm cũng qua store()).
        // T-11: khách SĐT hoàn toàn mới (chưa có dòng hồ sơ — hồ sơ sẽ được
        // tạo ngay tại đơn đầu) cũng bị cổng, không chỉ khách đã có hồ sơ.
        $existingCustomer = Customer::where('phone', $validated['customer_phone'])->first();
        if ((!$existingCustomer || empty($existingCustomer->consent_agreed_at)) && empty($validated['consent_agreed'])) {
            return response()->json([
                'success' => false,
                'code' => 'consent_required',
                'message' => 'Bạn cần đồng ý cho Daybreak xử lý dữ liệu cá nhân để đặt đơn đầu tiên.',
            ], 422);
        }

        try {
            // Gói mở COD giao hàng (2026-11-11): khoản thu hộ COD suy TỪ DỮ
            // KIỆN ĐƠN đã validate (giao hàng + pay_at_store + kênh COD của
            // đường SDK — cùng định nghĩa với chốt chặn COD ở trên), KHÔNG
            // nhận cờ/số phí từ client gửi lên. Số tiền qua codFeeFor() —
            // nguồn duy nhất, đã gồm cổng công tắc + setting.
            $shippingCodFee = (int) $this->codFeeFor(
                ($validated['order_type'] ?? null) === 'delivery',
                ($validated['payment_method'] ?? null) === 'pay_at_store'
                    && $request->input('pay_channel') === 'COD'
            );

            // Sổ #92 (2026-11-05): việc tạo đơn đóng vào một callable để vòng thử
            // lại bên dưới gọi lại được — thân transaction giữ nguyên từng dòng.
            $createOrder = function () use ($validated, $promotionService, $loyaltyService, $shippingCodFee) {
                return DB::transaction(function () use ($validated, $promotionService, $loyaltyService, $shippingCodFee) {
                $subtotal = 0;
                $orderItemsData = [];
                $promoItems = [];

                // 1. Tính tiền theo GIÁ MENU phía server (Gói 49i: giá kênh online)
                foreach ($validated['items'] as $item) {
                    $product = Product::with(['prices.priceList', 'categoryPrices'])->findOrFail($item['product_id']);
                    if ($product->is_service_fee) {
                        throw new Exception('Món phí dịch vụ do hệ thống tự tính.');
                    }
                    $option = !empty($item['product_option_id'])
                        ? ProductOption::findOrFail($item['product_option_id'])
                        : null;
                    // Gói 8a: cộng giá tất cả tùy chọn nhóm đã chọn
                    $groupOpts = !empty($item['option_ids'])
                        ? ProductOption::whereIn('id', $item['option_ids'])->get()
                        : collect();
                    $unitPrice = $product->online_price
                        + ($option ? (float) $option->additional_price : 0)
                        + $groupOpts->sum(fn($o) => (float) $o->additional_price);
                    $lineTotal = $unitPrice * $item['quantity'];
                    $subtotal += $lineTotal;

                    $orderItemsData[] = [
                        'product_id' => $product->id,
                        'product_option_id' => $option ? $option->id : null,
                        'options' => $groupOpts->isNotEmpty()
                            ? $groupOpts->pluck('name', 'id')->toArray()
                            : null,
                        'product_name' => $product->name,
                        'price' => $product->online_price,
                        'unit_price' => $unitPrice,
                        'quantity' => $item['quantity'],
                        'subtotal' => $lineTotal,
                        'total_price' => $lineTotal,
                        'discount_amount' => 0,
                        'note' => $item['note'] ?? null,
                    ];
                    $promoItems[] = [
                        'product_id' => $product->id,
                        'category_id' => $product->category_id,
                        'quantity' => $item['quantity'],
                        'line_total' => $lineTotal,
                        'unit_price' => $unitPrice,
                    ];
                }

                // 2. Tìm hoặc tạo khách hàng theo SĐT
                $customer = Customer::where('phone', $validated['customer_phone'])->first();
                $customerJustCreated = false;
                if (!$customer) {
                    $customerJustCreated = true;
                    $tier = MembershipTier::where('is_default', true)->first()
                        ?? MembershipTier::orderBy('sort_order')->first();
                    $customer = Customer::create([
                        'member_code' => $this->generateMemberCode(),
                        'name' => $validated['customer_name'],
                        'phone' => $validated['customer_phone'],
                        'membership_tier_id' => $tier?->id,
                        // Gói 9: lưu người giới thiệu (affiliate)
                        'referred_by' => $validated['referred_by'] ?? null,
                    ]);
                }
                // Spec KM chống mã (2026-10-21) Phần B: SĐT gõ tay KHÔNG đủ để hưởng
                // quyền lợi của khách đã có — phải khớp SĐT + mã TV (Audit BM-02: bỏ nhánh zalo_id trần).
                // Chưa xác thực vẫn đặt đơn như khách vãng lai (chỉ chặn quyền lợi).
                $identityVerified = $customerJustCreated
                    || \App\Services\CustomerIdentityService::matches($customer, $validated);

                // Spec mật khẩu §7.3: email ở checkout chỉ điền khi hồ sơ
                // đang trống (không ghi đè email khách đã tự đặt ở Tài khoản
                // — tránh người khác cầm SĐT gõ đè).
                if (!empty($validated['email']) && empty($customer->email)) {
                    $customer->email = $validated['email'];
                    $customer->email_added_at = now();
                    $customer->save();
                }
                // Spec mật khẩu §5.4: đơn đầu kèm cờ đồng ý → ghi mốc nguồn
                // 'checkout' (chỉ ghi khi mốc đang trống).
                if (!empty($validated['consent_agreed']) && empty($customer->consent_agreed_at)) {
                    $customer->consent_agreed_at = now();
                    $customer->consent_source = 'checkout';
                    $customer->save();
                }

                // 3. Phí ship (đơn giao hàng) — Spec phí giao MỘT NGUỒN
                // (2026-11-06): bảng phí nội bộ là nguồn DUY NHẤT ở mọi bề mặt.
                // Khoảng cách = haversine giữa tọa độ chi nhánh và tọa độ điểm
                // giao trên đơn (delivery_dropoff_lat/lng do client
                // gửi) — server KHÔNG geocode lại chuỗi địa chỉ, KHÔNG gọi báo
                // giá hãng để chốt phí (báo giá hãng chỉ còn cho Admin/điều
                // phối). Thiếu tọa độ (hoặc chi nhánh chưa có tọa độ) → phí 0đ
                // + ghi chú "Quán xác nhận phí ship", đơn vẫn đặt được.
                // Hỗ trợ phí ship của quán áp THỐNG NHẤT trên phí bảng (mục
                // 4.3); KM phí ship/freeship trừ tiếp ở bước 5/5b như cũ.
                $shippingFee = 0;
                $distanceKm = null;
                $shipNote = null;
                if ($validated['order_type'] === 'delivery') {
                    $branch = Branch::find($validated['branch_id']);
                    $distanceKm = $this->pinnedDistanceKm($branch, $validated);
                    if ($distanceKm !== null) {
                        $shippingFee = (int) $this->calcShipFee($distanceKm);
                        $deliveryService = app(\App\Services\Delivery\DeliveryService::class);
                        $shippingFee = (int) $deliveryService->applySupport((int) $subtotal, $shippingFee)['charged'];
                    } else {
                        $shipNote = 'Quán xác nhận phí ship';
                    }
                }


                $discountAmount = 0;

                // 4. Voucher — tính riêng, chưa cộng vào tổng
                // (quyết định cộng dồn hay lấy max ở bước 5d theo cờ TỪNG chương trình)
                $voucherDiscount = 0;
                $appliedVoucher = null;
                if (!empty($validated['voucher_code'])) {
                    $voucher = Voucher::where('code', $validated['voucher_code'])
                        ->where('is_active', true)->lockForUpdate()->first();
                    if (!$voucher) throw new Exception('Mã voucher không hợp lệ.');
                    if ($voucher->usage_limit && $voucher->used_count >= $voucher->usage_limit) {
                        throw new Exception('Voucher đã hết lượt sử dụng.');
                    }
                    if ($voucher->expires_at && now()->isAfter($voucher->expires_at)) {
                        throw new Exception('Voucher đã hết hạn.');
                    }
                    // Gói 55 p11ac: kiểm tra thời gian bắt đầu hiệu lực
                    if ($voucher->starts_at && now()->isBefore($voucher->starts_at)) {
                        throw new Exception('Voucher chưa đến thời gian áp dụng.');
                    }
                    if ($subtotal < $voucher->min_order_amount) {
                        throw new Exception('Chưa đạt giá trị tối thiểu của voucher.');
                    }
                    // Gói 55 p11af (P0-12): giới hạn số lần mỗi khách được dùng voucher
                    if ($voucher->per_customer_limit && $customer) {
                        $usedTimes = VoucherUsage::where('voucher_id', $voucher->id)
                            ->where('customer_id', $customer->id)
                            ->lockForUpdate()
                            ->count();
                        if ($usedTimes >= $voucher->per_customer_limit) {
                            throw new Exception('Bạn đã dùng hết lượt của mã khuyến mãi này.');
                        }
                    }
                    $voucherDiscount = $voucher->type === 'fixed'
                        ? (float) $voucher->value
                        : ($subtotal * (float) $voucher->value) / 100;
                    if ($voucher->max_discount_amount) {
                        $voucherDiscount = min($voucherDiscount, (float) $voucher->max_discount_amount);
                    }
                    $voucherDiscount = min($voucherDiscount, $subtotal);
                    $appliedVoucher = $voucher;
                    // used_count chỉ tăng khi voucher thực sự được áp dụng (xem bước 5d)
                }

                // 5. Khuyến mại (validate server) — tính riêng
                $promotionDiscount = 0;
                $appliedPromotion = null;
                $shippingDiscount = 0; // Gói 10c
                $shippingPromotion = null; // Gói 10c
                $giftLinePending = null;
                // SPEC-02: coupon từ ví cá nhân (quy tắc 1 hóa đơn = 1 coupon)
                // Panel Ưu đãi §4 (2026-11-14, Đại Vương duyệt): coupon ví đi
                // MỘT MÌNH thì đứng vào phía KM như cũ; đi CÙNG promotion_id
                // thì đứng ở PHÍA COUPON (biến $couponDiscount/$couponSourcePromo
                // ở dưới) để §5d xét cặp (KM + coupon ví).
                $appliedCoupon = null;
                $couponStackPromo = null; // chương trình nguồn của phía KM để xét cờ chồng mã
                $couponIsShipping = false; // coupon KM phí ship: không tham gia so sánh tiền hàng
                $couponIsMoney = false; // coupon giảm tiền hàng: thua chồng mã thì không bị trừ lượt
                $couponDiscount = 0; // giảm tiền hàng của coupon ví ở vai PHÍA COUPON (chỉ khi đi cùng promotion_id)
                $couponSourcePromo = null; // chương trình nguồn của coupon ví ở vai phía coupon (xét cờ chồng phía coupon)
                if (!empty($validated['customer_coupon_id'])) {
                    // Phần B: coupon ví là quyền lợi cá nhân — chỉ cấp khi định danh đã xác thực
                    if (!$identityVerified) {
                        throw new Exception(\App\Services\PromotionService::reasonText('NOT_VERIFIED'));
                    }
                    $coupon = \App\Models\CustomerCoupon::with('promotion')
                        ->lockForUpdate()
                        ->findOrFail($validated['customer_coupon_id']);
                    // Kiểm tra chủ sở hữu
                    if ((int) $coupon->customer_id !== (int) $customer->id) {
                        throw new Exception('Coupon không thuộc về bạn.');
                    }
                    if (!$coupon->isUsable()) {
                        throw new Exception('Coupon đã hết hạn hoặc đã dùng.');
                    }
                    $promo = $coupon->promotion;
                    if (!$promo) {
                        throw new Exception('Ưu đãi không còn hiệu lực.');
                    }
                    // Phần A: kiểm ĐỦ điều kiện chương trình như đường promotion_id
                    // (cửa sổ hiệu lực, thứ, khung giờ, kênh, hạng, đơn tối thiểu, phạm vi)
                    $chk = $promotionService->checkConditions($promo, [
                        'subtotal' => $subtotal,
                        'items' => $promoItems,
                        'customer' => $customer,
                        'channel' => 'online',
                        'shipping_fee' => $shippingFee,
                    ]);
                    if (!$chk['ok']) {
                        throw new Exception($chk['message']);
                    }
                    // Phần A: kiểm lại trigger tại thời điểm dùng
                    $trig = $promotionService->checkTrigger($promo, $coupon, $customer);
                    if (!$trig['ok']) {
                        throw new Exception($trig['message']);
                    }
                    // Tính giảm THEO PHẠM VI bằng hàm chung (khớp đường promotion_id).
                    // Loại chưa hỗ trợ → từ chối rõ ràng; transaction rollback nên coupon
                    // KHÔNG bị đánh dấu used khi giảm 0 do không hỗ trợ.
                    $calc = $promotionService->discountFor($promo, $subtotal, $promoItems, $shippingFee);
                    if ($calc['unsupported']) {
                        throw new Exception(\App\Services\PromotionService::reasonText('UNSUPPORTED_TYPE', $promo));
                    }
                    if ($calc['is_shipping']) {
                        $couponIsShipping = true;
                        $shippingDiscount = min((float) $calc['discount'], $shippingFee);
                        $shippingFee = max(0, $shippingFee - $shippingDiscount);
                        $shippingPromotion = $promo;
                    } elseif ($calc['gift_product_id']) {
                        $giftProduct = Product::findOrFail($calc['gift_product_id']);
                        $giftLinePending = [
                            'product_id' => $giftProduct->id,
                            'product_option_id' => null,
                            'product_name' => $giftProduct->name . ' (Coupon tặng)',
                            'price' => 0, 'unit_price' => 0,
                            'quantity' => $calc['gift_quantity'],
                            'subtotal' => 0, 'total_price' => 0, 'discount_amount' => 0,
                            'note' => 'Quà tặng từ coupon: ' . $promo->name,
                        ];
                        $appliedPromotion = $promo;
                    } else {
                        $couponIsMoney = true;
                        if (!empty($validated['promotion_id'])) {
                            // Panel Ưu đãi §4: đi cùng promotion_id → coupon ví
                            // ở PHÍA COUPON, không chiếm phía KM; cặp được
                            // §5d phân xử theo cờ chồng của cả hai phía.
                            $couponDiscount = min((float) $calc['discount'], $subtotal);
                            $couponSourcePromo = $promo;
                        } else {
                            $promotionDiscount = min((float) $calc['discount'], $subtotal);
                            $appliedPromotion = $promo;
                        }
                    }
                    $appliedCoupon = $coupon;
                    // coupon ví chỉ đứng vào phía KM (nguồn cờ $couponStackPromo)
                    // khi đi một mình; ở vai phía coupon, nguồn cờ của nó là
                    // $couponSourcePromo.
                    if (empty($validated['promotion_id'])) {
                        $couponStackPromo = $promo;
                    }
                }
                // Panel Ưu đãi §4: phía KM chạy ĐỘC LẬP với khối coupon ví ở
                // trên (trước đây là nhánh elseif loại trừ nhau — gửi cả
                // promotion_id + customer_coupon_id thì coupon ví nuốt mất
                // phía KM). Payload chỉ gửi một phía thì hành vi y như cũ.
                if (!empty($validated['promotion_id'])) {
                    $eligible = $promotionService->eligiblePromotions([
                        'subtotal' => $subtotal,
                        'items' => $promoItems,
                        // Phần B: KM theo hạng chỉ khi định danh đã xác thực
                        'customer_id' => $identityVerified ? $customer->id : null,
                        'channel' => 'online',
                        'shipping_fee' => $shippingFee, // Gói 10c: để tính KM phí ship
                    ]);
                    $found = collect($eligible)->firstWhere('id', (int) $validated['promotion_id']);
                    if (!$found) throw new Exception('Khuyến mại không còn hiệu lực.');
                    $appliedPromotion = Promotion::findOrFail($validated['promotion_id']);
                    // Gói 10c: KM phí ship -> trừ thẳng vào phí ship, không cộng vào discount chung
                    if ($appliedPromotion->type === 'shipping') {
                        $shippingDiscount = min((float) $found['discount'], $shippingFee);
                        $shippingFee = max(0, $shippingFee - $shippingDiscount);
                        $shippingPromotion = $appliedPromotion;
                        $appliedPromotion = null;
                    } else {
                        $promotionDiscount = min((float) $found['discount'], $subtotal);
                    }
                    if ($appliedPromotion && $appliedPromotion->type === 'gift' && $appliedPromotion->gift_product_id) {
                        $giftProduct = Product::findOrFail($appliedPromotion->gift_product_id);
                        // Chuẩn bị dòng quà (thêm vào đơn ở bước 5d; gift không tham gia so sánh cộng dồn)
                        $giftLinePending = [
                            'product_id' => $giftProduct->id,
                            'product_option_id' => null,
                            'product_name' => $giftProduct->name . ' (KM tặng)',
                            'price' => 0, 'unit_price' => 0,
                            'quantity' => $appliedPromotion->gift_quantity,
                            'subtotal' => 0, 'total_price' => 0, 'discount_amount' => 0,
                            'note' => 'Quà tặng từ KM: ' . $appliedPromotion->name,
                        ];
                    }
                }

                // 5d. Mô hình cộng dồn MỚI (Đại Vương chốt 2026-10-21 ~22:45, thay
                // Spec 3 cũ): BỎ công tắc toàn cục promo_allow_stack — quyền cộng dồn
                // nằm ở TỪNG chương trình: phía KM stack_with_coupon + voucher
                // stack_with_promotion cùng bật mới thành 1 cặp KM + 1 coupon.
                // - Có cặp hợp lệ: so tổng cặp với từng lựa chọn đơn lẻ SAU trần —
                //   áp phần lợi nhất; cặp hòa KM đơn lẻ → KM đơn lẻ (giữ voucher).
                // - Không có cặp: chọn phần lợi nhất KM/voucher; hòa → KM thắng,
                //   voucher/coupon thua không bị trừ (luật hòa đã chốt ở Spec 3).
                // - KM phí ship / tặng món không tham gia xét cộng dồn.
                // - Trần: tổng giảm giá KM không vượt promo_max_discount_pct % subtotal.
                $maxDiscountPct = (float) Setting::get('promo_max_discount_pct', 50);
                $capAmount = ($maxDiscountPct > 0 && $maxDiscountPct < 100)
                    ? $subtotal * $maxDiscountPct / 100
                    : $subtotal;
                $stackPromo = $couponStackPromo ?? $appliedPromotion;
                $pairAllowed = $appliedVoucher && $stackPromo
                    && $promotionDiscount > 0 && $voucherDiscount > 0
                    && (bool) $stackPromo->stack_with_coupon
                    && (bool) $appliedVoucher->stack_with_promotion;
                $promoSingle = $promotionDiscount > 0 ? min($promotionDiscount, $capAmount) : 0;
                $voucherSingle = $voucherDiscount > 0 ? min($voucherDiscount, $capAmount) : 0;
                $pairTotal = $pairAllowed ? min($voucherDiscount + $promotionDiscount, $capAmount) : 0;
                // Panel Ưu đãi §4 (Đại Vương duyệt 2026-11-14 ~23:44): cặp
                // (phía KM + coupon ví) — cùng luật với cặp voucher: cả hai
                // phía cùng bật cờ chồng phía mình, cả hai phần giảm > 0,
                // xét cùng trần; cặp chỉ áp khi lợi hơn HẲN mọi lựa chọn
                // còn lại. Payload có cả 2 phía coupon (coupon ví + voucher
                // gõ tay): cặp coupon ví xét trước theo thứ tự ưu tiên của
                // spec; không thắng thì rơi về luật cũ nguyên vẹn ở dưới.
                $walletPairAllowed = $couponDiscount > 0 && $promotionDiscount > 0
                    && $appliedPromotion && $couponSourcePromo
                    && (bool) $appliedPromotion->stack_with_coupon
                    && (bool) $couponSourcePromo->stack_with_coupon;
                $couponSingle = $couponDiscount > 0 ? min($couponDiscount, $capAmount) : 0;
                $walletPairTotal = $walletPairAllowed ? min($promotionDiscount + $couponDiscount, $capAmount) : 0;
                $walletPairWins = false;
                if ($walletPairAllowed) {
                    $walletPairWins = $appliedVoucher
                        ? $walletPairTotal > ($pairAllowed ? $pairTotal : max($promoSingle, $voucherSingle))
                        : ($walletPairTotal > $promoSingle && $walletPairTotal > $couponSingle);
                }
                if ($walletPairWins) {
                    // Cặp KM + coupon ví thắng: áp tổng cặp sau trần. Voucher
                    // gõ tay (nếu có) là phía coupon thua theo thứ tự ưu
                    // tiên → giữ nguyên không trừ lượt; coupon ví tiêu thụ
                    // qua $appliedCoupon ở bước sau như khi áp đơn lẻ;
                    // phía KM giữ nguyên ghi nhận.
                    $discountAmount = $walletPairTotal;
                    $appliedVoucher = null;
                } elseif ($pairAllowed && $pairTotal > $promoSingle && $pairTotal > $voucherSingle) {
                    // Cặp thắng hẳn cả hai lựa chọn đơn lẻ → áp cặp, voucher bị trừ lượt;
                    // phía KM (KM thường hoặc coupon ví) giữ nguyên ghi nhận như cũ.
                    $discountAmount = $pairTotal;
                    $appliedVoucher->increment('used_count');
                    // Coupon ví ở vai phía coupon (nếu có) không thuộc cặp
                    // này → không tiêu thụ, ở lại ví.
                    if ($couponDiscount > 0) {
                        $appliedCoupon = null;
                    }
                } else {
                    // Panel Ưu đãi §4: không có voucher gõ tay mà có coupon
                    // ví ở phía coupon → coupon đấu ĐƠN LẺ với phía KM:
                    // thắng hẳn mới áp (ghi nhận chương trình nguồn như
                    // coupon đi một mình); hòa/thua → phía KM thắng, coupon
                    // ở lại ví (tiền lệ C3.5). Có voucher gõ tay → rơi về
                    // luật cũ ở khối dưới; coupon ví không thuộc đường đó
                    // nên không tiêu thụ.
                    $walletSingleHandled = false;
                    if (!$appliedVoucher && $couponDiscount > 0) {
                        $walletSingleHandled = true;
                        if ($couponDiscount > $promotionDiscount) {
                            $discountAmount = $couponDiscount;
                            $appliedPromotion = $couponSourcePromo;
                            $promotionDiscount = $couponDiscount;
                        } else {
                            $discountAmount = $promotionDiscount;
                            $appliedCoupon = null;
                        }
                    }
                    if (!$walletSingleHandled) {
                    if ($couponDiscount > 0) {
                        $appliedCoupon = null;
                    }
                    $discountAmount = max($voucherDiscount, $promotionDiscount);
                    // TESTER duyệt spec 3 — điểm hòa (2026-10-21, PM chốt): HÒA → KM thắng.
                    // Voucher chỉ thắng khi LỚN HƠN HẲN (>); hòa thì voucher/coupon GIỮ NGUYÊN
                    // không bị trừ lượt (coupon là tài sản của khách, KM theo thời gian dùng trước).
                    // Phía KM giữ >= ở $promoWins bên dưới để nhất quán.
                    $voucherWins = $appliedVoucher && $voucherDiscount > 0 && $voucherDiscount > $promotionDiscount;
                    if ($voucherWins) {
                        $appliedVoucher->increment('used_count');
                    } else {
                        $appliedVoucher = null;
                    }
                    $promoWins = $appliedPromotion && $appliedPromotion->type !== 'gift' && $promotionDiscount > 0
                        && $promotionDiscount >= $voucherDiscount;
                    if (!$promoWins) {
                        $appliedPromotion = null;
                        $promotionDiscount = 0;
                        // Phần C3.5: coupon ví thua chồng mã → KHÔNG đánh dấu đã dùng,
                        // coupon ở lại trong ví của khách (chỉ áp cho coupon giảm tiền hàng;
                        // coupon tặng món/phí ship không tham gia so sánh nên vẫn áp bình thường).
                        if ($appliedCoupon && $couponIsMoney) {
                            $appliedCoupon = null;
                        }
                    }
                    }
                }
                if ($giftLinePending) {
                    $orderItemsData[] = $giftLinePending;
                }
                if ($maxDiscountPct > 0 && $maxDiscountPct < 100) {
                    $discountAmount = min($discountAmount, $subtotal * $maxDiscountPct / 100);
                }

                // 6. Loyalty 2.0 (2026-10-21): trừ điểm trực tiếp vào đơn ĐÃ GỠ
                // (spec mục 4.2) — điểm chỉ còn đường ra là đổi coupon ở Cửa hàng
                // điểm. Client cũ còn gửi points_redeem → bỏ qua im lặng (không
                // trừ điểm, không lỗi) để tương thích app chưa cập nhật.
                $pointsUsed = 0;

                $discountAmount = min($discountAmount, $subtotal + $shippingFee);
                $finalAmount = $subtotal + $shippingFee - $discountAmount;

                // Gói mở COD giao hàng (2026-11-11): cộng phí thu hộ COD SAU
                // mọi lớp hỗ trợ phí + KM phí ship ở trên — khoản này là chi
                // phí thu hộ chuyển tiếp, KHÔNG bị freeship/KM nuốt (kể cả
                // khi phí khoảng cách về 0 hoặc đơn không có tọa độ).
                // Snapshot vào cột shipping_cod_fee lúc tạo đơn ở bước 7.
                if ($shippingCodFee > 0) {
                    $shippingFee += $shippingCodFee;
                    $finalAmount += $shippingCodFee;
                }

                // 6b. Gói 10c: dòng "Phí dịch vụ" — CHỈ thêm khi giao hàng và phí (sau KM) > 0
                if ($validated['order_type'] === 'delivery' && $shippingFee > 0) {
                    $feeProduct = Product::where('is_service_fee', true)->firstOrFail();
                    $orderItemsData[] = [
                        'product_id' => $feeProduct->id,
                        'product_option_id' => null,
                        'product_name' => 'Phí dịch vụ',
                        'price' => $shippingFee,
                        'unit_price' => $shippingFee,
                        'quantity' => 1,
                        'subtotal' => $shippingFee,
                        'total_price' => $shippingFee,
                        'discount_amount' => 0,
                        'note' => 'Phí giao hàng' . ($distanceKm !== null ? " ({$distanceKm}km)" : ' (quán xác nhận)')
                            . ($shippingDiscount > 0 ? ' — đã giảm ' . number_format($shippingDiscount, 0) . 'đ từ KM' : ''),
                    ];
                }

                // 7. Tạo đơn — CHỜ XÁC NHẬN (chưa trừ kho, chưa tích điểm)
                // Gói 57: snapshot phí sàn kênh online lúc tạo đơn
                // Spec kênh bán hàng (2026-10-19): dùng mã chuẩn 'online' (kênh Zalo Mini App)
                $zaloPriceList = \App\Models\PriceList::whereRaw('LOWER(code) = ?', ['online'])->first();
                $zaloCommissionRate = $zaloPriceList ? (float) $zaloPriceList->commission_rate : 0;
                $zaloCommissionAmount = $zaloCommissionRate > 0 ? (int) round($finalAmount * $zaloCommissionRate / 100) : 0;
                $orderCode = Order::nextCode();
                $order = Order::create([
                    'user_id' => null,
                    'branch_id' => $validated['branch_id'],
                    'order_type' => $validated['order_type'],
                    'online_channel' => 'zalo',
                    'commission_rate' => $zaloCommissionRate,
                    'commission_amount' => $zaloCommissionAmount,
                    // Fix rà mã 2026-10-20: dùng chung Order::nextCode() (quy tắc Thiết lập)
                    // thay hardcode ONL-/ZL-; order_number = mã đơn như luồng import.
                    'order_number' => $orderCode,
                    'code' => $orderCode,
                    'client_key' => $validated['client_key'] ?? null, // Gói 55 p11ac
                    'customer_id' => $customer->id,
                    'customer_name' => $validated['customer_name'],
                    'customer_phone' => $validated['customer_phone'],
                    'referred_by' => $validated['referred_by'] ?? $customer->referred_by,
                    'zalo_user_id' => $validated['zalo_user_id'] ?? null,
                    'delivery_address' => $validated['delivery_address'] ?? null,
                    'distance_km' => $distanceKm, // Gói 55 p11ac: server tự tính
                    'delivery_note' => trim(($validated['delivery_note'] ?? '') . ($shipNote ? (!empty($validated['delivery_note']) ? ' | ' : '') . $shipNote : '')), // FIX #43: điều kiện trong từng dùng $validated['delivery_note'] không ?? — thiếu trường + có ghi chú ship là nổ lỗi, chặn cả đơn giao
                    'shipping_fee' => $shippingFee,
                    'shipping_cod_fee' => $shippingCodFee, // Gói mở COD giao hàng 2026-11-11: snapshot trong shipping_fee
                    'shipping_discount' => $shippingDiscount, // Gói 10c
                    'shipping_promotion_id' => $shippingPromotion?->id, // Gói 10c
                    'scheduled_at' => $validated['scheduled_at'] ?? null,
                    'subtotal_amount' => $subtotal + $shippingFee,
                    'discount_amount' => $discountAmount,
                    'voucher_code' => $appliedVoucher ? $appliedVoucher->code : null,
                    'promotion_id' => $appliedPromotion ? $appliedPromotion->id : null,
                    'promotion_discount' => $promotionDiscount,
                    'points_redeemed' => $pointsUsed,
                    'total_amount' => $finalAmount,
                    'payment_method' => $validated['payment_method'],
                    'payment_status' => 'pending',
                    'status' => 'pending',
                    'stock_deducted' => false,
                    'note' => $validated['note'] ?? null,
                    // Gói 64: bỏ xuất VAT trên đơn online (giữ cột DB, luôn false)
                    'need_vat_invoice' => false,
                    'vat_tax_code' => null,
                    'vat_company_name' => null,
                    'vat_company_address' => null,
                    'vat_email' => null,
                    'province' => $validated['province'] ?? null,
                    'ward' => $validated['ward'] ?? null,
                    // Gói 60: gói giao hàng khách chọn + phí đã khóa lúc chốt đơn
                    // Gói 61b: lưu hãng của gói khách chọn (không để createForOrder tự đoán)
                    'delivery_package' => $validated['delivery_package'] ?? 'nhanh',
                    'delivery_provider' => $validated['delivery_provider'] ?? null,
                    // Spec phí giao MỘT NGUỒN: cột này là TRUY VẾT phí hãng —
                    // chỉ ghi khi tạo đơn hãng ở khâu điều phối (khởi tạo null);
                    // client cũ còn gửi delivery_quoted_fee thì server bỏ qua.
                    'delivery_quoted_fee' => null,
                    'delivery_fee_charged' => $shippingFee,
                    // Gói 61b: tọa độ điểm giao để hãng báo giá/tạo đơn chính xác
                    'delivery_dropoff_lat' => $validated['delivery_dropoff_lat'] ?? null,
                    'delivery_dropoff_lng' => $validated['delivery_dropoff_lng'] ?? null,
                    // Gói geocode lai NDAMaps (2026-11-13): nguồn điểm giao
                    'dropoff_source' => $validated['dropoff_source'] ?? null,
                ]);

                foreach ($orderItemsData as $itemData) {
                    $order->items()->create($itemData);
                }

                // Loyalty 2.0: không còn trừ điểm tại đơn (applyRedeem đã ngừng gọi)

                // Gói 55 p11af (P0-12): ghi log lượt dùng voucher theo khách
                if ($appliedVoucher && $customer) {
                    VoucherUsage::create([
                        'voucher_id' => $appliedVoucher->id,
                        'customer_id' => $customer->id,
                        'order_id' => $order->id,
                        'used_at' => now(),
                    ]);
                }

                // SPEC-02: đánh dấu coupon đã dùng (trong cùng transaction)
                if ($appliedCoupon) {
                    $appliedCoupon->update([
                        'status' => 'used',
                        'used_at' => now(),
                        'used_order_id' => $order->id,
                    ]);
                }

                return $order->load(['items.product', 'customer']);
                });
            };

            // Sổ #92: thử lại tối đa 3 lần CHỈ với lỗi SQL tạm thời — 1062 (đua
            // mã đơn hoặc đua client_key) và 1213 (deadlock). Mỗi lần thử lại:
            // ô kiểm client_key (Gói 55 p11ac) chạy lại trước — thấy đơn sinh
            // đôi đã commit thì trả đơn cũ, không tạo đơn thứ hai; còn đua mã
            // thì nextCode trong closure sinh mã mới theo count đã cập nhật.
            // Mọi lỗi khác ném thẳng ra catch ngoài, hành vi giữ nguyên.
            $order = null;
            for ($attempt = 1; $attempt <= 3; $attempt++) {
                if (!empty($validated['client_key'])) {
                    $existing = Order::with('items')->where('client_key', $validated['client_key'])->first();
                    if ($existing) {
                        return response()->json(['success' => true, 'message' => 'Đơn đã được tạo trước đó', 'data' => $existing, 'duplicate' => true]);
                    }
                }
                try {
                    $order = $createOrder();
                    break;
                } catch (\Illuminate\Database\QueryException $qe) {
                    $sqlCode = (int) ($qe->errorInfo[1] ?? 0);
                    if ($attempt >= 3 || !in_array($sqlCode, [1062, 1213], true)) {
                        throw $qe;
                    }
                    usleep(30000 * $attempt + random_int(0, 30000));
                }
            }

            return response()->json([
                'success' => true,
                'message' => 'Đặt món thành công! Quán sẽ xác nhận đơn của bạn.',
                'data' => $order,
            ], 201);
        } catch (Exception $e) {
            // Gói SEC2: race idempotency — 2 request cùng client_key song song, 1 request
            // qua check nhưng dính unique violation khi insert → trả về đơn đã tạo thay vì 400
            $clientKey = $validated['client_key'] ?? null;
            if ($clientKey && $e instanceof \Illuminate\Database\QueryException && ($e->errorInfo[1] ?? null) == 1062) {
                $existing = Order::with('items')->where('client_key', $clientKey)->first();
                if ($existing) {
                    return response()->json(['success' => true, 'message' => 'Đơn đã được tạo trước đó', 'data' => $existing, 'duplicate' => true]);
                }
            }
            // Sổ #92 — Vá L: ghi log TRƯỚC khi trả 400 (trước đây catch này nuốt
            // lỗi im lặng, không qua clientErrorMessage() vốn có ghi log).
            \Illuminate\Support\Facades\Log::error('[OnlineOrder] store failed', [
                'exception' => get_class($e),
                'sql_code' => $e instanceof \Illuminate\Database\QueryException ? (int) ($e->errorInfo[1] ?? 0) : null,
                'client_key' => $validated['client_key'] ?? null,
                'branch_id' => $validated['branch_id'] ?? null,
                'message' => $e->getMessage(),
            ]);
            // Gói SEC2: không lộ message SQL thô ra client
            $message = $e instanceof \Illuminate\Database\QueryException
                ? 'Có lỗi xảy ra. Vui lòng thử lại.'
                : $e->getMessage();
            return response()->json(['success' => false, 'message' => $message], 400);
        }
    }

    // Theo dõi đơn hàng theo mã (public)
    /**
     * Gói 12a + phán Đại Vương 2026-11-09: đơn có quá hạn tra cứu trên Mini App không?
     * - Đơn chưa kết thúc: luôn xem được (kể cả qua ngày).
     * - Đơn đã kết thúc (hoàn thành/hủy): chỉ xem trong 24h kể từ mốc kết
     *   thúc (completed_at / cancelled_at; thiếu dấu thì dùng updated_at).
     */
    private function isExpiredForMiniApp(Order $order): bool
    {
        // Phán Đại Vương 2026-11-09: cổng áp cho cả hai trạng thái KẾT THÚC
        // (hoàn thành + hủy) — trước đây chỉ khóa 'completed' nên đơn hủy
        // tra cứu được vĩnh viễn. Khuôn này phải khớp truy vấn danh sách
        // ở customer() — sửa một nơi thì sửa cả hai.
        if (!in_array($order->status, ['completed', 'cancelled'], true)) {
            return false;
        }
        // Mốc kết thúc theo trạng thái; đơn cũ thiếu dấu mốc thì dùng
        // updated_at (khuôn fallback của Gói 12a).
        $doneAt = ($order->status === 'cancelled' ? $order->cancelled_at : $order->completed_at) ?? $order->updated_at;
        return $doneAt && $doneAt->lte(now()->subHours(24));
    }

    public function track(Request $request, string $code): JsonResponse
    {
        $order = Order::with(['items.product', 'promotion'])
            ->where('code', $code)
            ->where('online_channel', 'zalo')
            ->firstOrFail();

        // Audit 2026-10-23 BM-03: mã đơn liệt kê được theo ngày — tra cứu bắt buộc
        // SĐT khớp SĐT đặt đơn (như cancel), chuẩn hóa +84/84 -> 0, so hash_equals.
        // Sai/thiếu SĐT trả 404 chung để không lộ đơn có tồn tại hay không.
        $norm = function ($p) {
            $d = preg_replace('/[^0-9]/', '', (string) $p);
            if (str_starts_with($d, '84') && strlen($d) >= 11) {
                $d = '0' . substr($d, 2);
            }
            return $d;
        };
        $reqPhone = $norm($request->query('phone', ''));
        $orderPhone = $norm($order->customer_phone);
        if ($reqPhone === '' || $orderPhone === '' || !hash_equals($orderPhone, $reqPhone)) {
            return response()->json(['success' => false, 'message' => 'Không tìm thấy đơn hoặc SĐT không khớp.'], 404);
        }

        // Gói 12a + phán 2026-11-09: đơn đã kết thúc (hoàn thành/hủy) quá
        // 24h kể từ mốc kết thúc thì ẩn khỏi Mini App
        // (server vẫn giữ đủ để tính điểm và hạng thành viên).
        if ($this->isExpiredForMiniApp($order)) {
            return response()->json(['success' => false, 'message' => 'Đơn đã quá hạn tra cứu.'], 404);
        }

        // Spec QR 2026-10-21: đơn BANK chưa được xác nhận tiền → trả kèm thông tin CK
        // để trang Theo dõi hiện lại khối thanh toán (QR + STK + nội dung CK).
        $awaitingPayment = $order->pay_channel === 'BANK'
            && in_array($order->payment_status, ['pending_payment', 'transfer_notified'], true)
            && $order->status !== 'cancelled';

        // Khối phân rã giá cho màn Theo dõi (Đại Vương lệnh 2026-11-14): mọi
        // số lấy từ chính các cột đã lưu trên đơn lúc tạo (phân xử §5d) —
        // tiền hàng + phí ship − giảm KM − phần voucher = total_amount.
        // subtotal_amount lưu = tiền hàng + phí ship CUỐI (đã trừ KM phí
        // ship, đã gồm phí thu hộ COD trong shipping_fee).
        $shipFeeVal = (float) $order->shipping_fee;
        $itemsTotalVal = (float) $order->items->sum(fn($i) => (float) $i->unit_price * (float) $i->quantity);
        $goodsSubtotal = ((float) $order->subtotal_amount > 0
            ? (float) $order->subtotal_amount
            : $itemsTotalVal) - $shipFeeVal;
        $promoDiscountVal = (float) $order->promotion_discount;
        $discountTotalVal = (float) $order->discount_amount;
        // Coupon ví đã dùng cho đơn này (nếu có): lấy mã cá nhân để màn
        // Theo dõi gọi đúng "Coupon {mã}" như Checkout.
        $usedCoupon = \App\Models\CustomerCoupon::where('used_order_id', $order->id)->first();
        // Điểm nối price (PM phán 2026-11-15, từ 🟡 của TESTER): đơn thắng
        // CẶP KM + coupon ví phải phơi phần giảm của coupon ví thành dòng
        // riêng — tách bạch 3 nguồn: KM · coupon ví · voucher gõ tay, và
        // KM + coupon + voucher = discount_amount. Nhận diện cặp: coupon
        // đã tiêu thụ cho đơn này, chương trình nguồn của coupon KHÁC
        // promotion_id của đơn (khi coupon đi một mình thắng, nó đứng ở
        // chính phía KM — khối promotion kèm coupon_code đã đại diện đủ)
        // và khác shipping_promotion_id (coupon phí ship đã nằm ở cụm
        // shipping). Phần giảm của coupon không lưu cột riêng lúc tạo đơn
        // → suy ra = discount_amount − phần KM − phần voucher (phần
        // voucher theo đúng quy ước suy diễn hiện hành của khối voucher).
        $couponBlock = null;
        if ($usedCoupon && $order->promotion_id) {
            $couponPromo = $usedCoupon->promotion;
            if ($couponPromo
                && (int) $order->promotion_id !== (int) $couponPromo->id
                && (int) ($order->shipping_promotion_id ?? 0) !== (int) $couponPromo->id) {
                $voucherPart = $order->voucher_code
                    ? max(0, $discountTotalVal - $promoDiscountVal)
                    : 0;
                $couponPart = $discountTotalVal
                    - min($promoDiscountVal, $discountTotalVal)
                    - $voucherPart;
                if ($couponPart > 0) {
                    $couponBlock = [
                        'code' => $usedCoupon->code,
                        'name' => $couponPromo->name,
                        'discount' => $couponPart,
                    ];
                }
            }
        }
        $price = [
            'goods_subtotal' => $goodsSubtotal,
            // Cụm phí giao lồng theo spec màn Chờ thanh toán phương án C
            // mục 3 (khóa 2026-11-14): fee khách trả · cod_fee đã gộp trong
            // fee · discount giảm phí giao · promotion_name chương trình.
            'shipping' => [
                'fee' => $shipFeeVal,
                'cod_fee' => (float) $order->shipping_cod_fee,
                'discount' => (float) $order->shipping_discount,
                'promotion_name' => $order->shipping_promotion_id
                    ? Promotion::find($order->shipping_promotion_id)?->name
                    : null,
            ],
            'promotion' => $order->promotion_id ? [
                'name' => $order->promotion?->name,
                'discount' => $promoDiscountVal,
                'coupon_code' => $usedCoupon?->code,
            ] : null,
            // Coupon ví ở vai PHÍA COUPON của cặp thắng (xem ghi chú suy
            // diễn phía trên); null ở mọi trường hợp còn lại.
            'coupon' => $couponBlock,
            'voucher' => $order->voucher_code ? [
                'code' => $order->voucher_code,
                'name' => Voucher::where('code', $order->voucher_code)->first()?->name,
                'discount' => max(0, $discountTotalVal - $promoDiscountVal),
            ] : null,
            'discount_amount' => $discountTotalVal,
            'total_amount' => (float) $order->total_amount,
        ];

        return response()->json(['success' => true, 'data' => [
            'code' => $order->code,
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'payment_method' => $order->payment_method,
            'pay_channel' => $order->pay_channel,
            'customer_notified_at' => $order->customer_notified_at,
            // Lát 3c (2026-11-04): SĐT chi nhánh cho dòng "gọi quán để hủy" phía
            // Mini App — đơn đã báo chuyển khoản không hủy online được (luật
            // 2026-10-26) nên khách cần số quán ngay trên trang theo dõi/chờ TT.
            'branch_phone' => $order->branch?->phone,
            'transfer' => $awaitingPayment
                ? app(\App\Services\ZaloPaymentService::class)->transferInfoForOrder($order)
                : null,
            'order_type' => $order->order_type,
            'total_amount' => (float) $order->total_amount,
            'shipping_fee' => (float) $order->shipping_fee,
            'price' => $price,
            'scheduled_at' => $order->scheduled_at,
            'created_at' => $order->created_at,
            // Gói 60: thông tin giao hàng cho trang theo dõi đơn (poll 5s)
            'delivery' => $order->order_type === 'delivery' ? [
                // S15: địa chỉ giao hàng khách đã nhập — trang theo dõi hiện lại để khách tự kiểm
                'address' => $order->delivery_address,
                'provider' => $order->delivery_provider,
                'provider_label' => $order->delivery_provider === 'ahamove' ? 'AhaMove'
                    : ($order->delivery_provider === 'lalamove' ? 'Lalamove'
                    // Spec KDS book ship mục 7: chế độ tay hiển thị "Quán tự giao"
                    : ($order->delivery_provider === 'manual' ? 'Quán tự giao' : null)),
                'status' => $order->delivery_status,
                'status_label' => \App\Services\Delivery\DeliveryService::labels()[$order->delivery_status] ?? null,
                // Spec KDS book ship mục 8 C2: lý do giao thất bại (nếu có) để
                // app khách hiện thống nhất cả 2 chế độ
                'failure_reason' => $order->delivery_status === \App\Services\Delivery\DeliveryService::ST_FAILED
                    ? (\App\Models\DeliveryLog::where('order_id', $order->id)
                        ->whereIn('event', ['manual.failed', 'delivery.failed'])
                        ->orderByDesc('created_at')->first()?->payload['reason'] ?? null)
                    : null,
                'package' => $order->delivery_package,
                'tracking_url' => $order->delivery_tracking_url,
                'driver_name' => $order->delivery_driver_name,
                'driver_phone' => $order->delivery_driver_phone,
                'driver_plate' => $order->delivery_driver_plate,
                'failover_from' => $order->delivery_failover_from,
            ] : null,
            'items' => $order->items->map(fn($i) => [
                'name' => $i->product_name,
                'quantity' => $i->quantity,
                'unit_price' => (float) $i->unit_price,
                'note' => $i->note,
            ]),
        ]]);
    }

    // Gói vá sau vòng S — Mục 4 (PM phán Phương án A 2026-11-12, trong khuôn
    // phán quyết "nút Đã chuyển khoản" 2026-11-11 ~17:30): khách bấm "Đã
    // chuyển khoản" trên màn chờ MỚI (sau khi gỡ TransferGuide) — CHỈ ghi
    // mốc giờ khách bấm vào customer_notified_at để NV ưu tiên đối chiếu
    // sao kê (Admin/KDS đã có chỗ hiển thị mốc này), TUYỆT ĐỐI không đổi
    // payment_status: tiền chỉ ghi nhận qua notify Zalo + NV xác nhận.
    // Khác đường báo CK cũ trong TransferGuide (lật cả trạng thái — đã gỡ
    // ở gói dọn mồ côi 2026-11-13; luật hủy 2026-10-26 đọc payment_status
    // + mốc customer_notified_at nên không đổi).
    // Idempotent: đã có mốc thì giữ nguyên mốc đầu. Chỉ ghi khi đơn BANK
    // còn pending_payment. Gác SĐT khớp đơn như cancel.
    public function transferMark(Request $request, string $code): JsonResponse
    {
        $validated = $request->validate([
            'phone' => 'required|string|max:20',
        ]);
        $order = Order::where('code', $code)->where('online_channel', 'zalo')->firstOrFail();

        $norm = function ($p) {
            $d = preg_replace('/[^0-9]/', '', (string) $p);
            if (str_starts_with($d, '84') && strlen($d) >= 11) {
                $d = '0' . substr($d, 2);
            }
            return $d;
        };
        if ($norm($validated['phone']) !== $norm($order->customer_phone)) {
            return response()->json(['success' => false, 'message' => 'Số điện thoại không khớp với đơn hàng.'], 403);
        }
        if ($order->customer_notified_at) {
            return response()->json([
                'success' => true,
                'message' => 'Đã ghi nhận mốc bạn bấm Đã chuyển khoản.',
                'data' => ['code' => $order->code, 'customer_notified_at' => $order->customer_notified_at, 'already' => true],
            ]);
        }
        if ($order->pay_channel !== 'BANK' || $order->payment_status !== 'pending_payment'
            || in_array($order->status, ['cancelled', 'completed'], true)) {
            return response()->json(['success' => false, 'message' => 'Đơn không còn ở trạng thái chờ thanh toán.'], 422);
        }

        $order->update(['customer_notified_at' => now()]);

        return response()->json([
            'success' => true,
            'message' => 'Đã ghi nhận mốc bạn bấm Đã chuyển khoản.',
            'data' => ['code' => $order->code, 'customer_notified_at' => $order->customer_notified_at],
        ]);
    }

    // KH hủy đơn đang chờ xác nhận — Gói SEC2: yêu cầu SĐT khớp với đơn để chống hủy đơn người khác
    public function cancel(Request $request, string $code, LoyaltyService $loyaltyService): JsonResponse
    {
        try {
            $validated = $request->validate([
                'phone' => 'required|string|max:20',
            ]);
            $order = DB::transaction(function () use ($code, $validated, $loyaltyService) {
                $order = Order::where('code', $code)->where('online_channel', 'zalo')->lockForUpdate()->firstOrFail();
                // Xác thực SĐT người hủy khớp với SĐT đặt đơn (chuẩn hóa +84/84 -> 0)
                $norm = function ($p) {
                    $d = preg_replace('/[^0-9]/', '', (string) $p);
                    if (str_starts_with($d, '84') && strlen($d) >= 11) {
                        $d = '0' . substr($d, 2);
                    }
                    return $d;
                };
                $reqPhone = $norm($validated['phone']);
                $orderPhone = $norm($order->customer_phone);
                if ($reqPhone === '' || $orderPhone === '' || !hash_equals($orderPhone, $reqPhone)) {
                    throw new Exception('Số điện thoại không khớp với đơn hàng.');
                }
                // Audit toàn diện 2026-10-21 🟠12: nới cho đơn chờ thanh toán qua
                // Checkout SDK — BANK đang chờ CK (pending_payment) và COD đã được
                // kênh xác nhận (payment 'confirmed', gồm cả đơn cũ kẹt status
                // 'confirmed') vẫn hủy online được: các trạng thái này đều CHƯA vào
                // pha chế và CHƯA trừ kho/thu tiền (NV xác nhận mới trừ kho).
                // Đơn đã trả tiền (paid) hoặc đã sang pha chế → vẫn chặn, gọi quán.
                // Chính sách Đại Vương chốt 2026-10-26: đơn khách ĐÃ BÁO CHUYỂN
                // KHOẢN (transfer_notified) KHÔNG cho hủy online nữa — quán phải
                // đối soát tiền thật trước khi hoàn, khách cần hủy thì gọi quán.
                // Vá A4 (2026-11-12, TESTER §GL): cổng phải nhận CẢ HAI dấu hiệu
                // báo CK — nút "Đã chuyển khoản" MỚI (transferMark) chỉ ghi mốc
                // customer_notified_at, giữ nguyên pending_payment, nên chỉ nhìn
                // trạng thái là lọt. Có mốc báo CK → chặn như transfer_notified.
                if ($order->payment_status === 'transfer_notified' || !empty($order->customer_notified_at)) {
                    throw new Exception('Đơn đã chuyển khoản, không thể hủy online. Vui lòng gọi quán để được hỗ trợ hoàn tiền.');
                }
                $awaitingPay = in_array($order->payment_status, ['pending', 'pending_payment', 'confirmed'], true);
                if (!in_array($order->status, ['pending', 'confirmed'], true) || !$awaitingPay) {
                    throw new Exception('Đơn đang được chuẩn bị, không thể hủy online. Vui lòng gọi quán.');
                }
                $order->status = 'cancelled';
                $order->cancel_reason = 'Khách hủy trên Mini App';
                // N-2 (360 đợt 2): hủy online map mặc định sang mã khách đổi ý
                // (chuỗi cứng trên chỉ ghi tại đúng 1 đường này — Phụ lục khóa).
                $order->cancel_reason_code = CancelReasonCodes::CUSTOMER_CHANGED_MIND;
                $order->cancelled_at = now();
                // Gói 55 p11ag: truy vết người hủy (khách tự hủy online)
                $order->cancelled_by = 'customer:' . $reqPhone;
                $order->cancelled_by_type = 'customer';
                $order->save();

                // Gói 13: hoàn điểm đã đổi qua LoyaltyService (ghi sổ PointTransaction)
                // thay vì cộng thủ công. Đơn chưa xác nhận nên chưa tích điểm -> không cần revokeEarn.
                $loyaltyService->refundRedeem($order);

                // Gói 55 p11ac: hoàn lượt dùng voucher khi KH hủy đơn online
                if (!empty($order->voucher_code)) {
                    \App\Models\Voucher::where('code', $order->voucher_code)
                        ->where('used_count', '>', 0)
                        ->decrement('used_count');
                    // Gói 55 p11af (P0-12): xóa log lượt dùng để hoàn lại lượt cho khách
                    VoucherUsage::where('order_id', $order->id)->delete();
                }

                // 🟠12 (bổ sung cùng gốc): hoàn COUPON VÍ đã tiêu cho đơn bị hủy —
                // tra ngược qua used_order_id, trả coupon về trạng thái chưa dùng.
                \App\Models\CustomerCoupon::where('used_order_id', $order->id)
                    ->where('status', 'used')
                    ->update(['status' => 'active', 'used_at' => null, 'used_order_id' => null]);

                return $order;
            });
            return response()->json(['success' => true, 'message' => 'Đã hủy đơn hàng.']);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Gói 11: khách quét QR tích điểm trên Mini App để gán TV vào đơn POS.
     * Token dùng 1 lần, hết hạn 15 phút. Trả về thông tin TV để POS hiển thị.
     */
    public function claim(Request $request, string $code, LoyaltyService $loyaltyService): JsonResponse
    {
        try {
            $validated = $request->validate([
                'claim_token' => 'required|string',
                'member_code' => 'required|string|max:20',
                'phone' => 'required|string|max:20',
            ]);

            // Gói SEC: lock + check token TRONG transaction (chống quét QR 2 lần)
            DB::transaction(function () use ($code, $validated, $loyaltyService) {
                $order = Order::where('code', $code)->lockForUpdate()->firstOrFail();

                if (!$order->claim_token || !hash_equals($order->claim_token, $validated['claim_token'])) {
                    throw new Exception('Mã QR không hợp lệ hoặc đã được sử dụng.');
                }
                if ($order->claim_expires_at && $order->claim_expires_at->isPast()) {
                    throw new Exception('Mã QR đã hết hạn. Nhờ thu ngân tạo mã mới.');
                }
                // Spec dời mốc tích điểm (2026-11-13 mục 9 + M-08): đơn
                // COMPLETED vẫn gán được — đơn hoàn thành khi chưa gắn
                // khách thì claim là điểm kích hoạt earn (N4); chỉ đơn đã
                // HỦY mới chặn (câu lỗi giữ nguyên văn bản cũ).
                if ($order->status === 'cancelled') {
                    throw new Exception('Đơn đã hoàn thành/hủy, không gán được.');
                }

                $customer = Customer::where('member_code', $validated['member_code'])
                    ->where('phone', $validated['phone'])
                    ->first();
                if (!$customer) {
                    throw new Exception('Không tìm thấy thành viên. Hãy đăng nhập Tài khoản trước.');
                }
                // Spec mật khẩu §3.2: cặp SĐT + mã chết ở mọi endpoint quyền
                // lợi khi tài khoản đã đặt mật khẩu hoặc mã mang tiền tố IMP
                // (cùng thông báo chung như không tìm thấy — không lộ lý do).
                if (!\App\Services\CustomerIdentityService::pairUsable($customer)) {
                    throw new Exception('Không tìm thấy thành viên. Hãy đăng nhập Tài khoản trước.');
                }
                if ($order->customer_id && (int) $order->customer_id !== (int) $customer->id) {
                    throw new Exception('Đơn đã được gán cho thành viên khác.');
                }

                // Gói 55 p11ae: chỉ tích bù khi TV vừa được gán trong lần claim NÀY.
                // Nếu đơn đã có TV từ trước (điểm đã xử lý lúc tạo/thanh toán), claim lại bằng
                // QR mới với đơn 0 điểm (points_earned = 0 là falsy) sẽ cộng dồn total_spent
                // → leo hạng thành viên gian lận.
                $justAssigned = empty($order->customer_id);
                $order->customer_id = $customer->id;
                $order->claim_token = null;
                $order->claim_expires_at = null;
                $order->save();
                // Spec dời mốc tích điểm (2026-11-13, điểm gọi N4): thay
                // tích bù trực tiếp bằng ĐIỂM CHỐT DUY NHẤT — đơn paid +
                // completed vừa gán khách → earn ngay tại claim; đơn chưa
                // completed → no-op êm, earn chờ funnel hoàn thành (N1).
                // Gói SEC: token đã null sau lần claim đầu nên không thể claim 2 lần.
                if ($justAssigned) {
                    $loyaltyService->earnWhenSettled($order);
                }
            });

            $order = Order::where('code', $code)->first();
            $customer = $order->customer;

            $customer->load('tier');

            return response()->json(['success' => true, 'data' => [
                'order_code' => $order->code,
                'member' => [
                    'name' => $customer->name,
                    'member_code' => $customer->member_code,
                    'tier' => $customer->tier?->name,
                    'points' => $customer->points,
                ],
            ]]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Nhân viên XÁC NHẬN đơn online (đã nhận tiền / đồng ý làm):
     * trừ kho, vào KDS, tích điểm. Cần đăng nhập.
     */
    public function confirmPayment(Request $request, int $id, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        // Audit 2026-10-23 B-2/B-5: NV chỉ xác nhận thanh toán đơn thuộc CN phân công
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $orderBranch = Order::where('id', $id)->value('branch_id');
            if ($orderBranch !== null && !in_array((int) $orderBranch, $this->effectiveBranchScope($actor), true)) {
                return response()->json(['success' => false, 'message' => 'Đơn hàng không thuộc chi nhánh bạn được phân công.'], 403);
            }
        }
        try {
            // Thân nghiệp vụ (trừ kho + paid + tích điểm + coupon + tạo đơn
            // hãng) đã tách sang điểm xác nhận CHUNG OnlinePaymentConfirmer
            // (2026-11-06) để webhook CIA của hãng dùng lại đúng một điểm —
            // controller chỉ giữ kiểm quyền CN + bọc response như cũ.
            $order = Order::findOrFail($id);
            $order = app(\App\Services\OnlinePaymentConfirmer::class)->confirm($order);

            // Gói Checkout SDK (spec §2.5): NV xác nhận tiền BANK đã về →
            // báo 'paid' về Checkout SDK. Fail-soft trong service (chưa
            // cấu hình endpoint thì chỉ ghi log) — không chặn luồng đơn.
            // OnlinePaymentConfirmer giữ nguyên, chỉ thêm điểm gọi ở đây.
            if ($order->pay_channel === 'BANK' && !empty($order->pay_sdk_order_id)) {
                app(\App\Services\ZaloPaymentService::class)->updateOrderStatus($order, 'paid');
            }

            return response()->json([
                'success' => true,
                'message' => 'Đã xác nhận đơn. Đơn đã vào KDS.',
                'data' => $order,
            ]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    // Nút hoàn tác xác nhận thanh toán (spec-hoan-tac-xac-nhan, Đại Vương
    // chốt 2026-11-12): phép đảo của confirm() tại ĐÚNG điểm xác nhận này —
    // đơn VẪN SỐNG, chỉ lùi phần xác nhận tiền (khác hẳn hủy đơn). Quyền
    // dùng chung orders.edit với nút xác nhận (ngài chốt phân quyền
    // 2026-11-12, loại phương án lá riêng) + gác CN NV như confirmPayment.
    // Chuỗi đảo 4 trục trong 1 transaction khóa dòng; điểm/kho tái dùng
    // revokeEarn + restock của đường hủy, không dựng cơ chế đảo thứ hai.
    public function undoPayment(Request $request, int $id, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'nullable|string|max:500|required_if:reason_code,other', // lý do rỗng → 422 ngay ở API (spec T-03) khi mã other
            'reason_code' => ['required', Rule::in(CancelReasonCodes::ALL)], // N-2 (360 đợt 2): cùng danh mục 6 mã với hủy đơn
            'surface' => 'nullable|string|in:admin,kds',
        ]);
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $orderBranch = Order::where('id', $id)->value('branch_id');
            if ($orderBranch !== null && !in_array((int) $orderBranch, $this->effectiveBranchScope($actor), true)) {
                return response()->json(['success' => false, 'message' => 'Đơn hàng không thuộc chi nhánh bạn được phân công.'], 403);
            }
        }
        $order = Order::findOrFail($id);
        // Điều kiện hoàn tác (spec mục 1 + 5): đã qua confirm() (paid +
        // stock_deducted) và đơn chưa kết thúc. Kiểm trước để quyết đường
        // Zalo, kiểm LẠI trong transaction khóa dòng làm chốt idempotent —
        // bấm lần 2/bấm trùng → 422, không đảo hai lần.
        $undoable = fn (Order $o) => $o->online_channel === 'zalo'
            && $o->payment_status === 'paid'
            && (bool) $o->stock_deducted
            && !in_array($o->status, ['completed', 'cancelled'], true);
        if (!$undoable($order)) {
            return response()->json(['success' => false, 'message' => 'Đơn không ở trạng thái đã xác nhận thanh toán.'], 422);
        }

        // Trục Zalo (spec mục 2): đơn SDK BANK — gọi updateOrderStatus −1
        // TRƯỚC khi đảo nội bộ; Zalo không xác nhận err 0 (hoặc lỗi gọi)
        // → HỦY toàn bộ hoàn tác (422, không đổi gì) để 2 phía không lệch.
        // updateOrderStatus vốn fail-soft nên ở đây phải đọc kết quả trả
        // về thật. Đơn SDK COD: KHÔNG báo — các điểm nối COD hiện hành chỉ
        // báo ở trạng thái CUỐI (completed/cancelled), hoàn tác không
        // phải trạng thái cuối, đơn sống tiếp và báo đúng kết cục thật
        // sau này. Đơn thường: chỉ đảo nội bộ.
        $zaloResult = 'not_applicable';
        if ($order->pay_channel === 'BANK' && !empty($order->pay_sdk_order_id)) {
            $res = app(\App\Services\ZaloPaymentService::class)->updateOrderStatus($order, 'failed');
            if (!is_array($res) || (int) ($res['err'] ?? -1) !== 0) {
                return response()->json(['success' => false, 'message' => 'Không báo được trạng thái sang Zalo — hoàn tác bị hủy, đơn không thay đổi. Vui lòng thử lại.'], 422);
            }
            $zaloResult = 'success';
        }

        [$actorUserId, $actorEmployeeId] = \App\Support\ApprovalActor::ids($request->user());
        $actorLabel = $actor instanceof \App\Models\Employee
            ? ($actor->full_name ?: ('NV#' . $actor->id))
            : ($actor->name ?? null);
        $surface = $validated['surface'] ?? 'admin';

        try {
            $order = DB::transaction(function () use ($id, $validated, $inventoryService, $loyaltyService, $zaloResult, $actorUserId, $actorEmployeeId, $actorLabel, $surface, $undoable) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);
                if (!$undoable($order)) {
                    throw new Exception('Đơn không ở trạng thái đã xác nhận thanh toán.');
                }
                // Ảnh chụp trước đảo cho nhật ký (spec mục 6)
                $snapshot = [
                    'prev_payment_status' => $order->payment_status,
                    'prev_paid_at' => $order->paid_at,
                    'prev_pay_channel' => $order->pay_channel,
                    'prev_pay_sdk_status' => $order->pay_sdk_status,
                ];
                // Trục tồn kho: hoàn theo đúng khuôn performCancel (chỉ
                // khi đã trừ kho) — restock tự đối chiếu nhật ký xuất của
                // đơn và chỉ hoàn phần chưa hoàn.
                if ($order->stock_deducted) {
                    $inventoryService->restock(
                        $order->branch_id ?? 1,
                        $order->items->map(fn($item) => [
                            'product_id' => $item->product_id,
                            'product_option_id' => $item->product_option_id,
                            'option_ids' => $item->options ? array_keys((array) $item->options) : [],
                            'quantity' => $item->quantity,
                        ])->toArray(),
                        $order->id
                    );
                }
                // Trục tiền/điểm: thu hồi qua ĐÚNG revokeEarn của đường
                // hủy (note ngữ cảnh 'undo' phân biệt nguồn thu hồi). Phải
                // gọi TRƯỚC khi xóa points_earned ở trục trạng thái.
                $loyaltyService->revokeEarn($order, true, 'undo');
                // Trục trạng thái (spec mục 2): trục giao hàng đứng yên —
                // chỉ lùi processing-chưa-ready về pending; đã ready giữ
                // nguyên (đơn COD paid ở bước Đang Giao giữ cả status).
                $order->payment_status = 'pending_payment';
                $order->paid_at = null;
                $order->stock_deducted = false;
                $order->points_earned = 0;
                if ($order->pay_channel === 'BANK' && !empty($order->pay_sdk_order_id)) {
                    // Từ vựng SDK hiện hành: 'failed' — đồng thời là chốt
                    // khóa repayParams không cấp lại tham số SDK cho đơn
                    // này (đường trả qua Zalo đã đóng, spec mục 3).
                    $order->pay_sdk_status = 'failed';
                }
                if ($order->status === 'processing' && empty($order->ready_at)) {
                    $order->status = 'pending';
                }
                $order->save();

                \App\Models\OrderPaymentUndoLog::create([
                    'order_id' => $order->id,
                    'user_id' => $actorUserId,
                    'employee_id' => $actorEmployeeId,
                    'actor_label' => $actorLabel,
                    'surface' => $surface,
                    'branch_id' => $order->branch_id,
                    // N-2 (360 đợt 2): ghi chú mặc định = nhãn mã khi NV không gõ tay.
                    'reason' => $validated['reason'] ?? CancelReasonCodes::label($validated['reason_code']),
                    'reason_code' => $validated['reason_code'],
                    ...$snapshot,
                    'zalo_result' => $zaloResult,
                ]);

                return $order->load(['items.product', 'customer']);
            });
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Đã hoàn tác xác nhận thanh toán. Đơn trở về trạng thái chờ thanh toán.',
            'data' => $order,
        ]);
    }

    private function generateMemberCode(): string
    {
        // Rà mã 2026-10-20: giống CustomerController — tiền tố + độ dài từ Thiết lập
        // (CodeGenerator 'member'), giữ hậu tố ngẫu nhiên vì mã = mã giới thiệu công khai.
        $prefix = \App\Helpers\CodeGenerator::prefix('member');
        $len = max(4, \App\Helpers\CodeGenerator::digits('member'));
        do {
            $code = $prefix . strtoupper(Str::random($len));
        } while (Customer::where('member_code', $code)->exists());
        return $code;
    }

    /**
     * Gói 55 p11ac: tính giá vốn 1 đơn vị món = Σ (định mức NL × giá vốn BQ lô đã trừ).
     * Gói 55 p11ae: viết lại để KHỚP 100% logic trừ kho của InventoryService::calculateNeeds:
     * - Định mức cơ bản: whereNull('product_option_id') (trước đây lấy cả dòng per-option → đếm trùng)
     * - Tùy chọn: phân biệt fixed (product_id NULL) / per_product (đúng món) theo quantity_mode
     * - Gộp product_option_id (size) của dòng đơn vào danh sách option (trước đây bỏ sót)
     */
    // Mở public (2026-11-06): điểm xác nhận thanh toán chung
    // App\Services\OnlinePaymentConfirmer dùng lại ĐÚNG công thức giá vốn
    // này cho cả cửa NV bấm lẫn cửa webhook CIA của hãng — không chép lại.
    public function calcItemUnitCost($item, array $materialCosts): float
    {
        if (empty($materialCosts) || empty($item->product_id)) {
            return 0;
        }
        // Gộp product_option_id vào danh sách option — giống calculateNeeds
        $optionIds = $item->options ? array_keys((array) $item->options) : [];
        if (!empty($item->product_option_id)) {
            $optionIds[] = $item->product_option_id;
        }
        $optionIds = array_values(array_unique(array_filter($optionIds)));
        $cost = 0;
        // Định mức CƠ BẢN của món (không tính dòng định mức theo tùy chọn)
        $recipes = \App\Models\Recipe::where('product_id', $item->product_id)
            ->whereNull('product_option_id')
            ->get();
        foreach ($recipes as $r) {
            $cost += (float) $r->quantity * ($materialCosts[$r->material_id] ?? 0);
        }
        // Định mức của từng tùy chọn đã chọn — phân biệt fixed/per_product
        $modeCache = [];
        foreach ($optionIds as $oid) {
            if (!array_key_exists($oid, $modeCache)) {
                $opt = \App\Models\ProductOption::with('group')->find($oid);
                $modeCache[$oid] = ($opt && $opt->group && $opt->group->quantity_mode === 'per_product')
                    ? 'per_product' : 'fixed';
            }
            if ($modeCache[$oid] === 'per_product') {
                $optionRecipes = \App\Models\Recipe::where('product_id', $item->product_id)
                    ->where('product_option_id', $oid)
                    ->get();
            } else {
                $optionRecipes = \App\Models\Recipe::whereNull('product_id')
                    ->where('product_option_id', $oid)
                    ->get();
            }
            foreach ($optionRecipes as $r) {
                $cost += (float) $r->quantity * ($materialCosts[$r->material_id] ?? 0);
            }
        }
        return round($cost, 2);
    }
}
