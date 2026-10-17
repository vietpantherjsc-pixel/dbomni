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
use App\Services\PromotionService;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 6 (2026-10-05): API public cho Zalo Mini App đặt món.
// - Không cần đăng nhập: định danh KH bằng SĐT.
// - Đơn tạo ở trạng thái chờ xác nhận (chưa trừ kho, chưa tích điểm);
//   nhân viên xác nhận thanh toán -> trừ kho, vào KDS, in tem, tích điểm.
class OnlineOrderController extends Controller
{
    // Danh sách chi nhánh (kèm địa chỉ + tọa độ để tính ship)
    public function branches(): JsonResponse
    {
        // Gói 55 p1: thêm phone; p2: thêm opening_hours để Mini App hiện trạng thái mở cửa
        $branches = Branch::select('id', 'name', 'address', 'phone', 'opening_hours', 'latitude', 'longitude')->get();
        return response()->json(['success' => true, 'data' => $branches]);
    }

    // Thực đơn cho Mini App (ẩn món "Phí dịch vụ")
    public function menu(): JsonResponse
    {
        $menu = Category::where('is_active', true)
            ->orderBy('sort_order', 'asc')
            ->with(['products' => function ($query) {
                $query->where('is_active', true)->where('is_service_fee', false)->with(['options', 'prices.priceList']);
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
        // Gói 10f: ưu tiên cover riêng của chi nhánh, chưa có thì dùng cover chung
        $cover = Setting::get('shop_cover_url', '');
        if ($request->branch_id) {
            $branchCover = Branch::where('id', $request->branch_id)->value('cover_url');
            if ($branchCover) $cover = $branchCover;
        }
        // Gói 50b: chuẩn hóa thành URL tuyệt đối theo host thật (sửa dữ liệu cũ relative/localhost)
        if ($cover && !preg_match('#^https?://#i', $cover)) {
            $cover = $request->getSchemeAndHttpHost() . '/' . ltrim($cover, '/');
        }
        return response()->json(['success' => true, 'data' => [
            'cover_url' => $cover,
            'ref_bonus_points' => (int) Setting::get('ref_bonus_points', 100),
        ]]);
    }

    // Gói 9: món đang giảm giá (KM scope theo món/danh mục, áp dụng kênh online)
    public function saleProducts(): JsonResponse
    {
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
                    ->where('is_service_fee', false)->with('prices.priceList')->first();
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

        $data = collect($best)->map(function ($b) {
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
        })->values();

        return response()->json(['success' => true, 'data' => $data]);
    }

    // Gói 34: top 10 món bán chạy trong 30 ngày qua (theo tổng số lượng, chỉ đơn completed)
    // GET /api/online/top-products?branch_id=
    public function topProducts(Request $request): JsonResponse
    {
        $branchId = (int) $request->query('branch_id', 0);
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

        return response()->json(['success' => true, 'data' => $rows->map(fn ($r) => [
            'product_id' => (int) $r->product_id,
            'total_sold' => (int) $r->total_sold,
        ])->values()]);
    }

    // Cấu hình phí ship
    public function shipConfig(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => [
            'base_fee' => (float) Setting::get('ship_base_fee', 20000),
            'base_km' => (float) Setting::get('ship_base_km', 2),
            'per_km' => (float) Setting::get('ship_per_km', 6000),
        ]]);
    }

    // Gói 50e: geocode qua backend (Zalo WebView chặn domain lạ, backend gọi OSM với User-Agent chuẩn)
    public function geocode(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 5) {
            return response()->json(['success' => false, 'message' => 'Địa chỉ quá ngắn'], 422);
        }
        try {
            $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
                'format' => 'json', 'limit' => 1, 'countrycodes' => 'vn', 'q' => $q,
            ]);
            $ctx = stream_context_create(['http' => [
                'timeout' => 8,
                'header' => "User-Agent: CoffeePOS-ZaloMiniApp/1.0\r\nAccept: application/json\r\n",
            ]]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) throw new \RuntimeException('Không kết nối được bản đồ');
            $data = json_decode($raw, true);
            if (empty($data[0]['lat']) || empty($data[0]['lon'])) {
                throw new \RuntimeException('Không tìm thấy địa chỉ');
            }
            return response()->json(['success' => true, 'data' => [
                'lat' => (float) $data[0]['lat'],
                'lng' => (float) $data[0]['lon'],
                'label' => $data[0]['display_name'] ?? '',
            ]]);
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
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
            return response()->json(['success' => false, 'message' => $e->getMessage(), 'data' => []], 502);
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
            return response()->json(['success' => false, 'message' => $e->getMessage(), 'data' => []], 502);
        }
    }

    // Gói 50f: gợi ý địa chỉ khi user gõ (trả tối đa 5 kết quả để chọn nhanh)
    public function geocodeSuggest(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 5) {
            return response()->json(['success' => true, 'data' => []]);
        }
        // Gói 55 p3: ưu tiên kết quả gần vị trí user (nếu có lat/lon)
        $lat = (float) $request->query('lat', 0);
        $lon = (float) $request->query('lon', 0);
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
            return response()->json(['success' => true, 'data' => $out]);
        } catch (\Throwable $e) {
            return response()->json(['success' => true, 'data' => []]);
        }
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
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
    }

    // Tính phí ship theo khoảng cách (server tính lại, không tin client)
    public function shippingFee(Request $request): JsonResponse
    {
        $validated = $request->validate(['distance_km' => 'required|numeric|min:0|max:100']);
        return response()->json([
            'success' => true,
            'data' => ['fee' => $this->calcShipFee((float) $validated['distance_km'])],
        ]);
    }

    private function calcShipFee(float $km): float
    {
        $baseFee = (float) Setting::get('ship_base_fee', 20000);
        $baseKm = (float) Setting::get('ship_base_km', 2);
        $perKm = (float) Setting::get('ship_per_km', 6000);
        if ($km <= $baseKm) {
            return $baseFee;
        }
        return $baseFee + ceil($km - $baseKm) * $perKm;
    }

    // Gói 55 p11ac: server tự tính khoảng cách (không tin distance_km client gửi)
    // Trả về null nếu không geocode được -> phí ship để quán xác nhận
    private function serverDistanceKm(string $address, $branch): ?float
    {
        if (empty($branch->latitude) || empty($branch->longitude)) return null;
        try {
            $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
                'format' => 'json', 'limit' => 1, 'countrycodes' => 'vn', 'q' => $address,
            ]);
            $ctx = stream_context_create(['http' => [
                'timeout' => 8,
                'header' => "User-Agent: CoffeePOS-ZaloMiniApp/1.0\r\nAccept: application/json\r\n",
            ]]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) return null;
            $data = json_decode($raw, true);
            if (empty($data[0]['lat']) || empty($data[0]['lon'])) return null;
            $lat1 = deg2rad((float) $branch->latitude);
            $lon1 = deg2rad((float) $branch->longitude);
            $lat2 = deg2rad((float) $data[0]['lat']);
            $lon2 = deg2rad((float) $data[0]['lon']);
            $dLat = $lat2 - $lat1; $dLon = $lon2 - $lon1;
            $a = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLon / 2) ** 2;
            return round(2 * 6371 * asin(sqrt($a)), 1);
        } catch (\Throwable $e) {
            return null;
        }
    }

    // KM đủ điều kiện cho kênh online
    public function eligiblePromotions(Request $request, PromotionService $service): JsonResponse
    {
        $validated = $request->validate([
            'subtotal' => 'required|numeric|min:0',
            'items' => 'nullable|array',
            'customer_id' => 'nullable|exists:customers,id',
            'shipping_fee' => 'nullable|numeric|min:0', // Gói 10c: để tính KM phí ship
        ]);
        return response()->json(['success' => true, 'data' => $service->eligiblePromotions([
            'subtotal' => (float) $validated['subtotal'],
            'items' => $validated['items'] ?? [],
            'customer_id' => $validated['customer_id'] ?? null,
            'channel' => 'online',
            'shipping_fee' => (float) ($validated['shipping_fee'] ?? 0),
        ])]);
    }

    // Thông tin tích điểm của KH theo SĐT
    public function customer(Request $request): JsonResponse
    {
        // Gói 11: đăng nhập bằng SĐT + Mã TV (bỏ tra cứu tự do bằng SĐT để bảo mật)
        $validated = $request->validate([
            'phone' => 'required|string|max:20',
            'member_code' => 'required|string|max:20',
        ]);
        $customer = Customer::with('tier')
            ->where('phone', $validated['phone'])
            ->where('member_code', $validated['member_code'])
            ->first();
        if (!$customer) {
            return response()->json(['success' => true, 'data' => null]);
        }
        // Gói 12a: lịch sử Tài khoản ẩn đơn hoàn thành quá 24h (đơn chưa xong vẫn hiện kể cả qua ngày)
        $cutoff = now()->subHours(24);
        $orders = $customer->orders()
            ->where(function ($q) use ($cutoff) {
                $q->where('status', '!=', 'completed')
                    ->orWhere('completed_at', '>', $cutoff)
                    ->orWhere(function ($q2) use ($cutoff) {
                        // Đơn cũ hoàn thành trước khi có cột completed_at: dùng updated_at làm mốc
                        $q2->whereNull('completed_at')->where('updated_at', '>', $cutoff);
                    });
            })
            ->limit(10)->get(['id', 'code', 'total_amount', 'status', 'payment_status', 'created_at']);
        return response()->json(['success' => true, 'data' => [
            'id' => $customer->id,
            'name' => $customer->name,
            'phone' => $customer->phone,
            'member_code' => $customer->member_code,
            'points' => $customer->points,
            'total_spent' => (float) $customer->total_spent,
            'tier' => $customer->tier?->name,
            // Gói 13: tỉ giá đổi điểm từ settings (frontend không hardcode)
            'redeem_points' => max(1, (int) Setting::get('points_redeem_points', 10)),
            'redeem_amount' => (float) Setting::get('points_redeem_amount', 1000),
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
        $validated = $request->validate([
            'client_key' => 'nullable|string|max:64', // Gói 55 p11ac: idempotency key
            'branch_id' => 'required|exists:branches,id',
            'order_type' => 'required|in:takeaway,delivery',
            'customer_name' => 'required|string|max:100',
            'customer_phone' => 'required|string|max:20',
            'zalo_user_id' => 'nullable|string|max:100',
            'delivery_address' => 'required_if:order_type,delivery|nullable|string|max:255',
            'distance_km' => 'nullable|numeric|min:0|max:100', // Gói 55 p11ac: chỉ để tham khảo, server tự tính lại
            'scheduled_at' => 'nullable|date|after:now',
            'payment_method' => 'required|in:transfer,pay_at_store',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id',
            'points_redeem' => 'nullable|integer|min:0',
            'note' => 'nullable|string|max:255',
            'referred_by' => 'nullable|string|max:20', // Gói 9: mã TV người giới thiệu
            // Gói 48: hóa đơn VAT + địa chỉ chi tiết + ghi chú giao hàng
            'need_vat_invoice' => 'nullable|boolean',
            'vat_tax_code' => 'required_if:need_vat_invoice,true|nullable|string|max:30',
            'vat_company_name' => 'required_if:need_vat_invoice,true|nullable|string|max:200',
            'vat_company_address' => 'nullable|string|max:255',
            'vat_email' => 'required_if:need_vat_invoice,true|nullable|email|max:150',
            'delivery_note' => 'nullable|string|max:500',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            // Gói 60: gói giao hàng khách chọn từ báo giá live + phí đã khóa
            'delivery_package' => 'nullable|in:nhanh,sieu_toc',
            'delivery_quoted_fee' => 'nullable|numeric|min:0',
            'delivery_provider' => 'nullable|in:ahamove,lalamove',
            // Gói 61b: tọa độ điểm giao (từ GPS/gợi ý địa chỉ ở checkout)
            'delivery_dropoff_lat' => 'nullable|numeric|between:-90,90',
            'delivery_dropoff_lng' => 'nullable|numeric|between:-180,180',
            'items' => 'required|array|min:1|max:50',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.product_option_id' => 'nullable|exists:product_options,id',
            'items.*.option_ids' => 'nullable|array', // Gói 8a: tùy chọn từ nhóm (size/topping)
            'items.*.option_ids.*' => 'exists:product_options,id',
            'items.*.quantity' => 'required|integer|min:1|max:20',
            'items.*.note' => 'nullable|string|max:255',
        ]);

        try {
            // Gói 55 p11ac: idempotency — client_key đã tồn tại thì trả đơn cũ
            if (!empty($validated['client_key'])) {
                $existing = Order::with('items')->where('client_key', $validated['client_key'])->first();
                if ($existing) {
                    return response()->json(['success' => true, 'message' => 'Đơn đã được tạo trước đó', 'data' => $existing, 'duplicate' => true]);
                }
            }
            $order = DB::transaction(function () use ($validated, $promotionService, $loyaltyService) {
                $subtotal = 0;
                $orderItemsData = [];
                $promoItems = [];

                // 1. Tính tiền theo GIÁ MENU phía server (Gói 49i: giá kênh online)
                foreach ($validated['items'] as $item) {
                    $product = Product::with('prices.priceList')->findOrFail($item['product_id']);
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
                if (!$customer) {
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

                // 3. Phí ship (đơn giao hàng) — server tự tính, KHÔNG tin client.
                // Gói 10c: chưa cộng dòng "Phí dịch vụ" vội — đợi trừ KM phí ship (bước 5b).
                // Gói 61b: khi đã cấu hình hãng giao hàng, BẮT BUỘC phải có báo giá hãng:
                // - client phải gửi delivery_quoted_fee (từ API quote lúc checkout);
                // - server gọi lại quote để đối chiếu, lệch quá 5.000đ → báo lỗi bắt báo giá lại,
                //   KHÔNG tự ý thay bằng phí khác (checklist #6).
                // - quote thất bại → chặn đơn, không rơi về phí 0đ (checklist #5).
                $shippingFee = 0;
                $distanceKm = null;
                $shipNote = null;
                $deliveryQuote = null;
                if ($validated['order_type'] === 'delivery') {
                    $branch = Branch::find($validated['branch_id']);
                    $deliveryService = app(\App\Services\Delivery\DeliveryService::class);
                    if ($deliveryService->isConfigured()) {
                        if (empty($validated['delivery_quoted_fee'])) {
                            throw new Exception('Chưa có báo giá phí ship. Vui lòng quay lại kiểm tra phí ship trước khi đặt đơn.');
                        }
                        $fresh = $deliveryService->quote([
                            'pickup_lat' => (float) $branch->latitude,
                            'pickup_lng' => (float) $branch->longitude,
                            'pickup_address' => $branch->address ?? $branch->name,
                            'dropoff_address' => $validated['delivery_address'] ?? '',
                            'dropoff_lat' => isset($validated['delivery_dropoff_lat']) ? (float) $validated['delivery_dropoff_lat'] : null,
                            'dropoff_lng' => isset($validated['delivery_dropoff_lng']) ? (float) $validated['delivery_dropoff_lng'] : null,
                            'cod_amount' => 0,
                        ]);
                        if (!$fresh['success']) {
                            throw new Exception('Chưa giao được tới địa chỉ này. Vui lòng thử địa chỉ khác hoặc chọn nhận tại quán.');
                        }
                        $quotedFee = (int) $validated['delivery_quoted_fee'];
                        $matched = false;
                        $quotedDistance = null;
                        foreach ($fresh['providers'] as $p) {
                            foreach ($p['packages'] as $pkg) {
                                if (abs($pkg['fee'] - $quotedFee) <= 5000) {
                                    $matched = true;
                                    $quotedDistance = $p['distance_km'];
                                    break 2;
                                }
                            }
                        }
                        if (!$matched) {
                            throw new Exception('Phí ship đã thay đổi so với lúc báo giá. Vui lòng kiểm tra lại phí ship trước khi đặt đơn.');
                        }
                        $shippingFee = $quotedFee;
                        $distanceKm = $quotedDistance;
                        $deliveryQuote = $fresh;
                    } else {
                        // Fallback luồng cũ: geocode + bảng phí nội bộ
                        $distanceKm = $this->serverDistanceKm($validated['delivery_address'] ?? '', $branch);
                        if ($distanceKm !== null) {
                            $shippingFee = $this->calcShipFee($distanceKm);
                        } else {
                            $shipNote = 'Quán xác nhận phí ship';
                        }
                    }
                }

                $discountAmount = 0;

                // 4. Voucher — tính riêng, chưa cộng vào tổng
                // (quyết định cộng dồn hay lấy max ở sau theo công tắc promo_allow_stack)
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
                if (!empty($validated['promotion_id'])) {
                    $eligible = $promotionService->eligiblePromotions([
                        'subtotal' => $subtotal,
                        'items' => $promoItems,
                        'customer_id' => $customer->id,
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

                // 5d. Gói 55 p11af (P0-13): công tắc cộng dồn KM + trần % giảm giá.
                // - promo_allow_stack=true (mặc định Gói 57): cộng dồn các loại giảm giá
                //   (voucher vs KM), không cộng dồn. KM phí ship và KM tặng món không phải
                //   giảm giá tiền nên giữ nguyên.
                // - Trần: tổng giảm giá KM không vượt promo_max_discount_pct % subtotal.
                $allowStack = filter_var(Setting::get('promo_allow_stack', true), FILTER_VALIDATE_BOOLEAN);
                $maxDiscountPct = (float) Setting::get('promo_max_discount_pct', 50);
                if ($allowStack) {
                    $discountAmount = $voucherDiscount + $promotionDiscount;
                    if ($appliedVoucher) {
                        $appliedVoucher->increment('used_count');
                    }
                } else {
                    $discountAmount = max($voucherDiscount, $promotionDiscount);
                    $voucherWins = $appliedVoucher && $voucherDiscount > 0 && $voucherDiscount >= $promotionDiscount;
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
                    }
                }
                if ($giftLinePending) {
                    $orderItemsData[] = $giftLinePending;
                }
                if ($maxDiscountPct > 0 && $maxDiscountPct < 100) {
                    $discountAmount = min($discountAmount, $subtotal * $maxDiscountPct / 100);
                }

                // 6. Đổi điểm (loyalty — tiền KH đã tích, không bị trần KM)
                $pointsUsed = 0;
                if (!empty($validated['points_redeem']) && (int) $validated['points_redeem'] > 0) {
                    $preview = $loyaltyService->previewRedeem(
                        $customer,
                        (int) $validated['points_redeem'],
                        $subtotal + $shippingFee - $discountAmount
                    );
                    if ($preview['points_used'] <= 0) {
                        throw new Exception('Điểm không đủ để đổi.');
                    }
                    $pointsUsed = $preview['points_used'];
                    $discountAmount += $preview['discount'];
                }

                $discountAmount = min($discountAmount, $subtotal + $shippingFee);
                $finalAmount = $subtotal + $shippingFee - $discountAmount;

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
                // Gói 57: snapshot phí sàn kênh zalo lúc tạo đơn
                $zaloPriceList = \App\Models\PriceList::whereRaw('LOWER(code) = ?', ['zalo'])->first();
                $zaloCommissionRate = $zaloPriceList ? (float) $zaloPriceList->commission_rate : 0;
                $zaloCommissionAmount = $zaloCommissionRate > 0 ? (int) round($finalAmount * $zaloCommissionRate / 100) : 0;
                $order = Order::create([
                    'user_id' => null,
                    'branch_id' => $validated['branch_id'],
                    'order_type' => $validated['order_type'],
                    'online_channel' => 'zalo',
                    'commission_rate' => $zaloCommissionRate,
                    'commission_amount' => $zaloCommissionAmount,
                    'order_number' => 'ONL-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                    'code' => 'ZL-' . date('Ymd') . '-' . strtoupper(Str::random(5)),
                    'client_key' => $validated['client_key'] ?? null, // Gói 55 p11ac
                    'customer_id' => $customer->id,
                    'customer_name' => $validated['customer_name'],
                    'customer_phone' => $validated['customer_phone'],
                    'referred_by' => $validated['referred_by'] ?? $customer->referred_by,
                    'zalo_user_id' => $validated['zalo_user_id'] ?? null,
                    'delivery_address' => $validated['delivery_address'] ?? null,
                    'distance_km' => $distanceKm, // Gói 55 p11ac: server tự tính
                    'delivery_note' => trim(($validated['delivery_note'] ?? '') . ($shipNote ? ($validated['delivery_note'] ? ' | ' : '') . $shipNote : '')),
                    'shipping_fee' => $shippingFee,
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
                    // Gói 48: VAT + địa chỉ chi tiết
                    'need_vat_invoice' => (bool) ($validated['need_vat_invoice'] ?? false),
                    'vat_tax_code' => $validated['vat_tax_code'] ?? null,
                    'vat_company_name' => $validated['vat_company_name'] ?? null,
                    'vat_company_address' => $validated['vat_company_address'] ?? null,
                    'vat_email' => $validated['vat_email'] ?? null,
                    'delivery_note' => $validated['delivery_note'] ?? null,
                    'province' => $validated['province'] ?? null,
                    'ward' => $validated['ward'] ?? null,
                    // Gói 60: gói giao hàng khách chọn + phí đã khóa lúc chốt đơn
                    // Gói 61b: lưu hãng của gói khách chọn (không để createForOrder tự đoán)
                    'delivery_package' => $validated['delivery_package'] ?? 'nhanh',
                    'delivery_provider' => $validated['delivery_provider'] ?? null,
                    'delivery_quoted_fee' => $validated['delivery_quoted_fee'] ?? $shippingFee,
                    'delivery_fee_charged' => $shippingFee,
                    // Gói 61b: tọa độ điểm giao để hãng báo giá/tạo đơn chính xác
                    'delivery_dropoff_lat' => $validated['delivery_dropoff_lat'] ?? null,
                    'delivery_dropoff_lng' => $validated['delivery_dropoff_lng'] ?? null,
                ]);

                foreach ($orderItemsData as $itemData) {
                    $order->items()->create($itemData);
                }

                // Trừ điểm đổi ngay (hoàn lại nếu đơn bị hủy)
                if ($pointsUsed > 0) {
                    $loyaltyService->applyRedeem($customer, $order, $pointsUsed);
                }

                // Gói 55 p11af (P0-12): ghi log lượt dùng voucher theo khách
                if ($appliedVoucher && $customer) {
                    VoucherUsage::create([
                        'voucher_id' => $appliedVoucher->id,
                        'customer_id' => $customer->id,
                        'order_id' => $order->id,
                        'used_at' => now(),
                    ]);
                }

                return $order->load(['items.product', 'customer']);
            });

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
            // Gói SEC2: không lộ message SQL thô ra client
            $message = $e instanceof \Illuminate\Database\QueryException
                ? 'Có lỗi xảy ra. Vui lòng thử lại.'
                : $e->getMessage();
            return response()->json(['success' => false, 'message' => $message], 400);
        }
    }

    // Theo dõi đơn hàng theo mã (public)
    /**
     * Gói 12a: đơn có quá hạn tra cứu trên Mini App không?
     * - Đơn chưa hoàn thành: luôn xem được (kể cả qua ngày).
     * - Đơn đã hoàn thành: chỉ xem trong 24h kể từ completed_at.
     */
    private function isExpiredForMiniApp(Order $order): bool
    {
        if ($order->status !== 'completed') {
            return false;
        }
        // Đơn cũ hoàn thành trước khi có cột completed_at: dùng updated_at làm mốc
        $doneAt = $order->completed_at ?? $order->updated_at;
        return $doneAt && $doneAt->lt(now()->subHours(24));
    }

    public function track(string $code): JsonResponse
    {
        $order = Order::with(['items.product'])
            ->where('code', $code)
            ->where('online_channel', 'zalo')
            ->firstOrFail();

        // Gói 12a: đơn hoàn thành quá 24h thì ẩn khỏi Mini App
        // (server vẫn giữ đủ để tính điểm và hạng thành viên).
        if ($this->isExpiredForMiniApp($order)) {
            return response()->json(['success' => false, 'message' => 'Đơn đã quá hạn tra cứu.'], 404);
        }

        return response()->json(['success' => true, 'data' => [
            'code' => $order->code,
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'payment_method' => $order->payment_method,
            'order_type' => $order->order_type,
            'total_amount' => (float) $order->total_amount,
            'shipping_fee' => (float) $order->shipping_fee,
            'scheduled_at' => $order->scheduled_at,
            'created_at' => $order->created_at,
            // Gói 60: thông tin giao hàng cho trang theo dõi đơn (poll 5s)
            'delivery' => $order->order_type === 'delivery' ? [
                'provider' => $order->delivery_provider,
                'provider_label' => $order->delivery_provider === 'ahamove' ? 'AhaMove'
                    : ($order->delivery_provider === 'lalamove' ? 'Lalamove' : null),
                'status' => $order->delivery_status,
                'status_label' => \App\Services\Delivery\DeliveryService::labels()[$order->delivery_status] ?? null,
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
                if ($order->status !== 'pending' || $order->payment_status !== 'pending') {
                    throw new Exception('Đơn đang được chuẩn bị, không thể hủy online. Vui lòng gọi quán.');
                }
                $order->status = 'cancelled';
                $order->cancel_reason = 'Khách hủy trên Mini App';
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
                return $order;
            });
            return response()->json(['success' => true, 'message' => 'Đã hủy đơn hàng.']);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
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
                if (in_array($order->status, ['completed', 'cancelled'])) {
                    throw new Exception('Đơn đã hoàn thành/hủy, không gán được.');
                }

                $customer = Customer::where('member_code', $validated['member_code'])
                    ->where('phone', $validated['phone'])
                    ->first();
                if (!$customer) {
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
                // Đơn đã thanh toán mà chưa tích điểm → tích bù ngay
                // Gói SEC: token đã null sau lần claim đầu nên không thể claim 2 lần
                if ($order->payment_status === 'paid' && $justAssigned && !$order->points_earned) {
                    $order->points_earned = $loyaltyService->earnForOrder(
                        $customer, $order, (float) $order->total_amount
                    );
                }
                $order->claim_token = null;
                $order->claim_expires_at = null;
                $order->save();
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
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }

    /**
     * Nhân viên XÁC NHẬN đơn online (đã nhận tiền / đồng ý làm):
     * trừ kho, vào KDS, tích điểm. Cần đăng nhập.
     */
    public function confirmPayment(int $id, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        try {
            $order = DB::transaction(function () use ($id, $inventoryService, $loyaltyService) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);

                if ($order->online_channel !== 'zalo') {
                    throw new Exception('Chỉ xác nhận được đơn online.');
                }
                if ($order->status === 'cancelled') {
                    throw new Exception('Đơn đã bị hủy.');
                }
                if ($order->stock_deducted) {
                    throw new Exception('Đơn đã được xác nhận trước đó.');
                }

                // Trừ kho (món "Phí dịch vụ" không có BOM nên tự bỏ qua)
                // Gói 8a: trừ định mức cơ bản + định mức từng tùy chọn đã chọn
                // Gói 55 p11ac: lưu giá vốn vào order_items
                // Gói 55 p11ad: log xuất kho kèm order_id
                $matCosts = $inventoryService->deductStock(
                    $order->branch_id,
                    $order->items->map(fn($item) => [
                        'product_id' => $item->product_id,
                        'product_option_id' => $item->product_option_id,
                        'option_ids' => $item->options ? array_keys((array) $item->options) : [],
                        'quantity' => $item->quantity,
                    ])->toArray(),
                    ['type' => 'order', 'id' => $order->id, 'note' => 'Xác nhận thanh toán online']
                );
                foreach ($order->items as $item) {
                    $item->update(['unit_cost' => $this->calcItemUnitCost($item, $matCosts)]);
                }

                $order->payment_status = 'paid';
                $order->status = 'processing'; // Gói 11: xác nhận xong vào thẳng "Đang Pha Chế" (KDS đã thu tiền)
                $order->stock_deducted = true;
                $order->save();

                // Tích điểm
                if ($order->customer_id) {
                    $customer = Customer::find($order->customer_id);
                    if ($customer) {
                        $order->points_earned = $loyaltyService->earnForOrder($customer, $order, (float) $order->total_amount);
                        $order->save();
                    }
                }

                // Gói 9: thưởng điểm cho người giới thiệu (affiliate)
                // Gói 13: chỉ trao cho ĐƠN ĐẦU TIÊN của khách (tránh trao lặp lại mọi đơn)
                if (!empty($order->referred_by)) {
                    $referrer = Customer::where('member_code', $order->referred_by)->first();
                    $isFirstOrder = $order->customer_id
                        ? !Order::where('customer_id', $order->customer_id)
                            ->where('id', '!=', $order->id)
                            ->where(function ($q) {
                                $q->where('payment_status', 'paid')->orWhere('stock_deducted', true);
                            })
                            ->exists()
                        : true;
                    if ($referrer && $referrer->id !== $order->customer_id && $isFirstOrder) {
                        $bonus = (int) Setting::get('ref_bonus_points', 100);
                        if ($bonus > 0) {
                            $loyaltyService->awardReferral($referrer, $order, $bonus);
                        }
                    }
                }

                return $order->load(['items.product', 'customer']);
            });

            return response()->json([
                'success' => true,
                'message' => 'Đã xác nhận đơn. Đơn đã vào KDS.',
                'data' => $order,
            ]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }

    private function generateMemberCode(): string
    {
        do {
            $code = 'TV' . strtoupper(Str::random(6));
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
    private function calcItemUnitCost($item, array $materialCosts): float
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
