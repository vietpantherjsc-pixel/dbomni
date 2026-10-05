<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\Promotion;
use App\Models\Voucher;
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
    /**
     * Gói 2 (2026-10-04): Danh sách hóa đơn cho trang quản trị (kiểu Sapo).
     * Filters: tab=all|paid|pending_payment|cancelled, search (mã), branch_id.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Order::with(['user:id,name', 'branch:id,name', 'items.product:id,name', 'items.option:id,name'])
            ->orderBy('created_at', 'desc');

        $tab = $request->query('tab', 'all');
        match ($tab) {
            'paid' => $query->where('payment_status', 'paid')->where('status', '!=', 'cancelled'),
            'pending_payment' => $query->where('payment_status', 'pending'),
            'cancelled' => $query->where('status', 'cancelled'),
            default => null,
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

        $orders = $query->paginate($request->query('per_page', 20));

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
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'order_type' => 'nullable|in:takeaway,delivery,dine_in',
            'table_id' => 'nullable|exists:tables,id',
            'customer_id' => 'nullable|exists:customers,id', // Gói 5: khách hàng thành viên
            'customer_name' => 'nullable|string|max:100',
            'customer_phone' => 'nullable|string|max:20',
            'payment_method' => 'nullable|string',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id', // Gói 5: khuyến mại Sapo
            'points_redeem' => 'nullable|integer|min:0', // Gói 5: số điểm muốn đổi
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
            $userId = $request->user()->id;
            // Gói 3b: đơn lưu tạm (held) thì CHƯA trừ kho, chỉ trừ khi bấm Thanh toán (finalize).
            $isHold = !empty($validated['save_as_hold']);
            $order = DB::transaction(function () use ($validated, $inventoryService, $promotionService, $loyaltyService, $userId, $isHold) {
                $subtotal = 0;
                $orderItemsData = [];
                $promoItems = []; // Gói 5: dữ liệu cho PromotionService

                // 1. Tính giá món
                foreach ($validated['items'] as $item) {
                    $product = Product::findOrFail($item['product_id']);
                    $option = !empty($item['product_option_id'])
                        ? ProductOption::findOrFail($item['product_option_id'])
                        : null;

                    // Gói 3e: cho phép giá bán tùy chỉnh từ popup (mặc định = giá menu + tùy chọn)
                    $unitPrice = isset($item['unit_price'])
                        ? (float) $item['unit_price']
                        : ($product->base_price + ($option ? $option->additional_price : 0));
                    $lineGross = $unitPrice * $item['quantity'];
                    // Gói 3e: giảm giá từng món (không vượt quá thành tiền dòng)
                    $itemDiscount = min((float) ($item['discount_amount'] ?? 0), $lineGross);
                    $itemTotal = $lineGross - $itemDiscount;
                    $subtotal += $itemTotal;

                    $orderItemsData[] = [
                        'product_id' => $product->id,
                        'product_option_id' => $option ? $option->id : null,
                        // Gói 8a: lưu danh sách tùy chọn nhóm đã chọn (để truy vết trừ kho)
                        'options' => !empty($item['option_ids'])
                            ? array_values(ProductOption::whereIn('id', $item['option_ids'])->pluck('name', 'id')->toArray())
                            : null,
                        'product_name' => $product->name,
                        'price' => $product->base_price,
                        'unit_price' => $unitPrice,
                        'quantity' => $item['quantity'],
                        'subtotal' => $itemTotal,
                        'total_price' => $itemTotal,
                        'discount_amount' => $itemDiscount,
                        'note' => $item['note'] ?? null,
                    ];
                    $promoItems[] = [
                        'product_id' => $product->id,
                        'category_id' => $product->category_id,
                        'quantity' => $item['quantity'],
                        'line_total' => $itemTotal,
                        'unit_price' => $unitPrice,
                    ];
                }

                // 2. Tính toán chiết khấu Voucher (nếu có)
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

                    if ($subtotal < $voucher->min_order_amount) {
                        throw new Exception("Đơn hàng tối thiểu phải đạt " . number_format($voucher->min_order_amount) . "đ để áp dụng voucher này.");
                    }

                    if ($voucher->type === 'fixed') {
                        $discountAmount = $voucher->value;
                    } elseif ($voucher->type === 'percent') {
                        $discountAmount = ($subtotal * $voucher->value) / 100;
                        if ($voucher->max_discount_amount && $discountAmount > $voucher->max_discount_amount) {
                            $discountAmount = $voucher->max_discount_amount;
                        }
                    }

                    $discountAmount = min($discountAmount, $subtotal);
                    $voucher->increment('used_count');
                    $appliedVoucher = $voucher;
                }

                // 2b. Chiết khấu thủ công từ POS (Gói 3): ưu tiên discount_percent, sau đó discount_amount.
                // Áp dụng SAU voucher (nếu có cả hai, cộng dồn).
                if (!empty($validated['discount_percent'])) {
                    $discountAmount += ($subtotal * $validated['discount_percent']) / 100;
                }
                if (!empty($validated['discount_amount'])) {
                    $discountAmount += $validated['discount_amount'];
                }
                $discountAmount = min($discountAmount, $subtotal);

                // 2c. Gói 5: Khuyến mại Sapo (validate lại phía server chống giả mạo)
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
                    $promotionDiscount = min((float) $found['discount'], $subtotal - $discountAmount);
                    $discountAmount += $promotionDiscount;
                    // Tặng món: thêm dòng 0đ vào đơn
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
                        $orderItemsData[] = $giftLine;
                    }
                }

                // 2d. Gói 5: Đổi điểm lấy tiền (cần có customer_id)
                $customer = null;
                $pointsUsed = 0;
                $pointsDiscount = 0;
                if (!empty($validated['customer_id'])) {
                    $customer = Customer::findOrFail($validated['customer_id']);
                }
                if (!empty($validated['points_redeem']) && (int) $validated['points_redeem'] > 0) {
                    if (!$customer) {
                        throw new Exception('Đổi điểm cần chọn khách hàng thành viên.');
                    }
                    $preview = $loyaltyService->previewRedeem(
                        $customer,
                        (int) $validated['points_redeem'],
                        $subtotal - $discountAmount
                    );
                    $pointsUsed = $preview['points_used'];
                    $pointsDiscount = $preview['discount'];
                    if ($pointsUsed <= 0) {
                        throw new Exception('Điểm không đủ để đổi (hoặc chưa đạt bội số quy đổi).');
                    }
                    $discountAmount += $pointsDiscount;
                }

                $discountAmount = min($discountAmount, $subtotal);
                $finalAmount = $subtotal - $discountAmount;

                // 3. Trừ kho trực tiếp khi bán (BOM + FIFO). Ném Exception nếu thiếu hàng.
                // Đơn held: bỏ qua bước này.
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
                    $inventoryService->deductStock($validated['branch_id'], $deductLines);
                }

                // 4. Liên kết ca làm việc đang mở (nếu có)
                $activeShift = \App\Models\Shift::where('branch_id', $validated['branch_id'])
                    ->where('status', 'open')
                    ->latest()
                    ->first();

                // 5. Tạo hóa đơn
                $tableId = $validated['table_id'] ?? null;
                $order = Order::create([
                    'user_id' => $userId,
                    'branch_id' => $validated['branch_id'],
                    'order_type' => $validated['order_type'] ?? 'takeaway',
                    'table_id' => $tableId,
                    'shift_id' => $activeShift ? $activeShift->id : null,
                    'order_number' => 'ORD-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                    'code' => 'HD-' . date('Ymd') . '-' . strtoupper(Str::random(5)),
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

                // 6. Ghi nhận chi tiết từng món trong đơn
                foreach ($orderItemsData as $itemData) {
                    $order->items()->create($itemData);
                }

                // 6b. Gói 5: trừ điểm đã đổi + tích điểm khi thanh toán ngay (đơn held tích lúc finalize)
                if ($customer && $pointsUsed > 0) {
                    $loyaltyService->applyRedeem($customer, $order, $pointsUsed);
                }
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
            return response()->json([
                'success' => false,
                'message' => $e->getMessage()
            ], 400);
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
            'status' => 'required|in:pending,processing,ready,completed,cancelled'
        ]);

        // Tìm đơn theo code hoặc id kèm theo danh sách món (items)
        $order = Order::with('items')->where('code', $id)->orWhere('id', $id)->firstOrFail();
        $order->status = $request->status;
        $order->save();

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
     * Hủy đơn hàng và tự động hoàn trả nguyên vật liệu vào kho.
     */
    public function cancel(Request $request, int $id, InventoryService $inventoryService, LoyaltyService $loyaltyService): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'required|string|max:255',
            'restock' => 'boolean', // true: có hoàn kho, false: hủy không hoàn
        ]);

        $shouldRestock = $validated['restock'] ?? true;

        try {
            $order = DB::transaction(function () use ($id, $validated, $shouldRestock, $inventoryService, $loyaltyService) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);

                if ($order->status === 'cancelled') {
                    throw new Exception('Đơn hàng này đã được hủy trước đó.');
                }

                // Hoàn trả nguyên vật liệu theo BOM nếu restock = true
                // Gói 3b: đơn held chưa từng trừ kho (stock_deducted=false) thì không có gì để hoàn.
                if ($shouldRestock && $order->stock_deducted) {
                    $inventoryService->restock(
                        $order->branch_id ?? 1,
                        $order->items->map(fn($item) => [
                            'product_id' => $item->product_id,
                            'product_option_id' => $item->product_option_id,
                            'quantity' => $item->quantity,
                        ])->toArray()
                    );
                }

                $order->status = 'cancelled';
                $order->payment_status = 'refunded';
                $order->cancel_reason = $validated['reason'];
                $order->cancelled_at = now();
                $order->save();

                // Gói 5: hoàn điểm đã đổi khi hủy đơn
                $loyaltyService->refundRedeem($order);

                // Gói 3b: nếu là đơn lưu gắn bàn -> trả bàn về trống khi không còn đơn lưu nào khác
                $this->releaseTableIfFree($order);

                return $order;
            });

            return response()->json([
                'success' => true,
                'message' => 'Hủy đơn hàng thành công' . ($shouldRestock ? ' và đã hoàn trả nguyên vật liệu vào kho.' : '.'),
                'data' => $order,
            ], 200);

        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 400);
        }
    }

    /**
     * Gói 3 (2026-10-04): TÁCH ĐƠN.
     * Chuyển một phần món của đơn gốc sang đơn mới.
     * Kho KHÔNG thay đổi (tổng số món giữ nguyên) — chỉ chia lại items giữa 2 đơn.
     * Chỉ cho đơn chưa hoàn thành / chưa hủy.
     */
    public function split(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.order_item_id' => 'required|exists:order_items,id',
            'items.*.quantity' => 'required|integer|min:1',
            'customer_name' => 'nullable|string|max:100',
            'note' => 'nullable|string',
        ]);

        try {
            $result = DB::transaction(function () use ($id, $validated) {
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
                $newOrder = Order::create([
                    'user_id' => $source->user_id,
                    'branch_id' => $source->branch_id,
                    'order_type' => $source->order_type,
                    'table_id' => $source->table_id,
                    'shift_id' => $source->shift_id,
                    'order_number' => 'ORD-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                    'code' => 'HD-' . date('Ymd') . '-' . strtoupper(Str::random(5)),
                    'customer_name' => $validated['customer_name'] ?? $source->customer_name,
                    'customer_phone' => $source->customer_phone,
                    'status' => $source->status,
                    'payment_method' => $source->payment_method,
                    'payment_status' => 'pending',
                    'stock_deducted' => $source->stock_deducted, // Gói 3b: kế thừa trạng thái trừ kho
                    'note' => $validated['note'] ?? ('Tách từ ' . $source->code),
                ]);

                $newSubtotal = 0;
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

                $newOrder->subtotal_amount = $newSubtotal;
                $newOrder->discount_amount = 0;
                $newOrder->total_amount = $newSubtotal;
                $newOrder->save();

                // Tính lại tổng đơn gốc (trừ chiết khấu từng món)
                $source->refresh();
                $sourceSubtotal = $source->items->sum(fn($i) => $i->unit_price * $i->quantity - ($i->discount_amount ?? 0));
                $source->subtotal_amount = $sourceSubtotal;
                $source->discount_amount = min($source->discount_amount, $sourceSubtotal);
                $source->total_amount = $sourceSubtotal - $source->discount_amount;
                $source->save();

                return ['source' => $source->load('items'), 'new_order' => $newOrder->load('items')];
            });

            return response()->json(['success' => true, 'message' => 'Tách đơn thành công', 'data' => $result]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
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
    public function merge(Request $request, InventoryService $inventoryService): JsonResponse
    {
        $validated = $request->validate([
            'target_order_id' => 'required|exists:orders,id',
            'order_ids' => 'required|array|min:1',
            'order_ids.*' => 'exists:orders,id',
        ]);

        try {
            $result = DB::transaction(function () use ($validated, $inventoryService) {
                $target = Order::with('items')->lockForUpdate()->findOrFail($validated['target_order_id']);

                if (in_array($target->status, ['cancelled', 'completed'])) {
                    throw new Exception('Đơn đích đã hoàn thành hoặc đã hủy.');
                }

                $mergedCodes = [];
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
                    if ($src->stock_deducted && !$target->stock_deducted) {
                        $inventoryService->restock(
                            $src->branch_id,
                            $src->items->map(fn($item) => [
                                'product_id' => $item->product_id,
                                'product_option_id' => $item->product_option_id,
                                'quantity' => $item->quantity,
                            ])->toArray()
                        );
                    }

                    // Chuyển từng món sang đơn đích.
                    // Gói 3e: chỉ gộp dòng khi cùng món + tùy chọn + đơn giá + ghi chú
                    // và KHÔNG có chiết khấu từng món (dòng có chiết khấu giữ riêng để không sai tiền).
                    foreach ($src->items as $item) {
                        $existing = ((float) ($item->discount_amount ?? 0) === 0) ? $target->items->first(fn($i) =>
                            $i->product_id === $item->product_id
                            && $i->product_option_id === $item->product_option_id
                            && (float) $i->unit_price === (float) $item->unit_price
                            && $i->note === $item->note
                            && (float) ($i->discount_amount ?? 0) === 0
                        ) : null;
                        if ($existing) {
                            $existing->quantity += $item->quantity;
                            $existing->subtotal = $existing->unit_price * $existing->quantity;
                            $existing->total_price = $existing->unit_price * $existing->quantity;
                            $existing->save();
                        } else {
                            $newItem = $item->replicate();
                            $newItem->order_id = $target->id;
                            $newItem->save();
                            $target->items->push($newItem);
                        }
                    }

                    $mergedCodes[] = $src->code;
                    $src->status = 'cancelled';
                    $src->payment_status = 'refunded';
                    $src->cancel_reason = 'Gộp vào đơn ' . $target->code;
                    $src->cancelled_at = now();
                    $src->save();

                    // Gói 3b: giải phóng bàn của đơn nguồn nếu không còn đơn lưu nào khác
                    $this->releaseTableIfFree($src);
                }

                // Tính lại tổng đơn đích (trừ chiết khấu từng món)
                $target->refresh();
                $subtotal = $target->items->sum(fn($i) => $i->unit_price * $i->quantity - ($i->discount_amount ?? 0));
                $target->subtotal_amount = $subtotal;
                $target->discount_amount = min($target->discount_amount ?? 0, $subtotal);
                $target->total_amount = $subtotal - $target->discount_amount;
                $target->save();

                return [
                    'target' => $target->load('items'),
                    'merged_codes' => $mergedCodes,
                ];
            });

            return response()->json(['success' => true, 'message' => 'Gộp đơn thành công', 'data' => $result]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }

    /**
     * Gói 3b (2026-10-04): Danh sách đơn đang lưu (held) cho màn hình POS.
     */
    public function heldOrders(Request $request): JsonResponse
    {
        $request->validate(['branch_id' => 'required|exists:branches,id']);

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

        try {
            $order = DB::transaction(function () use ($id, $validated, $inventoryService) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);

                if ($order->status !== 'held') {
                    throw new Exception('Chỉ thanh toán được đơn đang lưu.');
                }

                // Trừ kho tại thời điểm thanh toán (đơn held chưa từng trừ)
                $inventoryService->deductStock(
                    $order->branch_id,
                    $order->items->map(fn($item) => [
                        'product_id' => $item->product_id,
                        'product_option_id' => $item->product_option_id,
                        'quantity' => $item->quantity,
                    ])->toArray()
                );

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
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
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

        $orders = Order::with(['items.product', 'items.option'])
            ->where('branch_id', $request->branch_id)
            ->whereIn('status', ['pending', 'processing', 'ready'])
            ->orderBy('created_at', 'asc')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $orders,
        ]);
    }

    /**
     * Tra cứu danh sách đơn hàng theo số điện thoại khách hàng (Zalo Mini App)
     */
    public function history(Request $request): JsonResponse
    {
        $request->validate([
            'phone' => 'required|string',
        ]);

        $orders = Order::where('customer_phone', $request->phone)
            ->with(['branch', 'items.product', 'items.option'])
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'message' => 'Lấy lịch sử đơn hàng thành công',
            'data' => $orders,
        ], 200);
    }

    /**
     * Tra cứu chi tiết một đơn hàng theo mã hóa đơn
     */
    public function showByCode(string $code): JsonResponse
    {
        $order = Order::where('code', $code)
            ->with(['branch', 'items.product', 'items.option'])
            ->firstOrFail();

        return response()->json([
            'success' => true,
            'data' => $order,
        ], 200);
    }
}
