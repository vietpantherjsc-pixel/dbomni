<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\Voucher;
use App\Services\InventoryService;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    /**
     * Tiếp nhận đơn hàng từ Zalo Mini App / POS, tính toán Voucher và trừ tồn kho tự động (BOM + FIFO).
     *
     * Gói 1 (2026-10-04):
     * - Sửa $product->price -> $product->base_price (khớp schema).
     * - Lưu đủ product_name/price/note vào order_items (bảng yêu cầu NOT NULL).
     * - Trừ kho qua InventoryService (1 nơi duy nhất, trừ TRỰC TIẾP khi bán).
     */
    public function store(Request $request, InventoryService $inventoryService): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'customer_name' => 'nullable|string|max:100',
            'customer_phone' => 'nullable|string|max:20',
            'payment_method' => 'nullable|string',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'note' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.product_option_id' => 'nullable|exists:product_options,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.note' => 'nullable|string|max:255',
        ]);

        try {
            $order = DB::transaction(function () use ($validated, $inventoryService) {
                $subtotal = 0;
                $orderItemsData = [];

                // 1. Tính giá món
                foreach ($validated['items'] as $item) {
                    $product = Product::findOrFail($item['product_id']);
                    $option = !empty($item['product_option_id'])
                        ? ProductOption::findOrFail($item['product_option_id'])
                        : null;

                    $unitPrice = $product->base_price + ($option ? $option->additional_price : 0);
                    $itemTotal = $unitPrice * $item['quantity'];
                    $subtotal += $itemTotal;

                    $orderItemsData[] = [
                        'product_id' => $product->id,
                        'product_option_id' => $option ? $option->id : null,
                        'product_name' => $product->name,
                        'price' => $product->base_price,
                        'unit_price' => $unitPrice,
                        'quantity' => $item['quantity'],
                        'subtotal' => $itemTotal,
                        'total_price' => $itemTotal,
                        'note' => $item['note'] ?? null,
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

                $finalAmount = $subtotal - $discountAmount;

                // 3. Trừ kho trực tiếp khi bán (BOM + FIFO). Ném Exception nếu thiếu hàng.
                $inventoryService->deductStock(
                    $validated['branch_id'],
                    array_map(fn($i) => [
                        'product_id' => $i['product_id'],
                        'product_option_id' => $i['product_option_id'] ?? null,
                        'quantity' => $i['quantity'],
                    ], $validated['items'])
                );

                // 4. Liên kết ca làm việc đang mở (nếu có)
                $activeShift = \App\Models\Shift::where('branch_id', $validated['branch_id'])
                    ->where('status', 'open')
                    ->latest()
                    ->first();

                // 5. Tạo hóa đơn
                $order = Order::create([
                    'user_id' => $request->user()->id,
                    'branch_id' => $validated['branch_id'],
                    'shift_id' => $activeShift ? $activeShift->id : null,
                    'order_number' => 'ORD-' . date('Ymd') . '-' . strtoupper(Str::random(6)),
                    'code' => 'HD-' . date('Ymd') . '-' . strtoupper(Str::random(5)),
                    'customer_name' => $validated['customer_name'] ?? 'Khách lẻ',
                    'customer_phone' => $validated['customer_phone'] ?? null,
                    'subtotal_amount' => $subtotal,
                    'discount_amount' => $discountAmount,
                    'voucher_code' => $appliedVoucher ? $appliedVoucher->code : null,
                    'total_amount' => $finalAmount,
                    'payment_method' => $validated['payment_method'] ?? 'cash',
                    'payment_status' => 'paid',
                    'status' => 'pending',
                    'note' => $validated['note'] ?? null,
                ]);

                // 6. Ghi nhận chi tiết từng món trong đơn
                foreach ($orderItemsData as $itemData) {
                    $order->items()->create($itemData);
                }

                return $order->load('items.product');
            });

            return response()->json([
                'success' => true,
                'message' => 'Đặt hàng thành công',
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

        return response()->json([
            'success' => true,
            'message' => 'Cập nhật trạng thái thành công',
            'data' => $order
        ]);
    }

    /**
     * Hủy đơn hàng và tự động hoàn trả nguyên vật liệu vào kho.
     */
    public function cancel(Request $request, int $id, InventoryService $inventoryService): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'required|string|max:255',
            'restock' => 'boolean', // true: có hoàn kho, false: hủy không hoàn
        ]);

        $shouldRestock = $validated['restock'] ?? true;

        try {
            $order = DB::transaction(function () use ($id, $validated, $shouldRestock, $inventoryService) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);

                if ($order->status === 'cancelled') {
                    throw new Exception('Đơn hàng này đã được hủy trước đó.');
                }

                // Hoàn trả nguyên vật liệu theo BOM nếu restock = true
                if ($shouldRestock) {
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
