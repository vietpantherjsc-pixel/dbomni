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
        $branches = Branch::select('id', 'name', 'address', 'latitude', 'longitude')->get();
        return response()->json(['success' => true, 'data' => $branches]);
    }

    // Thực đơn cho Mini App (ẩn món "Phí dịch vụ")
    public function menu(): JsonResponse
    {
        $menu = Category::where('is_active', true)
            ->orderBy('sort_order', 'asc')
            ->with(['products' => function ($query) {
                $query->where('is_active', true)->where('is_service_fee', false)->with('options');
            }])
            ->get();

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
                    ->where('is_service_fee', false)->first();
                if (!$product) continue;
                $base = (float) $product->base_price;
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
            'branch_id' => 'required|exists:branches,id',
            'order_type' => 'required|in:takeaway,delivery',
            'customer_name' => 'required|string|max:100',
            'customer_phone' => 'required|string|max:20',
            'zalo_user_id' => 'nullable|string|max:100',
            'delivery_address' => 'required_if:order_type,delivery|nullable|string|max:255',
            'distance_km' => 'required_if:order_type,delivery|nullable|numeric|min:0|max:100',
            'scheduled_at' => 'nullable|date|after:now',
            'payment_method' => 'required|in:transfer,pay_at_store',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id',
            'points_redeem' => 'nullable|integer|min:0',
            'note' => 'nullable|string|max:255',
            'referred_by' => 'nullable|string|max:20', // Gói 9: mã TV người giới thiệu
            'items' => 'required|array|min:1|max:50',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.product_option_id' => 'nullable|exists:product_options,id',
            'items.*.option_ids' => 'nullable|array', // Gói 8a: tùy chọn từ nhóm (size/topping)
            'items.*.option_ids.*' => 'exists:product_options,id',
            'items.*.quantity' => 'required|integer|min:1|max:20',
            'items.*.note' => 'nullable|string|max:255',
        ]);

        try {
            $order = DB::transaction(function () use ($validated, $promotionService, $loyaltyService) {
                $subtotal = 0;
                $orderItemsData = [];
                $promoItems = [];

                // 1. Tính tiền theo GIÁ MENU phía server
                foreach ($validated['items'] as $item) {
                    $product = Product::findOrFail($item['product_id']);
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
                    $unitPrice = (float) $product->base_price
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
                        'price' => $product->base_price,
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

                // 3. Phí ship (đơn giao hàng) — server tự tính.
                // Gói 10c: chưa cộng dòng "Phí dịch vụ" vội — đợi trừ KM phí ship (bước 5b).
                $shippingFee = 0;
                if ($validated['order_type'] === 'delivery') {
                    $shippingFee = $this->calcShipFee((float) $validated['distance_km']);
                }

                $discountAmount = 0;

                // 4. Voucher
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
                    if ($subtotal < $voucher->min_order_amount) {
                        throw new Exception('Chưa đạt giá trị tối thiểu của voucher.');
                    }
                    $discountAmount = $voucher->type === 'fixed'
                        ? (float) $voucher->value
                        : ($subtotal * (float) $voucher->value) / 100;
                    if ($voucher->max_discount_amount) {
                        $discountAmount = min($discountAmount, (float) $voucher->max_discount_amount);
                    }
                    $voucher->increment('used_count');
                    $appliedVoucher = $voucher;
                }

                // 5. Khuyến mại (validate server)
                $promotionDiscount = 0;
                $appliedPromotion = null;
                $shippingDiscount = 0; // Gói 10c
                $shippingPromotion = null; // Gói 10c
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
                        $promotionDiscount = (float) $found['discount'];
                    }
                    if ($appliedPromotion && $appliedPromotion->type === 'gift' && $appliedPromotion->gift_product_id) {
                        $giftProduct = Product::findOrFail($appliedPromotion->gift_product_id);
                        $orderItemsData[] = [
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

                // 6. Đổi điểm
                $pointsUsed = 0;
                if (!empty($validated['points_redeem']) && (int) $validated['points_redeem'] > 0) {
                    $preview = $loyaltyService->previewRedeem(
                        $customer,
                        (int) $validated['points_redeem'],
                        $subtotal + $shippingFee - $discountAmount - $promotionDiscount
                    );
                    if ($preview['points_used'] <= 0) {
                        throw new Exception('Điểm không đủ để đổi.');
                    }
                    $pointsUsed = $preview['points_used'];
                    $discountAmount += $preview['discount'];
                }

                $discountAmount += $promotionDiscount;
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
                        'note' => 'Phí giao hàng (' . $validated['distance_km'] . 'km)'
                            . ($shippingDiscount > 0 ? ' — đã giảm ' . number_format($shippingDiscount, 0) . 'đ từ KM' : ''),
                    ];
                }

                // 7. Tạo đơn — CHỜ XÁC NHẬN (chưa trừ kho, chưa tích điểm)
                $order = Order::create([
                    'user_id' => null,
                    'branch_id' => $validated['branch_id'],
                    'order_type' => $validated['order_type'],
                    'online_channel' => 'zalo',
                    'order_number' => 'ONL-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                    'code' => 'ZL-' . date('Ymd') . '-' . strtoupper(Str::random(5)),
                    'customer_id' => $customer->id,
                    'customer_name' => $validated['customer_name'],
                    'customer_phone' => $validated['customer_phone'],
                    'referred_by' => $validated['referred_by'] ?? $customer->referred_by,
                    'zalo_user_id' => $validated['zalo_user_id'] ?? null,
                    'delivery_address' => $validated['delivery_address'] ?? null,
                    'distance_km' => $validated['distance_km'] ?? null,
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
                ]);

                foreach ($orderItemsData as $itemData) {
                    $order->items()->create($itemData);
                }

                // Trừ điểm đổi ngay (hoàn lại nếu đơn bị hủy)
                if ($pointsUsed > 0) {
                    $loyaltyService->applyRedeem($customer, $order, $pointsUsed);
                }

                return $order->load(['items.product', 'customer']);
            });

            return response()->json([
                'success' => true,
                'message' => 'Đặt món thành công! Quán sẽ xác nhận đơn của bạn.',
                'data' => $order,
            ], 201);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
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
            'items' => $order->items->map(fn($i) => [
                'name' => $i->product_name,
                'quantity' => $i->quantity,
                'unit_price' => (float) $i->unit_price,
                'note' => $i->note,
            ]),
        ]]);
    }

    // KH hủy đơn đang chờ xác nhận
    public function cancel(string $code, LoyaltyService $loyaltyService): JsonResponse
    {
        try {
            $order = DB::transaction(function () use ($code, $loyaltyService) {
                $order = Order::where('code', $code)->where('online_channel', 'zalo')->lockForUpdate()->firstOrFail();
                if ($order->status !== 'pending' || $order->payment_status !== 'pending') {
                    throw new Exception('Đơn đang được chuẩn bị, không thể hủy online. Vui lòng gọi quán.');
                }
                $order->status = 'cancelled';
                $order->cancel_reason = 'Khách hủy trên Mini App';
                $order->cancelled_at = now();
                $order->save();

                // Gói 13: hoàn điểm đã đổi qua LoyaltyService (ghi sổ PointTransaction)
                // thay vì cộng thủ công. Đơn chưa xác nhận nên chưa tích điểm -> không cần revokeEarn.
                $loyaltyService->refundRedeem($order);
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

            $order = Order::where('code', $code)->firstOrFail();

            if (!$order->claim_token || !hash_equals($order->claim_token, $validated['claim_token'])) {
                throw new Exception('Mã QR không hợp lệ.');
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

            DB::transaction(function () use ($order, $customer, $loyaltyService) {
                $order->customer_id = $customer->id;
                // Đơn đã thanh toán mà chưa tích điểm → tích bù ngay
                if ($order->payment_status === 'paid' && !$order->points_earned) {
                    $order->points_earned = $loyaltyService->earnForOrder(
                        $customer, $order, (float) $order->total_amount
                    );
                }
                $order->claim_token = null;
                $order->claim_expires_at = null;
                $order->save();
            });

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
                $inventoryService->deductStock(
                    $order->branch_id,
                    $order->items->map(fn($item) => [
                        'product_id' => $item->product_id,
                        'product_option_id' => $item->product_option_id,
                        'option_ids' => $item->options ? array_keys((array) $item->options) : [],
                        'quantity' => $item->quantity,
                    ])->toArray()
                );

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
}
