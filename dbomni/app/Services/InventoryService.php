<?php

namespace App\Services;

use App\Models\Batch;
use App\Models\Recipe;
use Exception;
use Illuminate\Support\Facades\DB;

// Gói 1 (2026-10-04): Viết lại hoàn toàn theo hệ materials + batches.
// - Trừ kho TRỰC TIẾP khi bán hàng (đúng spec v2 PH4), theo FIFO (lô hết hạn trước trừ trước).
// - Tính cả định mức của tùy chọn (size/topping), không chỉ món chính.
// - Hoàn kho khi hủy đơn: cộng trả vào lô mới nhất.
class InventoryService
{
    /**
     * Tính tổng định mức nguyên liệu cần cho các dòng món.
     *
     * @param array $lines [['product_id' => int, 'product_option_id' => int|null, 'quantity' => int]]
     * @return array [material_id => quantity]
     */
    public function calculateNeeds(array $lines): array
    {
        $needs = [];

        foreach ($lines as $line) {
            $productId = $line['product_id'];
            $optionId = $line['product_option_id'] ?? null;
            $qty = $line['quantity'];

            // Định mức của món chính
            $recipes = Recipe::where('product_id', $productId)
                ->whereNull('product_option_id')
                ->get();
            foreach ($recipes as $recipe) {
                $needs[$recipe->material_id] = ($needs[$recipe->material_id] ?? 0) + $recipe->quantity * $qty;
            }

            // Định mức của tùy chọn (VD: Size L +1 ly, thêm trân châu +30g)
            if ($optionId) {
                $optionRecipes = Recipe::where('product_id', $productId)
                    ->where('product_option_id', $optionId)
                    ->get();
                foreach ($optionRecipes as $recipe) {
                    $needs[$recipe->material_id] = ($needs[$recipe->material_id] ?? 0) + $recipe->quantity * $qty;
                }
            }
        }

        return $needs;
    }

    /**
     * Trừ kho theo FIFO cho 1 chi nhánh. Ném Exception khi không đủ tồn kho.
     *
     * @param array $lines [['product_id' => int, 'product_option_id' => int|null, 'quantity' => int]]
     */
    public function deductStock(int $branchId, array $lines): void
    {
        $needs = $this->calculateNeeds($lines);

        DB::transaction(function () use ($branchId, $needs) {
            foreach ($needs as $materialId => $qtyNeeded) {
                // Khóa dòng để tránh tranh chấp khi nhiều đơn bấm cùng lúc
                $batches = Batch::where('branch_id', $branchId)
                    ->where('material_id', $materialId)
                    ->where('status', 'active')
                    ->where('current_quantity', '>', 0)
                    ->orderByRaw('expired_at IS NULL, expired_at ASC')
                    ->orderBy('id', 'ASC')
                    ->lockForUpdate()
                    ->get();

                if ($batches->sum('current_quantity') < $qtyNeeded) {
                    throw new Exception("Nguyên vật liệu #{$materialId} không đủ tồn kho để đáp ứng đơn hàng.");
                }

                $remaining = $qtyNeeded;
                foreach ($batches as $batch) {
                    if ($remaining <= 0) {
                        break;
                    }
                    $deduct = min((float) $batch->current_quantity, $remaining);
                    $batch->current_quantity -= $deduct;
                    if ((float) $batch->current_quantity == 0) {
                        $batch->status = 'exhausted';
                    }
                    $batch->save();
                    $remaining -= $deduct;
                }
            }
        });
    }

    /**
     * Hoàn trả nguyên liệu vào lô mới nhất khi hủy đơn.
     *
     * @param array $lines [['product_id' => int, 'product_option_id' => int|null, 'quantity' => int]]
     */
    public function restock(int $branchId, array $lines): void
    {
        $needs = $this->calculateNeeds($lines);

        DB::transaction(function () use ($branchId, $needs) {
            foreach ($needs as $materialId => $qty) {
                $batch = Batch::where('branch_id', $branchId)
                    ->where('material_id', $materialId)
                    ->orderBy('id', 'desc')
                    ->lockForUpdate()
                    ->first();

                if ($batch) {
                    $batch->current_quantity += $qty;
                    if ($batch->status === 'exhausted' && (float) $batch->current_quantity > 0) {
                        $batch->status = 'active';
                    }
                    $batch->save();
                }
            }
        });
    }
}
