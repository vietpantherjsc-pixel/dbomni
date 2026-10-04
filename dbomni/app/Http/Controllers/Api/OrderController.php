<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\Recipe;
use App\Models\Shift;
use App\Models\Voucher;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Services\InventoryService;

class OrderController extends Controller
{
    /**
     * Tiếp nhận đơn hàng từ Zalo Mini App / POS, tính toán Voucher và trừ tồn kho tự động (BOM + FIFO)
     */
    public function store(Request $request): JsonResponse
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
        ]);

        try {
            $order = DB::transaction(function () use ($validated) {
                $subtotal = 0;
                $orderItemsData = [];
                $materialDeductions = [];

                // 1. Tính giá món và tổng hợp định lượng nguyên liệu cần trừ
                foreach ($validated['items'] as $item) {
                    $product = Product::findOrFail($item['product_id']);
                    $option = !empty($item['product_option_id']) 
                        ? ProductOption::findOrFail($item['product_option_id']) 
                        : null;

                    $unitPrice = $product->price + ($option ? $option->additional_price : 0);
                    $itemTotal = $unitPrice * $item['quantity'];
                    $subtotal += $itemTotal;

                    $orderItemsData[] = [
                        'product_id' => $product->id,
                        'product_option_id' => $option ? $option->id : null,
                        'quantity' => $item['quantity'],
                        'unit_price' => $unitPrice,
                        'total_price' => $itemTotal,
                    ];

                    // Bóc tách công thức món chính
                    $recipes = Recipe::where('product_id', $product->id)
                        ->whereNull('product_option_id')
                        ->get();

                    foreach ($recipes as $recipe) {
                        $needed = $recipe->quantity * $item['quantity'];
                        $materialDeductions[$recipe->material_id] = ($materialDeductions[$recipe->material_id] ?? 0) + $needed;
                    }

                    // Bóc tách công thức tùy chọn / size (nếu có)
                    if ($option) {
                        $optionRecipes = Recipe::where('product_id', $product->id)
                            ->where('product_option_id', $option->id)
                            ->get();

                        foreach ($optionRecipes as $recipe) {
                            $needed = $recipe->quantity * $item['quantity'];
                            $materialDeductions[$recipe->material_id] = ($materialDeductions[$recipe->material_id] ?? 0) + $needed;
                        }
                    }
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

                // 3. Khấu trừ tồn kho theo lô (FIFO: Hạn dùng gần nhất trừ trước)
                foreach ($materialDeductions as $materialId => $quantityNeeded) {
                    $batches = Batch::where('branch_id', $validated['branch_id'])
                        ->where('material_id', $materialId)
                        ->where('status', 'active')
                        ->where('current_quantity', '>', 0)
                        ->orderByRaw('expired_at IS NULL, expired_at ASC')
                        ->orderBy('id', 'ASC')
                        ->lockForUpdate()
                        ->get();

                    $totalAvailable = $batches->sum('current_quantity');
                    if ($totalAvailable < $quantityNeeded) {
                        throw new Exception("Nguyên vật liệu mã #{$materialId} không đủ tồn kho để đáp ứng đơn hàng.");
                    }

                    $remainingToDeduct = $quantityNeeded;
                    foreach ($batches as $batch) {
                        if ($remainingToDeduct <= 0) break;

                        if ($batch->current_quantity >= $remainingToDeduct) {
                            $batch->current_quantity -= $remainingToDeduct;
                            if ($batch->current_quantity == 0) {
                                $batch->status = 'exhausted';
                            }
                            $batch->save();
                            $remainingToDeduct = 0;
                        } else {
                            $remainingToDeduct -= $batch->current_quantity;
                            $batch->current_quantity = 0;
                            $batch->status = 'exhausted';
                            $batch->save();
                        }
                    }
                }

                // 4. Liên kết ca làm việc đang mở (nếu có)
                $branchId = $validated['branch_id'] ?? 1;
                $activeShift = \App\Models\Shift::where('branch_id', $branchId)
                    ->where('status', 'open')
                    ->latest()
                    ->first();

                // 5. Tạo hóa đơn
                $order = Order::create([
                    'branch_id' => $validated['branch_id'],
                    'shift_id' => $activeShift ? $activeShift->id : null,
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
     * Cập nhật tiến độ pha chế / trạng thái đơn hàng (KDS Workflow)
     */
    public function updateStatus(Request $request, string $id, InventoryService $inventoryService)
    {
        $request->validate([
            'status' => 'required|in:pending,processing,ready,completed,cancelled'
        ]);

        // Tìm đơn theo code hoặc id kèm theo danh sách món (items)
        $order = Order::with('items')->where('code', $id)->orWhere('id', $id)->firstOrFail();
        $previousStatus = $order->status;
        $order->status = $request->status;
        $order->save();

        // Tự động trừ kho nguyên liệu định lượng khi đơn chuyển sang completed
        if ($request->status === 'completed' && $previousStatus !== 'completed') {
            $inventoryService->deductStockForOrder($order);
        }

        return response()->json([
            'success' => true,
            'message' => 'Cập nhật trạng thái thành công',
            'data' => $order
        ]);
    }

    /**
     * Hủy đơn hàng và tự động hoàn trả nguyên vật liệu vào kho
     */
    public function cancel(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'required|string|max:255',
            'restock' => 'boolean', // true: có hoàn kho, false: hủy không hoàn
        ]);

        $shouldRestock = $validated['restock'] ?? true;

        try {
            $order = DB::transaction(function () use ($id, $validated, $shouldRestock) {
                $order = Order::with('items')->lockForUpdate()->findOrFail($id);

                if ($order->status === 'cancelled') {
                    throw new Exception('Đơn hàng này đã được hủy trước đó.');
                }

                // Hoàn trả nguyên vật liệu theo BOM nếu restock = true
                if ($shouldRestock) {
                    $materialDeductions = [];

                    foreach ($order->items as $item) {
                        $recipes = Recipe::where('product_id', $item->product_id)
                            ->whereNull('product_option_id')
                            ->get();

                        foreach ($recipes as $recipe) {
                            $needed = $recipe->quantity * $item->quantity;
                            $materialDeductions[$recipe->material_id] = ($materialDeductions[$recipe->material_id] ?? 0) + $needed;
                        }

                        if ($item->product_option_id) {
                            $optionRecipes = Recipe::where('product_id', $item->product_id)
                                ->where('product_option_id', $item->product_option_id)
                                ->get();

                            foreach ($optionRecipes as $recipe) {
                                $needed = $recipe->quantity * $item->quantity;
                                $materialDeductions[$recipe->material_id] = ($materialDeductions[$recipe->material_id] ?? 0) + $needed;
                            }
                        }
                    }

                    foreach ($materialDeductions as $materialId => $quantity) {
                        $batch = Batch::where('branch_id', $order->branch_id)
                            ->where('material_id', $materialId)
                            ->orderBy('id', 'desc')
                            ->first();

                        if ($batch) {
                            $batch->current_quantity += $quantity;
                            if ($batch->status === 'exhausted' && $batch->current_quantity > 0) {
                                $batch->status = 'active';
                            }
                            $batch->save();
                        }
                    }
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