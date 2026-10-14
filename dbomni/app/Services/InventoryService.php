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
     * Gói 55 p11af: ghi nhật ký stock_movements (optional, backward-compatible).
     * @param array $ref ['type' => 'production', 'id' => 123, 'note' => '...'] — tham chiếu
     * @param array|null &$movementIds (by-ref) nhận về id các dòng log để caller gắn reference_id sau
     */
    public function deductMaterials(int $branchId, array $needs, array $ref = [], ?array &$movementIds = null): void
    {
        DB::transaction(function () use ($branchId, $needs, $ref, &$movementIds) {
            $movementIds = [];
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
                    if ((float) $batch->current_quantity < 0.001) { // Gói 55 p11w: epsilon thay vì == 0
                        $batch->status = 'exhausted';
                    }
                    $batch->save();
                    // Gói 55 p11af: nhật ký xuất kho từng lô
                    $movementIds[] = \App\Models\StockMovement::create([
                        'branch_id' => $branchId,
                        'material_id' => $materialId,
                        'batch_id' => $batch->id,
                        'quantity' => $deduct,
                        'unit_cost' => (float) $batch->unit_cost,
                        'reference_type' => $ref['type'] ?? null,
                        'reference_id' => $ref['id'] ?? null,
                        'note' => $ref['note'] ?? null,
                    ])->id;
                    $remaining -= $deduct;
                }
            }
        });
    }

    /**
     * Gói 43: Trừ kho FIFO và TRẢ VỀ chi tiết từng lô đã trừ (để tính giá vốn khi chuyển kho).
     * Không tự bọc transaction — caller bọc (dùng cho chuyển kho: trừ nguồn + nhập đích trong 1 transaction).
     *
     * @param array $needs [material_id => quantity] (đơn vị cơ sở)
     * @return array [material_id => [['batch_id' => int, 'quantity' => float, 'unit_cost' => float, 'expired_at' => ?string], ...]]
     * Gói 55 p11af: ghi nhật ký stock_movements phía TRỪ (optional, backward-compatible).
     * @param array $ref ['type' => 'transfer|outbound|production', 'id' => 123, 'note' => '...']
     * @param array|null &$movementIds (by-ref) nhận về id các dòng log
     */
    public function deductMaterialsDetailed(int $branchId, array $needs, array $ref = [], ?array &$movementIds = null): array
    {
        $result = [];
        $movementIds = [];
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
                if ((float) $batch->current_quantity < 0.001) { // Gói 55 p11w: epsilon thay vì == 0
                    $batch->status = 'exhausted';
                }
                $batch->save();
                // Gói 55 p11af: nhật ký xuất kho từng lô (chỉ phía trừ — nhập đích không log để tránh rối)
                $movementIds[] = \App\Models\StockMovement::create([
                    'branch_id' => $branchId,
                    'material_id' => $materialId,
                    'batch_id' => $batch->id,
                    'quantity' => $deduct,
                    'unit_cost' => (float) $batch->unit_cost,
                    'reference_type' => $ref['type'] ?? null,
                    'reference_id' => $ref['id'] ?? null,
                    'note' => $ref['note'] ?? null,
                ])->id;
                $result[$materialId][] = [
                    'batch_id' => $batch->id,
                    'quantity' => $deduct,
                    'unit_cost' => (float) $batch->unit_cost,
                    'expired_at' => $batch->expired_at,
                ];
                $remaining -= $deduct;
            }
        }
        return $result;
    }

    /**
     * Trừ kho theo FIFO cho 1 chi nhánh. Ném Exception khi không đủ tồn kho.
     *
     * @param array $lines [['product_id' => int, 'product_option_id' => int|null, 'quantity' => int]]
     * @return array [material_id => weighted_avg_unit_cost] — giá vốn BQ theo lượng đã trừ (Gói 55 p11ac)
     * Gói 55 p11ad: ghi nhật ký xuất kho chi tiết từng lô vào stock_movements.
     * @param array $ref ['type' => 'order', 'id' => 123] — tham chiếu (id có thể null, caller cập nhật sau)
     * @param array|null &$movementIds (by-ref) nhận về id các dòng log để caller gắn reference_id sau
     */
    public function deductStock(int $branchId, array $lines, array $ref = [], ?array &$movementIds = null): array
    {
        $needs = $this->calculateNeeds($lines);

        return DB::transaction(function () use ($branchId, $needs, $ref, &$movementIds) {
            $costs = []; // material_id => ['total_cost' => x, 'total_qty' => y]
            $movementIds = [];
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
                    if ((float) $batch->current_quantity < 0.001) { // Gói 55 p11w: epsilon thay vì == 0
                        $batch->status = 'exhausted';
                    }
                    $batch->save();
                    // Gói 55 p11ac: cộng dồn giá vốn theo lượng trừ
                    $costs[$materialId]['total_cost'] = ($costs[$materialId]['total_cost'] ?? 0) + $deduct * (float) $batch->unit_cost;
                    $costs[$materialId]['total_qty'] = ($costs[$materialId]['total_qty'] ?? 0) + $deduct;
                    // Gói 55 p11ad: nhật ký xuất kho từng lô
                    $movementIds[] = \App\Models\StockMovement::create([
                        'branch_id' => $branchId,
                        'material_id' => $materialId,
                        'batch_id' => $batch->id,
                        'quantity' => $deduct,
                        'unit_cost' => (float) $batch->unit_cost,
                        'reference_type' => $ref['type'] ?? null,
                        'reference_id' => $ref['id'] ?? null,
                        'note' => $ref['note'] ?? null,
                    ])->id;
                    $remaining -= $deduct;
                }
            }
            // Trả về giá vốn bình quân gia quyền từng nguyên liệu
            $avg = [];
            foreach ($costs as $mid => $c) {
                $avg[$mid] = $c['total_qty'] > 0 ? $c['total_cost'] / $c['total_qty'] : 0;
            }
            return $avg;
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
     * Hoàn trả nguyên liệu vào kho khi hủy/gộp đơn.
     * Gói SEC2: ưu tiên hoàn vào ĐÚNG lô đã trừ (tra cứu stock_movements của đơn),
     * thay vì lô id lớn nhất — giữ đúng cơ sở giá vốn FIFO.
     *
     * @param array $lines [['product_id' => int, 'product_option_id' => int|null, 'quantity' => int]]
     * @param int|null $orderId ID đơn hàng (để tra cứu lô đã trừ)
     */
    public function restock(int $branchId, array $lines, ?int $orderId = null): void
    {
        $needs = $this->calculateNeeds($lines);

        DB::transaction(function () use ($branchId, $needs, $orderId) {
            $restocked = []; // material_id => số lượng đã hoàn từ nhật ký

            // 1. Hoàn vào đúng lô đã trừ (nếu có nhật ký xuất kho của đơn)
            if ($orderId) {
                // Chống hoàn 2 lần: nếu đã có log hoàn (số âm) cho đơn này thì bỏ qua
                $alreadyDone = \App\Models\StockMovement::where('reference_type', 'order')
                    ->where('reference_id', $orderId)
                    ->where('quantity', '<', 0)
                    ->exists();
                if ($alreadyDone) {
                    return;
                }
                $movements = \App\Models\StockMovement::where('reference_type', 'order')
                    ->where('reference_id', $orderId)
                    ->where('quantity', '>', 0) // chỉ dòng xuất
                    ->orderBy('id')
                    ->get();
                foreach ($movements as $m) {
                    $batch = Batch::where('id', $m->batch_id)->lockForUpdate()->first();
                    if (!$batch) {
                        continue;
                    }
                    $qty = (float) $m->quantity;
                    $batch->current_quantity += $qty;
                    if ($batch->status === 'exhausted' && (float) $batch->current_quantity > 0) {
                        $batch->status = 'active';
                    }
                    $batch->save();
                    // Ghi log hoàn (số âm) để đối ứng với dòng xuất
                    \App\Models\StockMovement::create([
                        'branch_id' => $branchId,
                        'material_id' => $m->material_id,
                        'batch_id' => $batch->id,
                        'quantity' => -$qty,
                        'unit_cost' => (float) $m->unit_cost,
                        'reference_type' => 'order',
                        'reference_id' => $orderId,
                        'note' => 'Hoàn kho khi hủy/gộp đơn',
                    ]);
                    $restocked[$m->material_id] = ($restocked[$m->material_id] ?? 0) + $qty;
                }
            }

            // 2. Fallback cho đơn cũ (chưa có nhật ký): hoàn phần còn lại vào lô mới nhất
            foreach ($needs as $materialId => $qty) {
                $remaining = $qty - ($restocked[$materialId] ?? 0);
                if ($remaining < 0.001) {
                    continue;
                }
                $batch = Batch::where('branch_id', $branchId)
                    ->where('material_id', $materialId)
                    ->orderBy('id', 'desc')
                    ->lockForUpdate()
                    ->first();

                if ($batch) {
                    $batch->current_quantity += $remaining;
                    if ($batch->status === 'exhausted' && (float) $batch->current_quantity > 0) {
                        $batch->status = 'active';
                    }
                    $batch->save();
                }
            }
        });
    }
}
