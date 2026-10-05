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
     * Gói 8c: 2 loại nhóm tùy chọn —
     *  - fixed (VD: Topping): định mức chung, set 1 lần ở trang Nhóm (product_id NULL)
     *  - per_product (VD: Size): định mức theo món, set trong form món (product_id = món)
     *
     * @param array $lines [['product_id' => int, 'product_option_id' => int|null, 'option_ids' => int[], 'quantity' => int]]
     * @return array [material_id => quantity]
     */
    public function calculateNeeds(array $lines): array
    {
        $needs = [];

        // Cache mode của các option để không query lặp
        $modeCache = [];

        foreach ($lines as $line) {
            $productId = $line['product_id'];
            $qty = $line['quantity'];

            // Gói 8a: gom tất cả option ids (mới: option_ids[], cũ: product_option_id)
            $optionIds = $line['option_ids'] ?? [];
            if (!empty($line['product_option_id'])) {
                $optionIds[] = $line['product_option_id'];
            }
            $optionIds = array_values(array_unique(array_filter($optionIds)));

            // Định mức CƠ BẢN của món (size nhỏ nhất) — gồm nguyên liệu + bao bì
            $recipes = Recipe::where('product_id', $productId)
                ->whereNull('product_option_id')
                ->get();
            foreach ($recipes as $recipe) {
                $needs[$recipe->material_id] = ($needs[$recipe->material_id] ?? 0) + $recipe->quantity * $qty;
            }

            // Định mức của từng tùy chọn đã chọn
            foreach ($optionIds as $oid) {
                if (!array_key_exists($oid, $modeCache)) {
                    $opt = \App\Models\ProductOption::with('group')->find($oid);
                    $modeCache[$oid] = ($opt && $opt->group && $opt->group->quantity_mode === 'per_product')
                        ? 'per_product' : 'fixed';
                }

                if ($modeCache[$oid] === 'per_product') {
                    // Theo món: chỉ lấy dòng của đúng món này
                    $optionRecipes = Recipe::where('product_id', $productId)
                        ->where('product_option_id', $oid)
                        ->get();
                } else {
                    // Cố định: dòng chung (product_id NULL), áp dụng mọi món
                    $optionRecipes = Recipe::whereNull('product_id')
                        ->where('product_option_id', $oid)
                        ->get();
                }

                foreach ($optionRecipes as $recipe) {
                    $needs[$recipe->material_id] = ($needs[$recipe->material_id] ?? 0) + $recipe->quantity * $qty;
                }
            }
        }

        return $needs;
    }

    /**
     * Gói 4 (2026-10-04): Trừ kho TRỰC TIẾP theo nguyên liệu (không qua món).
     * Dùng cho phiếu chế biến và điều chỉnh kiểm kê.
     *
     * @param array $needs [material_id => quantity] (đơn vị cơ sở)
     */
    public function deductMaterials(int $branchId, array $needs): void
    {
        DB::transaction(function () use ($branchId, $needs) {
            foreach ($needs as $materialId => $qtyNeeded) {
                $qtyNeeded = (float) $qtyNeeded;
                if ($qtyNeeded <= 0) {
                    continue;
                }
                $batches = Batch::where('branch_id', $branchId)
                    ->where('material_id', $materialId)
                    ->where('status', 'active')
                    ->where('current_quantity', '>', 0)
                    ->orderByRaw('expired_at IS NULL, expired_at ASC')
                    ->orderBy('id', 'ASC')
                    ->lockForUpdate()
                    ->get();

                if ($batches->sum('current_quantity') < $qtyNeeded) {
                    $mat = \App\Models\Material::find($materialId);
                    $name = $mat ? $mat->name : "#{$materialId}";
                    throw new Exception("Nguyên liệu {$name} không đủ tồn kho (cần {$qtyNeeded}, còn {$batches->sum('current_quantity')}).");
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
     * Gói 4 (2026-10-04): Nhập kho trực tiếp 1 lô mới cho nguyên liệu.
     * Dùng cho thành phẩm sau chế biến và điều chỉnh tăng khi kiểm kê.
     */
    public function addStock(int $branchId, int $materialId, float $qty, ?string $batchCode = null, ?string $note = null): \App\Models\Batch
    {
        return DB::transaction(function () use ($branchId, $materialId, $qty, $batchCode, $note) {
            return \App\Models\Batch::create([
                'branch_id' => $branchId,
                'material_id' => $materialId,
                'batch_code' => $batchCode ?? ('SX-' . date('Ymd') . '-' . strtoupper(\Illuminate\Support\Str::random(6))),
                'initial_quantity' => $qty,
                'current_quantity' => $qty,
                'unit_cost' => 0,
                'status' => 'active',
            ]);
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
