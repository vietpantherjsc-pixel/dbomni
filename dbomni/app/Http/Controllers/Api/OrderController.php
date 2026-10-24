<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
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

class OrderController extends Controller
{
    // Audit 2026-10-23 B-5/B-6: NV chỉ được thao tác/xem đơn thuộc CN phân công.
    protected function denyOrderBranch(Request $request, $branchId): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Đơn hàng không thuộc chi nhánh bạn được phân công.'], 403);
        }
        return null;
    }

    // Audit 2026-10-23 KHO-06: lấy option ids ĐÚNG theo định dạng lưu của dòng món:
    // 1) cột option_ids đã lưu khi import (Sapo/Excel) — tin cậy nhất;
    // 2) options dạng map [option_id => name] (POS/online) — lấy khóa;
    // 3) options dạng list [['name' => ...]] (Sapo) KHÔNG chứa id -> [] —
    //    tuyệt đối không suy khóa 0,1,2 của list thành option id.
    protected function itemOptionIds($item): array
    {
        $stored = $item->option_ids ?? null;
        if (is_array($stored) && $stored) {
            return array_values(array_map('intval', $stored));
        }
        $opts = (array) ($item->options ?? []);
        if (!$opts || array_is_list($opts)) {
            return [];
        }
        return array_values(array_map('intval', array_keys($opts)));
    }

    protected function denyOrderById(Request $request, int $orderId): ?JsonResponse
    {
        $branchId = Order::where('id', $orderId)->value('branch_id');
        if ($branchId === null) return null; // để findOrFail ở luồng chính xử lý 404
        return $this->denyOrderBranch($request, $branchId);
    }

    /**
     * Gói 2 (2026-10-04): Danh sách hóa đơn cho trang quản trị (kiểu Sapo).
     * Filters: tab=all|paid|pending_payment|cancelled, search (mã), branch_id.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Order::with(['user:id,name', 'branch:id,name', 'items.product:id,name', 'items.option:id,name'])
            ->orderBy('created_at', 'desc');

        $tab = $request->query('tab', 'all');
        // Gói 49: bỏ tab "Chờ xác nhận (Zalo)" — đơn Zalo giờ xác nhận ở KDS.
        // Spec QR 2026-10-21: tab chờ thanh toán gồm cả đơn BANK qua Checkout SDK
        // (payment_status pending_payment/transfer_notified) — trước đây bị lọt lưới.
        // Audit 2026-10-21 🔴3: thêm 'confirmed' — đơn COD qua Checkout SDK chưa thu
        // tiền cũng thuộc nhóm chờ thu tiền, NV có đường thấy + xác nhận ở Admin.
        match ($tab) {
            'paid' => $query->where('payment_status', 'paid')->where('status', '!=', 'cancelled'),
            'pending_payment' => $query->whereIn('payment_status', ['pending', 'pending_payment', 'transfer_notified', 'confirmed'])->where('status', '!=', 'cancelled'),
            'cancelled' => $query->where('status', 'cancelled'),
            default => $query, // Tất cả hóa đơn
        };

        if ($request->filled('search')) {
            $search = $request->query('search');
            $query->where(function ($q) use ($search) {
                $q->where('code', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%");
            });
        }

        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->query('branch_id'));
        }

        // Audit 2026-10-23 B-5/B-6: NV chỉ xem đơn thuộc CN phân công
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $query->whereIn('branch_id', $actor->allBranchIds());
        }

        // Gói 53: lọc theo status (hỗ trợ "pending,processing" cho badge KDS/chuông POS)
        if ($request->filled('status')) {
            $statuses = array_map('trim', explode(',', $request->query('status')));
            $query->whereIn('status', $statuses);
        }

        // Gói 60: lọc theo hãng giao và trạng thái giao (checklist #27)
        if ($request->filled('delivery_provider')) {
            $query->where('delivery_provider', $request->query('delivery_provider'));
        }
        if ($request->filled('delivery_status')) {
            $statuses = array_map('trim', explode(',', $request->query('delivery_status')));
            $query->whereIn('delivery_status', $statuses);
        }
        if ($request->boolean('delivery_failover')) {
            $query->whereNotNull('delivery_failover_from');
        }

        $orders = $query->paginate($request->query('per_page', 20));

        // Spec QR 2026-10-21: gắn số phút chờ + cờ quá hạn cho đơn đang chờ tiền
        // (ngưỡng cấu hình zalo_pay_wait_alert_minutes, mặc định 15) để Admin tô cảnh báo.
        $alertMinutes = max(1, (int) \App\Models\Setting::get('zalo_pay_wait_alert_minutes', '15'));
        $orders->getCollection()->each(function ($o) use ($alertMinutes) {
            $waiting = in_array($o->payment_status, ['pending', 'pending_payment', 'transfer_notified'], true)
                && $o->status !== 'cancelled';
            $o->setAttribute('waiting_minutes', $waiting ? (int) $o->created_at->diffInMinutes(now()) : null);
            $o->setAttribute('pay_overdue', $waiting && $o->created_at->diffInMinutes(now()) >= $alertMinutes);
        });

        return response()->json(['success' => true, 'data' => $orders]);
    }

    /**
     * Tiếp nhận đơn hàng từ Zalo Mini App / POS, tính toán Voucher và trừ tồn kho tự động (BOM + FIFO).
     *
     * Gói 1 (2026-10-04):
     * - Sửa $product->price -> $product->base_price (khớp schema).
     * - Lưu đủ product_name/price/note vào order_items (bảng yêu cầu NOT NULL).
     * - Trừ kho qua InventoryService (1 nơi duy nhất, trừ TRỰC TIẾP khi bán).
     */
    public function store(Request $request, InventoryService $inventoryService, PromotionService $promotionService, LoyaltyService $loyaltyService): JsonResponse
    {
        // Chuẩn hóa IN HOA khi tra cứu voucher (backlog Spec 5, 2026-10-21): chỉ chuẩn hóa
        // phía đầu vào tra cứu (gõ thường/hoa đều trúng) — mã lưu trong DB giữ nguyên.
        if ($request->filled('voucher_code')) {
            $request->merge(['voucher_code' => strtoupper(trim((string) $request->input('voucher_code')))]);
        }
        $validated = $request->validate([
            'client_key' => 'nullable|string|max:64', // Gói 55 p11ac: idempotency key
            'branch_id' => 'required|exists:branches,id',
            'order_type' => ['nullable', \Illuminate\Validation\Rule::in(array_values(array_intersect(\App\Models\SharedCategory::activeCodes('order_types'), ['takeaway', 'delivery', 'dine_in'])))], // Spec danh mục dùng chung: validate động, giữ phạm vi POS
            'online_channel' => 'nullable|string|max:20', // Gói 57: kênh bán (pos/zalo/grabfood...)
            'table_id' => 'nullable|exists:tables,id',
            'customer_id' => 'nullable|exists:customers,id', // Gói 5: khách hàng thành viên
            'customer_name' => 'nullable|string|max:100',
            'customer_phone' => 'nullable|string|max:20',
            'payment_method' => 'nullable|string',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id', // Gói 5: khuyến mại Sapo
            'points_redeem' => 'nullable|integer|min:0', // Loyalty 2.0: giữ validate lỏng để client cũ không lỗi — giá trị bị BỎ QUA, không trừ điểm nữa
            'discount_amount' => 'nullable|numeric|min:0',
            'discount_percent' => 'nullable|numeric|min:0|max:100',
            'save_as_hold' => 'nullable|boolean', // Gói 3b: true = lưu đơn tạm (chưa thanh toán, chưa trừ kho)
            'note' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.product_option_id' => 'nullable|exists:product_options,id',
            'items.*.option_ids' => 'nullable|array', // Gói 8a: nhiều tùy chọn từ nhóm (size/topping)
            'items.*.option_ids.*' => 'exists:product_options,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_price' => 'nullable|numeric|min:0', // Gói 3e: giá bán tùy chỉnh từ popup
            'items.*.discount_amount' => 'nullable|numeric|min:0', // Gói 3e: giảm giá từng món
            'items.*.note' => 'nullable|string|max:255',
        ]);

        try {
            $actor = $request->user();
            $userId = $actor->id;
            // Gói 55 p11ac: kiểm tra quyền chiết khấu — chỉ role có orders.discount mới được giảm giá
            $canDiscount = true;
            if ($actor instanceof \App\Models\Employee) {
                $role = $actor->role;
                $canDiscount = $role && $role->hasPermission('orders.discount');
            }
            if (!$canDiscount) {
                if ((float) ($validated['discount_amount'] ?? 0) > 0 || (float) ($validated['discount_percent'] ?? 0) > 0) {
                    return response()->json(['success' => false, 'message' => 'Bạn không có quyền chiết khấu.'], 403);
                }
                foreach ($validated['items'] as $it) {
                    if ((float) ($it['discount_amount'] ?? 0) > 0) {
                        return response()->json(['success' => false, 'message' => 'Bạn không có quyền giảm giá món.'], 403);
                    }
                }
            }
            // Gói 55 p11ad: NV chỉ được tạo đơn cho chi nhánh mình được phân công
            if ($actor instanceof \App\Models\Employee) {
                $allowedBranches = $actor->allBranchIds();
                if (!in_array((int) $validated['branch_id'], $allowedBranches, true)) {
                    return response()->json(['success' => false, 'message' => 'Bạn không được phân công tại chi nhánh này.'], 403);
                }
            }
            // Gói 3b: đơn lưu tạm (held) thì CHƯA trừ kho, chỉ trừ khi bấm Thanh toán (finalize).
            $isHold = !empty($validated['save_as_hold']);
            // Gói 55 p11ac: idempotency — client_key đã tồn tại thì trả đơn cũ
            if (!empty($validated['client_key'])) {
                $existing = Order::with('items')->where('client_key', $validated['client_key'])->first();
                if ($existing) {
                    return response()->json(['success' => true, 'message' => 'Đơn đã được tạo trước đó', 'data' => $existing, 'duplicate' => true]);
                }
            }
            // Gói 55 p11ad: nhận về id các dòng nhật ký xuất kho để gắn order_id sau khi tạo đơn
            $movementIds = null;
            $order = DB::transaction(function () use ($validated, $inventoryService, $promotionService, $loyaltyService, $userId, $isHold, &$movementIds) {
                $subtotal = 0;
                $orderItemsData = [];
                $promoItems = []; // Gói 5: dữ liệu cho PromotionService

                // 1. Tính giá món
                foreach ($validated['items'] as $item) {
                    $product = Product::findOrFail($item['product_id']);
                    $option = !empty($item['product_option_id'])
                        ? ProductOption::findOrFail($item['product_option_id'])
                        : null;

                    // Gói 55 p11ac: đối chiếu giá client với giá server (chống gian lận giá)
                    // Món price_on_demand được nhập giá tay; còn lại phải khớp giá menu.
                    // Gói 55 p11ae: cộng giá các tùy chọn NHÓM (option_ids) — POS luôn gửi
                    // topping/size qua option_ids, product_option_id luôn null.
                    // So với base_price + tùy chọn (đúng giá POS hiển thị = product.price),
                    // KHÔNG dùng priceFor: nếu Đại Vương đặt giá kênh nha_hang khác base_price
                    // thì đơn vẫn tính theo giá frontend — quyết định nghiệp vụ cần chốt riêng.
                    $groupOptsPrice = !empty($item['option_ids'])
                        ? (float) ProductOption::whereIn('id', $item['option_ids'])->sum('additional_price')
                        : 0;
                    $expectedPrice = (float) $product->base_price + $groupOptsPrice
                        + ($option ? (float) $option->additional_price : 0);
                    if (isset($item['unit_price']) && empty($product->price_on_demand)) {
                        if (abs((float) $item['unit_price'] - $expectedPrice) > 1) {
                            throw new \Exception("Giá món '{$product->name}' không khớp (gửi: {$item['unit_price']}, đúng: {$expectedPrice}).");
                        }
                    }

                    // Gói 3e: cho phép giá bán tùy chỉnh từ popup (mặc định = giá menu + tùy chọn)
                    $unitPrice = isset($item['unit_price'])
                        ? (float) $item['unit_price']
                        : $expectedPrice;
                    $lineGross = $unitPrice * $item['quantity'];
                    // Gói 3e: giảm giá từng món (không vượt quá thành tiền dòng)
                    $itemDiscount = min((float) ($item['discount_amount'] ?? 0), $lineGross);
                    $itemTotal = $lineGross - $itemDiscount;
                    $subtotal += $itemTotal;

                    $orderItemsData[] = [
                        'product_id' => $product->id,
                        'product_option_id' => $option ? $option->id : null,
                        // Gói 8a: lưu danh sách tùy chọn nhóm đã chọn (để truy vết trừ kho)
                        // Gói 13: thống nhất format [id => name] (giữ ID) như OnlineOrderController
                        'options' => !empty($item['option_ids'])
                            ? ProductOption::whereIn('id', $item['option_ids'])->pluck('name', 'id')->toArray()
                            : null,
                        'product_name' => $product->name,
                        'price' => $product->base_price,
                        'unit_price' => $unitPrice,
                        'quantity' => $item['quantity'],
                        'subtotal' => $itemTotal,
                        'total_price' => $itemTotal,
                        'discount_amount' => $itemDiscount,
                        'note' => $item['note'] ?? null,
                        // Gói 55 p11ae: giá vốn cập nhật SAU khi trừ kho (xem bước 3 bên dưới) —
                        // lúc này $materialCosts chưa tồn tại nên để 0 tạm
                        'unit_cost' => 0,
                    ];
                    $promoItems[] = [
                        'product_id' => $product->id,
                        'category_id' => $product->category_id,
                        'quantity' => $item['quantity'],
                        'line_total' => $itemTotal,
                        'unit_price' => $unitPrice,
                    ];
                }

                // 2. Tính toán chiết khấu Voucher (nếu có) — tính riêng, chưa cộng vào tổng
                // (quyết định cộng dồn hay lấy max ở bước 2d theo cờ TỪNG chương trình)
                $voucherDiscount = 0;
                $discountAmount = 0;
                $appliedVoucher = null;

                if (!empty($validated['voucher_code'])) {
                    $voucher = Voucher::where('code', $validated['voucher_code'])
                        ->where('is_active', true)
                        ->lockForUpdate()
                        ->first();

                    if (!$voucher) {
                        throw new Exception('Mã khuyến mãi không hợp lệ hoặc đã bị khóa.');
                    }

                    if ($voucher->usage_limit && $voucher->used_count >= $voucher->usage_limit) {
                        throw new Exception('Mã khuyến mãi đã hết lượt sử dụng.');
                    }

                    if ($voucher->expires_at && now()->isAfter($voucher->expires_at)) {
                        throw new Exception('Mã khuyến mãi đã hết hạn.');
                    }

                    // Gói 55 p11ac: kiểm tra thời gian bắt đầu hiệu lực
                    if ($voucher->starts_at && now()->isBefore($voucher->starts_at)) {
                        throw new Exception('Mã khuyến mãi chưa đến thời gian áp dụng.');
                    }

                    if ($subtotal < $voucher->min_order_amount) {
                        throw new Exception("Đơn hàng tối thiểu phải đạt " . number_format($voucher->min_order_amount) . "đ để áp dụng voucher này.");
                    }

                    // Gói 55 p11af (P0-12): giới hạn số lần mỗi khách được dùng voucher
                    // (chống share mã tràn lan — mỗi KH chỉ được hưởng N lần)
                    $voucherCustomerId = $validated['customer_id'] ?? null;
                    if ($voucher->per_customer_limit && $voucherCustomerId) {
                        $usedTimes = VoucherUsage::where('voucher_id', $voucher->id)
                            ->where('customer_id', $voucherCustomerId)
                            ->lockForUpdate()
                            ->count();
                        if ($usedTimes >= $voucher->per_customer_limit) {
                            throw new Exception('Khách hàng này đã dùng hết lượt của mã khuyến mãi.');
                        }
                    }

                    if ($voucher->type === 'fixed') {
                        $voucherDiscount = $voucher->value;
                    } elseif ($voucher->type === 'percent') {
                        $voucherDiscount = ($subtotal * $voucher->value) / 100;
                        if ($voucher->max_discount_amount && $voucherDiscount > $voucher->max_discount_amount) {
                            $voucherDiscount = $voucher->max_discount_amount;
                        }
                    }

                    $voucherDiscount = min($voucherDiscount, $subtotal);
                    $appliedVoucher = $voucher;
                    // Lưu ý: used_count chỉ tăng ở bước 2d khi voucher thực sự được áp dụng
                    // (chế độ không cộng dồn mà voucher thua loại khác thì không tốn lượt)
                }

                // 2b. Chiết khấu thủ công từ POS (Gói 3): tính riêng, chưa cộng vào tổng.
                $manualDiscount = 0;
                if (!empty($validated['discount_percent'])) {
                    $manualDiscount += ($subtotal * $validated['discount_percent']) / 100;
                }
                if (!empty($validated['discount_amount'])) {
                    $manualDiscount += $validated['discount_amount'];
                }

                // 2c. Gói 5: Khuyến mại Sapo (validate lại phía server chống giả mạo) — tính riêng.
                $promotionDiscount = 0;
                $appliedPromotion = null;
                $giftLine = null;
                if (!empty($validated['promotion_id'])) {
                    $eligible = $promotionService->eligiblePromotions([
                        'subtotal' => $subtotal,
                        'items' => $promoItems,
                        'customer_id' => $validated['customer_id'] ?? null,
                        'channel' => 'pos',
                    ]);
                    $found = collect($eligible)->firstWhere('id', (int) $validated['promotion_id']);
                    if (!$found) {
                        throw new Exception('Khuyến mại không còn đủ điều kiện áp dụng.');
                    }
                    $appliedPromotion = Promotion::findOrFail($validated['promotion_id']);
                    $promotionDiscount = min((float) $found['discount'], $subtotal);
                    // Tặng món: chuẩn bị dòng 0đ (thêm vào đơn ở bước 2d;
                    // gift không phải giảm giá tiền nên không tham gia so sánh cộng dồn)
                    if ($appliedPromotion->type === 'gift' && $appliedPromotion->gift_product_id) {
                        $giftProduct = Product::findOrFail($appliedPromotion->gift_product_id);
                        $giftLine = [
                            'product_id' => $giftProduct->id,
                            'product_option_id' => null,
                            'product_name' => $giftProduct->name . ' (KM tặng)',
                            'price' => 0,
                            'unit_price' => 0,
                            'quantity' => $appliedPromotion->gift_quantity,
                            'subtotal' => 0,
                            'total_price' => 0,
                            'discount_amount' => 0,
                            'note' => 'Quà tặng từ KM: ' . $appliedPromotion->name,
                        ];
                    }
                }

                // 2d. Mô hình cộng dồn MỚI (Đại Vương chốt 2026-10-21 ~22:45, thay
                // Spec 3 cũ): BỎ công tắc toàn cục promo_allow_stack — quyền cộng dồn
                // nằm ở TỪNG chương trình: KM stack_with_coupon + voucher
                // stack_with_promotion cùng bật mới thành 1 cặp KM + 1 coupon.
                // - CK tay KHÔNG cộng dồn: có CK tay → CK tay THAY toàn bộ kết quả
                //   KM/voucher (voucher không tốn lượt, KM không ghi nhận).
                // - Có cặp hợp lệ: so tổng cặp với từng lựa chọn đơn lẻ SAU trần —
                //   áp phần lợi nhất; cặp hòa KM đơn lẻ → KM đơn lẻ (giữ voucher).
                // - Không có cặp: chọn phần lợi nhất KM/voucher; hòa → KM thắng,
                //   voucher không bị trừ (luật hòa đã chốt ở Spec 3).
                // - Trần: tổng giảm giá không vượt promo_max_discount_pct % subtotal.
                $maxDiscountPct = (float) Setting::get('promo_max_discount_pct', 50);
                $capAmount = ($maxDiscountPct > 0 && $maxDiscountPct < 100)
                    ? $subtotal * $maxDiscountPct / 100
                    : $subtotal;
                if ($manualDiscount > 0) {
                    $discountAmount = min($manualDiscount, $capAmount);
                    $appliedVoucher = null;
                    // KM tiền bị CK tay thay thế; KM tặng món vẫn tặng qua $giftLine
                    // ở dưới (không phải giảm tiền) — nhưng không ghi nhận KM vào đơn,
                    // khớp hành vi cũ khi KM không thắng.
                    $appliedPromotion = null;
                    $promotionDiscount = 0;
                } else {
                    $pairAllowed = $appliedVoucher && $appliedPromotion
                        && $voucherDiscount > 0 && $promotionDiscount > 0
                        && (bool) $appliedPromotion->stack_with_coupon
                        && (bool) $appliedVoucher->stack_with_promotion;
                    $promoSingle = $promotionDiscount > 0 ? min($promotionDiscount, $capAmount) : 0;
                    $voucherSingle = $voucherDiscount > 0 ? min($voucherDiscount, $capAmount) : 0;
                    $pairTotal = $pairAllowed ? min($voucherDiscount + $promotionDiscount, $capAmount) : 0;
                    if ($pairAllowed && $pairTotal > $promoSingle && $pairTotal > $voucherSingle) {
                        // Cặp thắng hẳn cả hai lựa chọn đơn lẻ → áp cặp, voucher bị trừ lượt.
                        $discountAmount = $pairTotal;
                        $appliedVoucher->increment('used_count');
                    } elseif ($appliedPromotion && $appliedPromotion->type !== 'gift'
                        && $promotionDiscount > 0 && $promotionDiscount >= $voucherDiscount) {
                        // KM đơn lẻ thắng (hòa → KM thắng): voucher giữ nguyên.
                        $discountAmount = $promoSingle;
                        $appliedVoucher = null;
                    } elseif ($appliedVoucher && $voucherDiscount > 0) {
                        $discountAmount = $voucherSingle;
                        $appliedVoucher->increment('used_count');
                        $appliedPromotion = null;
                        $promotionDiscount = 0;
                    } else {
                        $discountAmount = 0;
                        $appliedVoucher = null;
                        $appliedPromotion = null;
                        $promotionDiscount = 0;
                    }
                }
                if ($giftLine) {
                    $orderItemsData[] = $giftLine;
                }
                if ($maxDiscountPct > 0 && $maxDiscountPct < 100) {
                    $discountAmount = min($discountAmount, $subtotal * $maxDiscountPct / 100);
                }
                $discountAmount = min($discountAmount, $subtotal);

                // 2d. Khách hàng của đơn (gắn điểm/hạng)
                // Loyalty 2.0 (2026-10-21): trừ điểm trực tiếp vào đơn POS ĐÃ GỠ
                // (spec mục 4.2) — điểm chỉ đổi coupon ở Cửa hàng điểm trên Mini
                // App. Client cũ còn gửi points_redeem → bỏ qua im lặng.
                $customer = null;
                $pointsUsed = 0;
                $pointsDiscount = 0;
                if (!empty($validated['customer_id'])) {
                    $customer = Customer::findOrFail($validated['customer_id']);
                }

                $discountAmount = min($discountAmount, $subtotal);
                $finalAmount = $subtotal - $discountAmount;

                // 3. Trừ kho trực tiếp khi bán (BOM + FIFO). Ném Exception nếu thiếu hàng.
                // Đơn held: bỏ qua bước này.
                $materialCosts = [];
                if (!$isHold) {
                    $deductLines = array_map(fn($i) => [
                        'product_id' => $i['product_id'],
                        'product_option_id' => $i['product_option_id'] ?? null,
                        'option_ids' => $i['option_ids'] ?? [], // Gói 8a: trừ định mức từng tùy chọn
                        'quantity' => $i['quantity'],
                    ], $validated['items']);
                    // Gói 5: món tặng từ KM cũng trừ kho
                    if ($giftLine) {
                        $deductLines[] = [
                            'product_id' => $giftLine['product_id'],
                            'product_option_id' => null,
                            'quantity' => $giftLine['quantity'],
                        ];
                    }
                    // Gói 55 p11ac: trả về giá vốn BQ từng NL để lưu vào order_items
                    // Gói 55 p11ad: $movementIds (by-ref) nhận về id các dòng log để gắn order_id sau
                    $materialCosts = $inventoryService->deductStock($validated['branch_id'], $deductLines, ['type' => 'order'], $movementIds);
                    // Gói 55 p11ae: cập nhật giá vốn cho TẤT CẢ các dòng (trước đó $materialCosts
                    // chưa tồn tại khi build $orderItemsData nên unit_cost đang = 0)
                    foreach ($orderItemsData as &$od) {
                        $od['unit_cost'] = $this->calcItemUnitCost(
                            $od['product_id'],
                            !empty($od['options']) ? array_keys((array) $od['options']) : [],
                            $materialCosts,
                            $od['product_option_id'] ?? null
                        );
                    }
                    unset($od);
                }

                // 4. Liên kết ca làm việc đang mở (nếu có)
                $activeShift = \App\Models\Shift::where('branch_id', $validated['branch_id'])
                    ->where('status', 'open')
                    ->latest()
                    ->first();

                // 5. Tạo hóa đơn
                $tableId = $validated['table_id'] ?? null;
                // Gói 57: snapshot phí sàn lúc tạo đơn (kênh POS mặc định không phí)
                $orderChannel = $validated['online_channel'] ?? 'pos';
                $orderPriceList = \App\Models\PriceList::whereRaw('LOWER(code) = ?', [strtolower($orderChannel)])->first();
                $orderCommissionRate = $orderPriceList ? (float) $orderPriceList->commission_rate : 0;
                $orderCommissionAmount = $orderCommissionRate > 0 ? (int) round($finalAmount * $orderCommissionRate / 100) : 0;
                $orderCode = $this->generateUniqueOrderCode(); // Rà mã 2026-10-20: order_number = mã đơn
                $order = Order::create([
                    'user_id' => $userId,
                    'branch_id' => $validated['branch_id'],
                    'order_type' => $validated['order_type'] ?? 'takeaway',
                    'online_channel' => $orderChannel,
                    'commission_rate' => $orderCommissionRate,
                    'commission_amount' => $orderCommissionAmount,
                    'table_id' => $tableId,
                    'shift_id' => $activeShift ? $activeShift->id : null,
                    'order_number' => $orderCode,
                    'code' => $orderCode,
                    'client_key' => $validated['client_key'] ?? null, // Gói 55 p11ac
                    'customer_id' => $customer ? $customer->id : null, // Gói 5
                    'customer_name' => $customer ? $customer->name : ($validated['customer_name'] ?? 'Khách lẻ'),
                    'customer_phone' => $customer ? $customer->phone : ($validated['customer_phone'] ?? null),
                    'subtotal_amount' => $subtotal,
                    'discount_amount' => $discountAmount,
                    'voucher_code' => $appliedVoucher ? $appliedVoucher->code : null,
                    'promotion_id' => $appliedPromotion ? $appliedPromotion->id : null, // Gói 5
                    'promotion_discount' => $promotionDiscount, // Gói 5
                    'points_redeemed' => $pointsUsed, // Gói 5
                    'total_amount' => $finalAmount,
                    'payment_method' => $validated['payment_method'] ?? 'cash',
                    'payment_status' => $isHold ? 'pending' : 'paid',
                    'status' => $isHold ? 'held' : 'pending',
                    'stock_deducted' => !$isHold,
                    'note' => $validated['note'] ?? null,
                ]);

                // 5b. Gói 3b: đơn gắn bàn -> đánh dấu bàn có khách (cả đơn lưu và đơn đã thanh toán)
                if ($tableId) {
                    \App\Models\Table::where('id', $tableId)->update(['status' => 'occupied']);
                }
                // Gói 55 p11ad: gắn order_id cho nhật ký xuất kho vừa ghi
                if (!empty($movementIds)) {
                    \App\Models\StockMovement::whereIn('id', $movementIds)->update(['reference_id' => $order->id]);
                }

                // Gói 55 p11af (P0-12): ghi log lượt dùng voucher theo khách
                // (để đếm giới hạn per_customer_limit + truy vết khi mã bị share)
                if ($appliedVoucher && $order->customer_id) {
                    VoucherUsage::create([
                        'voucher_id' => $appliedVoucher->id,
                        'customer_id' => $order->customer_id,
                        'order_id' => $order->id,
                        'used_at' => now(),
                    ]);
                }

                // 6. Ghi nhận chi tiết từng món trong đơn
                foreach ($orderItemsData as $itemData) {
                    $order->items()->create($itemData);
                }

                // 6b. Tích điểm khi thanh toán ngay (đơn held tích lúc finalize).
                // Loyalty 2.0: không còn bước trừ điểm tại đơn (applyRedeem đã ngừng gọi).
                if ($customer && !$isHold) {
                    $order->points_earned = $loyaltyService->earnForOrder($customer, $order, (float) $finalAmount);
                    $order->save();
                }

                return $order->load('items.product');
            });

            return response()->json([
                'success' => true,
                'message' => $isHold ? 'Lưu đơn thành công' : 'Đặt hàng thành công',
                'data' => $order
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
            // Gói SEC2: không lộ message SQL thô ra client (lộ cấu trúc DB)
            $message = $e instanceof \Illuminate\Database\QueryException
                ? 'Có lỗi xảy ra. Vui lòng thử lại.'
                : $e->getMessage();
            // Spec P4-A1: BTP thiếu → trả cấu trúc để POS gợi ý tạo phiếu chế biến
            $btp = $e->btpShortage ?? null;
            return response()->json([
                'success' => false,
                'message' => $btp
                    ? "Bán thành phẩm \"{$btp['material_name']}\" không đủ (cần {$btp['needed']}{$btp['unit']}, còn {$btp['available']}{$btp['unit']})."
                    : $message,
                'btp_shortage' => $btp,
            ], $btp ? 422 : 400);
        }
    }

    /**
     * Cập nhật tiến độ pha chế / trạng thái đơn hàng (KDS Workflow).
     *
     * Gói 1: BỎ trừ kho tại đây — kho đã trừ trực tiếp khi tạo đơn (store),
     * trừ thêm lần nữa sẽ bị double-deduction.
     */
    public function updateStatus(Request $request, string $id)
    {
        $request->validate([
            'status' => 'required|in:pending,processing,ready,completed'
        ]);

        // Tìm đơn theo code hoặc id kèm theo danh sách món (items)
        $order = Order::with('items')->where('code', $id)->orWhere('id', $id)->firstOrFail();
        if ($deny = $this->denyOrderBranch($request, $order->branch_id)) return $deny;

        // Gói 55 p11ac: state machine — chặn chuyển đổi không hợp lệ
        // - 'cancelled' phải đi qua cancel() (hoàn kho/điểm), không cho set trực tiếp
        // - 'held' là trạng thái đặc biệt, không set qua updateStatus
        $allowed = [
            'pending' => ['processing'],
            'processing' => ['ready'],
            'ready' => ['completed'],
            // Audit 2026-10-21 🔴3: đơn COD cũ đang kẹt ở 'confirmed' (notify bản trước)
            // phải có đường đi tiếp vào pha chế như đơn thường.
            'confirmed' => ['processing'],
            'held' => [], // đơn lưu: chỉ finalize hoặc cancel
            'completed' => [],
            'cancelled' => [],
        ];
        $from = $order->status;
        $to = $request->status;
        if (!in_array($to, $allowed[$from] ?? [])) {
            return response()->json([
                'success' => false,
                'message' => "Không thể chuyển từ '{$from}' sang '{$to}'.",
            ], 422);
        }

        $order->status = $to;
        // Gói 56 (2026-10-14): ghi mốc bếp bấm "Sẵn sàng" để tính thời gian pha chế TB
        if ($request->status === 'ready' && !$order->ready_at) {
            $order->ready_at = now();
        }
        // Gói 12a: ghi mốc hoàn thành để Mini App giới hạn tra cứu 24h
        if ($request->status === 'completed' && !$order->completed_at) {
            $order->completed_at = now();
        }
        $order->save();

        // Gói 60: đơn giao hàng được xác nhận (pending → processing) → tạo đơn hãng.
        // Tạo thất bại không chặn luồng: đơn nằm chờ, Admin bấm "thử tạo lại" (checklist #11).
        if ($from === 'pending' && $to === 'processing' && $order->order_type === 'delivery') {
            $this->createDeliveryOrder($order);
        }

        // Gói 3c: đơn hoàn thành -> giải phóng bàn nếu không còn đơn hoạt động nào khác
        if ($request->status === 'completed') {
            $this->releaseTableIfFree($order);
        }

        return response()->json([
            'success' => true,
            'message' => 'Cập nhật trạng thái thành công',
            'data' => $order
        ]);
    }

    /**
     * Gói 60: tạo đơn hãng giao hàng cho đơn đã xác nhận.
     * Idempotent: đơn đã có delivery_order_id thì bỏ qua (tránh tạo trùng khi bấm 2 lần).
     */
    private function createDeliveryOrder(\App\Models\Order $order): void
    {
        if ($order->delivery_order_id) return; // đã có đơn hãng
        try {
            $service = app(\App\Services\Delivery\DeliveryService::class);
            if (!$service->isConfigured()) return; // chưa cấu hình hãng: giữ luồng cũ
            // COD = tổng khách trả khi nhận hàng (0 nếu đã trả trước)
            $cod = $order->payment_status === 'paid' ? 0 : (int) round((float) $order->total_amount);
            $order->delivery_cod_amount = $cod;
            // Phí ship đã khóa lúc chốt đơn: GIỮ phí gốc đã lưu (đối soát hãng) —
            // audit 2026-10-21 🔴1: chỉ fallback khi chưa có, không ghi đè bằng phí khách chịu.
            $order->delivery_quoted_fee = $order->delivery_quoted_fee ?? $order->delivery_fee_charged ?? $order->shipping_fee;
            $order->save();
            $service->createForOrder($order->fresh(), []);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[Delivery] createDeliveryOrder failed', [
                'order' => $order->code, 'msg' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Hủy đơn hàng và tự động hoàn trả nguyên vật liệu vào kho.
     */
    public function cancel(Request $request, int $id, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'required|string|max:255',
            'restock' => 'boolean', // true: có hoàn kho, false: hủy không hoàn
        ]);

        if ($deny = $this->denyOrderById($request, $id)) return $deny;
        $shouldRestock = $validated['restock'] ?? true;

        // Gói 55 p11ag: xác định người hủy để truy vết (user=admin, employee=NV)
        $actor = $request->user();
        $cancelledBy = $actor instanceof \App\Models\Employee
            ? ($actor->full_name ?: ('NV#' . $actor->id))
            : ($actor->name ?? ('Admin#' . $actor->id));
        $cancelledByType = $actor instanceof \App\Models\Employee ? 'employee' : 'user';

        try {
            $order = DB::transaction(function () use ($id, $validated, $shouldRestock, $inventoryService, $loyaltyService, $cancelledBy, $cancelledByType) {
                return $this->performCancel($id, $validated['reason'], $shouldRestock, $inventoryService, $loyaltyService, $cancelledBy, $cancelledByType);
            });

            return response()->json([
                'success' => true,
                'message' => 'Hủy đơn hàng thành công' . ($shouldRestock ? ' và đã hoàn trả nguyên vật liệu vào kho.' : '.'),
                'data' => $order,
            ], 200);

        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => $this->clientErrorMessage($e),
            ], 400);
        }
    }

    /**
     * Gói 33: lõi HỦY đơn dùng chung cho cancel đơn lẻ và bulk cancel.
     * KHÔNG tự mở transaction — caller bọc ngoài.
     */
    private function performCancel(int $id, string $reason, bool $shouldRestock, InventoryService $inventoryService, LoyaltyService $loyaltyService, ?string $cancelledBy = null, ?string $cancelledByType = null): Order
    {
        $order = Order::with('items')->lockForUpdate()->findOrFail($id);

        if ($order->status === 'cancelled') {
            throw new Exception('Đơn hàng này đã được hủy trước đó.');
        }

        // Gói 55 p11ae: earn điểm chỉ chạy với đơn đã paid → chụp lại trạng thái trước khi
        // đổi sang cancelled/refunded để revokeEarn biết có cần trừ lại total_spent không.
        $wasPaid = $order->payment_status === 'paid';

        // Hoàn trả nguyên vật liệu theo BOM nếu restock = true
        // Gói 3b: đơn held chưa từng trừ kho (stock_deducted=false) thì không có gì để hoàn.
        if ($shouldRestock && $order->stock_deducted) {
            // Gói 13: hoàn cả topping/size (option_ids từ options [id => name])
            // Gói SEC2: truyền order id để hoàn đúng lô đã trừ
            $inventoryService->restock(
                $order->branch_id ?? 1,
                $order->items->map(fn($item) => [
                    'product_id' => $item->product_id,
                    'product_option_id' => $item->product_option_id,
                    'option_ids' => $this->itemOptionIds($item),
                    'quantity' => $item->quantity,
                ])->toArray(),
                $order->id
            );
        }

        $order->status = 'cancelled';
        $order->payment_status = 'refunded';
        $order->cancel_reason = $reason;
        $order->cancelled_at = now();
        // Gói 55 p11ag: truy vết người hủy đơn (chống gian lận hủy đơn bỏ túi)
        $order->cancelled_by = $cancelledBy;
        $order->cancelled_by_type = $cancelledByType;
        $order->save();

        // Gói 5: hoàn điểm đã đổi khi hủy đơn
        $loyaltyService->refundRedeem($order);

        // Gói 13: thu hồi điểm đã TÍCH khi hủy đơn (chống gian lận)
        // Gói 55 p11ae: truyền $wasPaid — đơn held hủy khi chưa paid thì earn chưa chạy,
        // không được trừ total_spent.
        $loyaltyService->revokeEarn($order, $wasPaid);

        // Gói 55 p11ac: hoàn lượt dùng voucher khi hủy đơn
        if (!empty($order->voucher_code)) {
            \App\Models\Voucher::where('code', $order->voucher_code)
                ->where('used_count', '>', 0)
                ->decrement('used_count');
            // Gói 55 p11af (P0-12): xóa log lượt dùng để hoàn lại lượt cho khách
            VoucherUsage::where('order_id', $order->id)->delete();
        }

        // Gói 3b: nếu là đơn lưu gắn bàn -> trả bàn về trống khi không còn đơn lưu nào khác
        $this->releaseTableIfFree($order);

        // Gói 60: hủy đơn hãng tương ứng nếu tài xế chưa lấy hàng (checklist #10).
        // Trạng thái hai phía khớp nhau; phí hủy (nếu hãng tính) ghi nhận vào đơn.
        $this->cancelDeliveryOrder($order, $reason);

        return $order;
    }

    /**
     * Gói 60: hủy đơn phía hãng khi đơn nội bộ bị hủy.
     * Chỉ hủy khi tài xế chưa lấy hàng (searching/driver_assigned).
     */
    private function cancelDeliveryOrder(\App\Models\Order $order, string $reason): void
    {
        if (empty($order->delivery_order_id) || empty($order->delivery_provider)) return;
        $beforePickup = in_array($order->delivery_status, [
            \App\Services\Delivery\DeliveryService::ST_SEARCHING,
            \App\Services\Delivery\DeliveryService::ST_ASSIGNED,
        ], true);
        if (!$beforePickup) return;
        try {
            $service = app(\App\Services\Delivery\DeliveryService::class);
            $provider = $service->provider($order->delivery_provider);
            if (!$provider) return;
            $result = $provider->cancelOrder($order->delivery_order_id, $reason);
            \App\Models\DeliveryLog::create([
                'order_id' => $order->id, 'provider' => $order->delivery_provider,
                'provider_order_id' => $order->delivery_order_id,
                'event' => 'cancel',
                'payload' => ['success' => $result['success'], 'cancel_fee' => $result['cancel_fee'] ?? 0],
            ]);
            $order->delivery_status = \App\Services\Delivery\DeliveryService::ST_CANCELLED;
            if (!empty($result['cancel_fee'])) {
                $order->note = trim(($order->note ? $order->note . ' | ' : '') . 'Phí hủy giao hàng: ' . number_format($result['cancel_fee'], 0) . 'đ');
            }
            $order->save();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[Delivery] cancelDeliveryOrder failed', [
                'order' => $order->code, 'msg' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Gói 33 (2026-10-09): THAO TÁC HÀNG LOẠT hóa đơn — CHỈ admin cấp cao nhất
     * (route middleware permission:orders.bulk).
     * POST /api/orders/bulk-action {ids, action: cancel|delete, reason?}
     * - cancel: tái dùng performCancel (hoàn kho nếu đã trừ, hoàn/thu hồi điểm);
     *          bỏ qua đơn đã cancelled (báo skipped).
     * - delete: XÓA VĨNH VIỄN đơn + items, KHÔNG hoàn kho (dùng cho đơn nháp/test;
     *          muốn hoàn kho thì dùng Hủy).
     */
    public function bulkAction(Request $request, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1|max:200',
            'ids.*' => 'integer|exists:orders,id',
            'action' => 'required|in:cancel,delete',
            'reason' => 'nullable|string|max:255',
        ]);
        $ids = array_values(array_unique($validated['ids']));
        $action = $validated['action'];
        $reason = $validated['reason'] ?? 'Hủy hàng loạt';

        // Gói 55 p11ag: xác định người hủy để truy vết
        $actor = $request->user();
        $cancelledBy = $actor instanceof \App\Models\Employee
            ? ($actor->full_name ?: ('NV#' . $actor->id))
            : ($actor->name ?? ('Admin#' . $actor->id));
        $cancelledByType = $actor instanceof \App\Models\Employee ? 'employee' : 'user';

        try {
            $result = DB::transaction(function () use ($ids, $action, $reason, $inventoryService, $loyaltyService, $cancelledBy, $cancelledByType) {
                $done = 0;
                $skipped = 0;
                foreach ($ids as $id) {
                    $order = Order::find($id);
                    if (!$order) { $skipped++; continue; }
                    if ($action === 'cancel') {
                        if ($order->status === 'cancelled') { $skipped++; continue; }
                        $this->performCancel($id, $reason, true, $inventoryService, $loyaltyService, $cancelledBy, $cancelledByType);
                        $done++;
                    } else {
                        // Gói 55 p11ac: chỉ xóa đơn nháp (held) hoặc chưa thanh toán — đơn đã paid phải dùng Hủy đơn
                        $isDraft = $order->status === 'held' || $order->payment_status === 'pending';
                        if (!$isDraft) { $skipped++; continue; }
                        // HD-R3: xóa đơn cũng phải hoàn điểm/voucher như khi hủy
                        // (đơn held có thể đã đổi điểm/dùng voucher)
                        $loyaltyService->refundRedeem($order);
                        $loyaltyService->revokeEarn($order, $order->payment_status === 'paid');
                        if (!empty($order->voucher_code)) {
                            \App\Models\Voucher::where('code', $order->voucher_code)
                                ->where('used_count', '>', 0)
                                ->decrement('used_count');
                            VoucherUsage::where('order_id', $order->id)->delete();
                        }
                        $order->items()->delete();
                        $order->delete();
                        $done++;
                    }
                }
                return ['done' => $done, 'skipped' => $skipped];
            });

            $msg = $action === 'cancel'
                ? "Đã hủy {$result['done']} hóa đơn" . ($result['skipped'] ? " (bỏ qua {$result['skipped']} đơn đã hủy trước đó)" : '') . '.'
                : "Đã xóa vĩnh viễn {$result['done']} hóa đơn." . ($result['skipped'] ? " (bỏ qua {$result['skipped']} đơn đã thanh toán — dùng Hủy đơn)" : '');
            return response()->json(['success' => true, 'message' => $msg, 'data' => $result]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Gói 3 (2026-10-04): TÁCH ĐƠN.
     * Chuyển một phần món của đơn gốc sang đơn mới.
     * Kho KHÔNG thay đổi (tổng số món giữ nguyên) — chỉ chia lại items giữa 2 đơn.
     * Chỉ cho đơn chưa hoàn thành / chưa hủy.
     */
    public function split(Request $request, int $id, InventoryService $inventoryService): JsonResponse
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.order_item_id' => 'required|exists:order_items,id',
            'items.*.quantity' => 'required|integer|min:1',
            'customer_name' => 'nullable|string|max:100',
            'note' => 'nullable|string',
        ]);

        try {
            $srcBranch = Order::where('id', $id)->value('branch_id');
            if ($srcBranch !== null && ($deny = $this->denyOrderBranch($request, $srcBranch))) return $deny;
            $result = DB::transaction(function () use ($id, $validated, $inventoryService) {
                $source = Order::with('items')->lockForUpdate()->findOrFail($id);

                if (in_array($source->status, ['cancelled', 'completed'])) {
                    throw new Exception('Không thể tách đơn đã hoàn thành hoặc đã hủy.');
                }

                $moveItems = [];
                foreach ($validated['items'] as $req) {
                    $item = $source->items->firstWhere('id', $req['order_item_id']);
                    if (!$item) {
                        throw new Exception("Món #{$req['order_item_id']} không thuộc đơn này.");
                    }
                    if ($req['quantity'] > $item->quantity) {
                        throw new Exception("Số lượng tách ({$req['quantity']}) vượt quá số lượng món ({$item->quantity}).");
                    }
                    $moveItems[] = ['item' => $item, 'quantity' => $req['quantity']];
                }

                // Tạo đơn mới (không trừ kho lại)
                $newOrderCode = $this->generateUniqueOrderCode(); // Rà mã 2026-10-20
                $newOrder = Order::create([
                    'user_id' => $source->user_id,
                    'branch_id' => $source->branch_id,
                    'order_type' => $source->order_type,
                    'table_id' => $source->table_id,
                    'shift_id' => $source->shift_id,
                    'order_number' => $newOrderCode,
                    'code' => $newOrderCode,
                    'customer_name' => $validated['customer_name'] ?? $source->customer_name,
                    'customer_phone' => $source->customer_phone,
                    'status' => $source->status,
                    'payment_method' => $source->payment_method,
                    'payment_status' => 'pending',
                    'stock_deducted' => $source->stock_deducted, // Gói 3b: kế thừa trạng thái trừ kho
                    'note' => $validated['note'] ?? ('Tách từ ' . $source->code),
                ]);

                $newSubtotal = 0;
                // Gói SEC2: subtotal gốc TRƯỚC khi tách (để phân bổ CK cấp đơn theo tỷ lệ)
                $sourceSubtotalBefore = $source->items->sum(fn($i) => $i->unit_price * $i->quantity - ($i->discount_amount ?? 0));
                $sourceOrderDiscount = (float) $source->discount_amount;
                foreach ($moveItems as $mv) {
                    /** @var \App\Models\OrderItem $item */
                    $item = $mv['item'];
                    $qty = $mv['quantity'];

                    // Gói 3e: chiết khấu món tách theo tỉ lệ số lượng
                    $moveDiscount = $item->quantity > 0
                        ? round($item->discount_amount * $qty / $item->quantity)
                        : 0;
                    $moveDiscount = min($moveDiscount, $item->unit_price * $qty);
                    $lineNet = $item->unit_price * $qty - $moveDiscount;

                    $newOrder->items()->create([
                        'product_id' => $item->product_id,
                        'product_option_id' => $item->product_option_id,
                        'options' => $item->options, // Gói 13: giữ topping/size đã chọn
                        'option_ids' => $item->option_ids, // Audit 23/10 KHO-06: giữ ids đã lưu (import)
                        'product_name' => $item->product_name,
                        'price' => $item->price,
                        'unit_price' => $item->unit_price,
                        'quantity' => $qty,
                        'subtotal' => $lineNet,
                        'total_price' => $lineNet,
                        'discount_amount' => $moveDiscount,
                        'note' => $item->note,
                    ]);
                    $newSubtotal += $lineNet;

                    // Giảm số lượng ở đơn gốc (xóa dòng nếu tách hết)
                    if ($qty >= $item->quantity) {
                        $item->delete();
                    } else {
                        $item->quantity -= $qty;
                        $item->discount_amount = max(0, $item->discount_amount - $moveDiscount);
                        $item->subtotal = $item->unit_price * $item->quantity - $item->discount_amount;
                        $item->total_price = $item->unit_price * $item->quantity - $item->discount_amount;
                        $item->save();
                    }
                }

                // Audit 2026-10-23 KHO-01: chuyển phần nhật ký trừ kho tương ứng
                // các dòng đã tách sang đơn mới — hủy đơn nào hoàn đúng phần đơn đó.
                if ($source->stock_deducted) {
                    $inventoryService->reassignMovementsForSplit(
                        $source->id,
                        $newOrder->id,
                        collect($moveItems)->map(fn($mv) => [
                            'product_id' => $mv['item']->product_id,
                            'product_option_id' => $mv['item']->product_option_id,
                            'option_ids' => $this->itemOptionIds($mv['item']),
                            'quantity' => $mv['quantity'],
                        ])->toArray()
                    );
                }

                $newOrder->subtotal_amount = $newSubtotal;
                // Gói SEC2: phân bổ chiết khấu cấp đơn theo tỷ lệ món tách (thay vì set 0)
                $moveOrderDiscount = $sourceSubtotalBefore > 0
                    ? (int) round($sourceOrderDiscount * $newSubtotal / $sourceSubtotalBefore)
                    : 0;
                $moveOrderDiscount = max(0, min($moveOrderDiscount, $newSubtotal));
                $newOrder->discount_amount = $moveOrderDiscount;
                $newOrder->total_amount = $newSubtotal - $moveOrderDiscount;
                $newOrder->save();

                // Tính lại tổng đơn gốc (trừ chiết khấu từng món), giữ phần CK còn lại
                $source->refresh();
                $sourceSubtotal = $source->items->sum(fn($i) => $i->unit_price * $i->quantity - ($i->discount_amount ?? 0));
                $source->subtotal_amount = $sourceSubtotal;
                $source->discount_amount = max(0, min($sourceOrderDiscount - $moveOrderDiscount, $sourceSubtotal));
                $source->total_amount = $sourceSubtotal - $source->discount_amount;
                $source->save();

                return ['source' => $source->load('items'), 'new_order' => $newOrder->load('items')];
            });

            return response()->json(['success' => true, 'message' => 'Tách đơn thành công', 'data' => $result]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Gói 3 (2026-10-04): GỘP ĐƠN.
     * Gộp nhiều đơn vào đơn đích (target). Các đơn còn lại bị hủy.
     * Gói 3b: cho phép gộp đơn đang lưu (held). Xử lý kho đúng:
     * - Nếu đơn nguồn đã trừ kho nhưng đơn đích chưa (held): hoàn kho đơn nguồn trước khi gộp,
     *   để khi đơn đích thanh toán (finalize) chỉ trừ 1 lần.
     * - Các trường hợp còn lại: tổng số món không đổi nên kho giữ nguyên.
     * Đơn đã hoàn thành / đã hủy: không được gộp.
     */
    public function merge(Request $request, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        $validated = $request->validate([
            'target_order_id' => 'required|exists:orders,id',
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'exists:orders,id',
        ]);

        if ($deny = $this->denyOrderById($request, (int) $validated['target_order_id'])) return $deny;
        try {
            $result = DB::transaction(function () use ($validated, $inventoryService, $loyaltyService) {
                $target = Order::with('items')->lockForUpdate()->findOrFail($validated['target_order_id']);

                if (in_array($target->status, ['cancelled', 'completed'])) {
                    throw new Exception('Đơn đích đã hoàn thành hoặc đã hủy.');
                }

                $mergedCodes = [];
                // P0-3: tích lũy CK (tay/KM) từ các đơn nguồn để cộng sang đơn đích
                $transferredDiscount = 0;
                foreach ($validated['order_ids'] as $oid) {
                    if ($oid == $target->id) {
                        continue;
                    }
                    $src = Order::with('items')->lockForUpdate()->findOrFail($oid);

                    if ($src->branch_id !== $target->branch_id) {
                        throw new Exception("Đơn {$src->code} khác chi nhánh, không thể gộp.");
                    }
                    if (in_array($src->status, ['cancelled', 'completed'])) {
                        throw new Exception("Đơn {$src->code} đã hoàn thành hoặc đã hủy.");
                    }

                    // Gói 3b: đơn nguồn đã trừ kho nhưng đơn đích là đơn lưu (chưa trừ)
                    // -> hoàn kho đơn nguồn để tránh trừ 2 lần khi đơn đích thanh toán.
                    // Gói 13: hoàn cả topping/size (option_ids)
                    if ($src->stock_deducted && !$target->stock_deducted) {
                        // Gói SEC2: truyền order id để hoàn đúng lô đã trừ
                        $inventoryService->restock(
                            $src->branch_id,
                            $src->items->map(fn($item) => [
                                'product_id' => $item->product_id,
                                'product_option_id' => $item->product_option_id,
                                'option_ids' => $item->options ? array_keys((array) $item->options) : [],
                                'quantity' => $item->quantity,
                            ])->toArray(),
                            $src->id
                        );
                    }
                    // Gói 55 p11ac: đơn nguồn là đơn lưu (chưa trừ kho) nhưng đơn đích đã thanh toán (đã trừ)
                    // -> trừ kho cho các món từ nguồn, tránh tồn kho cao hơn thực tế
                    $needDeductSrc = !$src->stock_deducted && $target->stock_deducted;

                    // Chuyển từng món sang đơn đích.
                    // Gói 3e: chỉ gộp dòng khi cùng món + tùy chọn + đơn giá + ghi chú
                    // và KHÔNG có chiết khấu từng món (dòng có chiết khấu giữ riêng để không sai tiền).
                    // Gói 13: thêm so sánh options (topping/size đã chọn) để không gộp sai 2 dòng khác topping.
                    // Gói 55 p11ae: theo dõi id các dòng bị ảnh hưởng bởi lần gộp này
                    // (để cập nhật giá vốn — không ghi đè dòng cũ của đơn đích)
                    $affectedItemIds = [];
                    foreach ($src->items as $item) {
                        $existing = ((float) ($item->discount_amount ?? 0) === 0) ? $target->items->first(fn($i) =>
                            $i->product_id === $item->product_id
                            && $i->product_option_id === $item->product_option_id
                            && (float) $i->unit_price === (float) $item->unit_price
                            && $i->note === $item->note
                            && (float) ($i->discount_amount ?? 0) === 0
                            && json_encode((array) ($i->options ?? [])) === json_encode((array) ($item->options ?? []))
                        ) : null;
                        if ($existing) {
                            $existing->quantity += $item->quantity;
                            $existing->subtotal = $existing->unit_price * $existing->quantity;
                            $existing->total_price = $existing->unit_price * $existing->quantity;
                            $existing->save();
                            $affectedItemIds[] = $existing->id;
                        } else {
                            $newItem = $item->replicate();
                            $newItem->order_id = $target->id;
                            $newItem->save();
                            $target->items->push($newItem);
                            $affectedItemIds[] = $newItem->id;
                        }
                    }

                    $mergedCodes[] = $src->code;

                    // Gói 13: hoàn điểm đã đổi của đơn nguồn trước khi đánh cancelled
                    // (đơn nguồn bị cancelled nhưng tiền món đã gộp sang đơn đích).
                    $loyaltyService->refundRedeem($src);

                    // Gói 55 p11ac: thu hồi điểm đã TÍCH của đơn nguồn (chống tích 2 lần khi gộp)
                    // Gói 55 p11ae: chỉ trừ total_spent khi đơn nguồn đã từng paid (earn đã chạy);
                    // payment_status của $src vẫn còn nguyên tại thời điểm này.
                    $loyaltyService->revokeEarn($src, $src->payment_status === 'paid');

                    // P0-3: xử lý voucher/CK đơn nguồn khi gộp — khách không mất tiền.
                    // (a) Có voucher → hoàn lượt dùng (giống performCancel) để khách dùng lại được,
                    //     đồng thời xóa log VoucherUsage của đơn nguồn.
                    //     Không cộng CK voucher vào đơn đích (tránh vừa giữ CK vừa dùng lại voucher).
                    // (b) Không voucher → CK là tay/KM, cộng dồn sang đơn đích.
                    if (!empty($src->voucher_code)) {
                        Voucher::where('code', $src->voucher_code)
                            ->where('used_count', '>', 0)
                            ->decrement('used_count');
                        VoucherUsage::where('order_id', $src->id)->delete();
                    } else {
                        $transferredDiscount += (float) ($src->discount_amount ?? 0);
                    }

                    $src->status = 'cancelled';
                    $src->payment_status = 'refunded';
                    $src->cancel_reason = 'Gộp vào đơn ' . $target->code;
                    $src->cancelled_at = now();
                    $src->save();

                    // Gói 55 p11ac: trừ kho cho món từ đơn nguồn (held) gộp vào đơn đích (paid)
                    if ($needDeductSrc) {
                        $deductLines = $src->items->map(fn($item) => [
                            'product_id' => $item->product_id,
                            'product_option_id' => $item->product_option_id,
                            'option_ids' => $item->options ? array_keys((array) $item->options) : [],
                            'quantity' => $item->quantity,
                        ])->toArray();
                        $matCosts = $inventoryService->deductStock($target->branch_id, $deductLines, ['type' => 'order', 'id' => $target->id, 'note' => 'Gộp đơn ' . $src->code]);
                        // Gói 55 p11ae: chỉ cập nhật giá vốn cho các dòng VỪA gộp,
                        // không ghi đè unit_cost đã chốt của các dòng cũ trong đơn đích
                        foreach ($target->items()->whereIn('id', array_unique($affectedItemIds))->get() as $tItem) {
                            $tItem->update([
                                'unit_cost' => $this->calcItemUnitCost(
                                    $tItem->product_id,
                                    $tItem->options ? array_keys((array) $tItem->options) : [],
                                    $matCosts,
                                    $tItem->product_option_id
                                ),
                            ]);
                        }
                    }

                    // Gói 3b: giải phóng bàn của đơn nguồn nếu không còn đơn lưu nào khác
                    $this->releaseTableIfFree($src);
                }

                // Tính lại tổng đơn đích (trừ chiết khấu từng món)
                $target->refresh();
                $subtotal = $target->items->sum(fn($i) => $i->unit_price * $i->quantity - ($i->discount_amount ?? 0));
                $target->subtotal_amount = $subtotal;
                // P0-3: cộng CK (tay/KM) từ các đơn nguồn đã gộp — khách không mất tiền CK.
                // (CK voucher đã được hoàn lượt dùng ở trên nên không cộng vào đây.)
                $target->discount_amount = min(($target->discount_amount ?? 0) + $transferredDiscount, $subtotal);
                $target->total_amount = $subtotal - $target->discount_amount;
                $target->save();

                return [
                    'target' => $target->load('items'),
                    'merged_codes' => $mergedCodes,
                ];
            });

            return response()->json(['success' => true, 'message' => 'Gộp đơn thành công', 'data' => $result]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Gói 3b (2026-10-04): Danh sách đơn đang lưu (held) cho màn hình POS.
     */
    public function heldOrders(Request $request): JsonResponse
    {
        $request->validate(['branch_id' => 'required|exists:branches,id']);
        if ($deny = $this->denyOrderBranch($request, $request->branch_id)) return $deny;

        $orders = Order::with(['items.product', 'items.option', 'table'])
            ->where('branch_id', $request->branch_id)
            ->where('status', 'held')
            ->orderBy('created_at', 'asc')
            ->get();

        return response()->json(['success' => true, 'data' => $orders]);
    }

    /**
     * Gói 3b (2026-10-04): THANH TOÁN đơn đang lưu.
     * Trừ kho (BOM + FIFO) tại thời điểm thanh toán, chuyển đơn sang pending (vào KDS).
     * Ném Exception nếu thiếu hàng.
     */
    public function finalize(Request $request, int $id, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        $validated = $request->validate([
            'payment_method' => 'nullable|string',
        ]);
        if ($deny = $this->denyOrderById($request, $id)) return $deny;

        try {
            $order = DB::transaction(function () use ($id, $validated, $inventoryService) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);

                if ($order->status !== 'held') {
                    throw new Exception('Chỉ thanh toán được đơn đang lưu.');
                }

                // Trừ kho tại thời điểm thanh toán (đơn held chưa từng trừ)
                // Gói 13: trừ cả topping/size (option_ids từ options [id => name])
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
                    ['type' => 'order', 'id' => $order->id, 'note' => 'Thanh toán đơn lưu']
                );
                foreach ($order->items as $item) {
                    $item->update([
                        'unit_cost' => $this->calcItemUnitCost(
                            $item->product_id,
                            $item->options ? array_keys((array) $item->options) : [],
                            $matCosts,
                            $item->product_option_id
                        ),
                    ]);
                }

                $order->payment_method = $validated['payment_method'] ?? $order->payment_method;
                $order->payment_status = 'paid';
                $order->status = 'pending'; // vào luồng KDS như đơn thường
                $order->stock_deducted = true;
                $order->save();

                // Gói 5: tích điểm khi thanh toán đơn lưu (điểm đổi đã trừ lúc tạo đơn)
                if ($order->customer_id) {
                    $customer = Customer::find($order->customer_id);
                    if ($customer) {
                        $order->points_earned = $loyaltyService->earnForOrder($customer, $order, (float) $order->total_amount);
                        $order->save();
                    }
                }

                // Gói 3c: KHÔNG giải phóng bàn ở đây — đơn dine_in sau thanh toán vẫn giữ bàn
                // cho đến khi hoàn thành (completed) hoặc bị hủy.

                return $order->load(['items.product', 'table']);
            });

            return response()->json([
                'success' => true,
                'message' => 'Thanh toán đơn lưu thành công',
                'data' => $order,
            ]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    /**
     * Gói 3b: Trả bàn về trạng thái trống nếu không còn đơn nào đang hoạt động trên bàn đó
     * (held / pending / processing / ready). Dùng khi hủy, gộp, thanh toán đơn lưu,
     * và khi đơn hoàn thành.
     */
    private function releaseTableIfFree(Order $order): void
    {
        if (!$order->table_id) {
            return;
        }
        $stillActive = Order::where('table_id', $order->table_id)
            ->whereIn('status', ['held', 'pending', 'processing', 'ready'])
            ->where('id', '!=', $order->id)
            ->exists();
        if (!$stillActive) {
            \App\Models\Table::where('id', $order->table_id)->update(['status' => 'empty']);
        }
    }

    /**
     * Đơn hàng đang hoạt động cho màn hình KDS (polling mỗi 3s từ frontend).
     */
    public function kdsOrders(Request $request): JsonResponse
    {
        $request->validate([
            'branch_id' => 'required|exists:branches,id',
        ]);
        if ($deny = $this->denyOrderBranch($request, $request->branch_id)) return $deny;

        $orders = Order::with(['items.product', 'items.option'])
            ->where('branch_id', $request->branch_id)
            // Audit 2026-10-21 🔴3: thêm 'confirmed' để đơn COD cũ đang kẹt hiện lên KDS
            // (đơn COD mới sau sửa notify vào thẳng 'pending' như đơn thường).
            ->whereIn('status', ['pending', 'processing', 'ready', 'confirmed'])
            ->orderBy('created_at', 'asc')
            ->get();

        // Gói 11: cờ "chờ xác nhận" cho KDS — đơn Zalo chưa thu tiền (chưa trừ kho).
        // Đơn POS đã thu tiền tại quầy nên không cần xác nhận, vào thẳng "Đang Pha Chế".
        // Spec QR 2026-10-21: nới cho đơn BANK qua Checkout SDK (pending_payment/
        // transfer_notified) + gắn cờ khách đã báo CK và chờ quá hạn để NV đối chiếu.
        $alertMinutes = max(1, (int) \App\Models\Setting::get('zalo_pay_wait_alert_minutes', '15'));
        $orders->each(function ($o) use ($alertMinutes) {
            $awaiting = $o->online_channel === 'zalo'
                && in_array($o->payment_status, ['pending', 'pending_payment', 'transfer_notified'], true)
                && !$o->stock_deducted;
            $o->setAttribute('needs_confirm', $awaiting);
            $o->setAttribute('pay_overdue', $awaiting && $o->created_at->diffInMinutes(now()) >= $alertMinutes);
        });

        return response()->json([
            'success' => true,
            'data' => $orders,
        ]);
    }

    /**
     * Gói 11: tạo mã QR tích điểm cho đơn POS — thu ngân bấm để hiện QR,
     * khách quét bằng Mini App để gán TV vào đơn (token 15 phút, dùng 1 lần).
     */
    public function claimQr(Request $request, int $id): JsonResponse
    {
        $order = Order::findOrFail($id);
        if ($deny = $this->denyOrderBranch($request, $order->branch_id)) return $deny;
        if (in_array($order->status, ['completed', 'cancelled'])) {
            return response()->json(['success' => false, 'message' => 'Đơn đã hoàn thành/hủy, không tạo QR được.'], 400);
        }
        $order->claim_token = Str::random(24);
        $order->claim_expires_at = now()->addMinutes(15);
        $order->save();

        return response()->json(['success' => true, 'data' => [
            'code' => $order->code,
            'token' => $order->claim_token,
            'expires_at' => $order->claim_expires_at,
        ]]);
    }

    /**
     * Tra cứu chi tiết một đơn hàng theo mã hóa đơn
     */
    public function showByCode(Request $request, string $code): JsonResponse
    {
        $order = Order::where('code', $code)
            ->with(['branch', 'customer:id,name,member_code,tier_id', 'customer.tier:id,name', 'items.product', 'items.option'])
            ->firstOrFail();
        if ($deny = $this->denyOrderBranch($request, $order->branch_id)) return $deny;

        return response()->json([
            'success' => true,
            'data' => $order,
        ], 200);
    }

    /**
     * Gói 55 p11ac: tính giá vốn 1 đơn vị món = Σ (định mức NL × giá vốn BQ lô đã trừ).
     * Dùng cho báo cáo COGS — giá vốn được "chốt" tại thời điểm bán, không thay đổi ngược.
     * Gói 55 p11ae: viết lại để KHỚP 100% logic trừ kho của InventoryService::calculateNeeds:
     * - Định mức cơ bản: whereNull('product_option_id') (trước đây lấy cả dòng per-option → đếm trùng)
     * - Tùy chọn: phân biệt fixed (product_id NULL) / per_product (đúng món) theo quantity_mode
     * - Gộp product_option_id (size cũ) vào danh sách option (trước đây bỏ sót → thiếu giá vốn)
     */
    /**
     * Sinh mã đơn duy nhất — dùng chung Order::nextCode() (quy tắc mã trong Thiết lập).
     */
    private function generateUniqueOrderCode(): string
    {
        return Order::nextCode();
    }

    private function calcItemUnitCost(int $productId, array $optionIds, array $materialCosts, $productOptionId = null): float
    {        if (empty($materialCosts)) {
            return 0;
        }
        // Gộp product_option_id vào danh sách option — giống calculateNeeds
        $optionIds = array_values(array_unique(array_filter(array_merge(
            $optionIds,
            $productOptionId ? [$productOptionId] : []
        ))));
        $cost = 0;
        // Định mức CƠ BẢN của món (không tính dòng định mức theo tùy chọn)
        $recipes = \App\Models\Recipe::where('product_id', $productId)
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
                $optionRecipes = \App\Models\Recipe::where('product_id', $productId)
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
