<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Branch;
use App\Models\Material;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class InventoryController extends Controller
{
    /**
     * Báo cáo tồn kho theo chi nhánh và cảnh báo nguyên liệu sắp hết
     */
    public function getStockByBranch(int $branchId): JsonResponse
    {
        $branch = Branch::findOrFail($branchId);

        $materials = Material::with(['batches' => function ($query) use ($branchId) {
            $query->where('branch_id', $branchId)
                  ->where('status', 'active');
        }])->get();

        $report = $materials->map(function ($material) {
            $currentStock = $material->batches->sum('current_quantity');
            $isLowStock = $currentStock <= $material->minimum_stock;

            return [
                'material_id' => $material->id,
                'name' => $material->name,
                'unit' => $material->unit,
                'type' => $material->type,
                'minimum_stock' => (float) $material->minimum_stock,
                'current_stock' => (float) $currentStock,
                'is_low_stock' => $isLowStock,
                'is_active' => (bool) $material->is_active, // Gói 55 p11w
                'batches_count' => $material->batches->count(),
            ];
        });

        return response()->json([
            'success' => true,
            'branch' => [
                'id' => $branch->id,
                'name' => $branch->name,
            ],
            'data' => $report,
        ], 200);
    }

    // Gói 55 p11: điều chỉnh tồn nhanh ± (từ nút −/+ trong danh sách)
    public function quickAdjust(Request $request): JsonResponse
    {
        $v = $request->validate([
            'material_id' => 'required|exists:materials,id',
            'quantity' => 'required|numeric', // dương = nhập, âm = xuất
            'branch_id' => 'required|exists:branches,id',
        ]);
        $material = Material::findOrFail($v['material_id']);
        $qty = (float) $v['quantity'];

        return DB::transaction(function () use ($material, $qty, $v) {
            if ($qty > 0) {
                // Nhập: tạo lô mới
                Batch::create([
                    'material_id' => $material->id,
                    'branch_id' => $v['branch_id'],
                    'batch_code' => 'ADJ-' . now()->format('YmdHis') . '-' . $material->id,
                    'initial_quantity' => $qty,
                    'current_quantity' => $qty,
                    'unit_cost' => 0,
                    'status' => 'active',
                ]);
            } else {
                // Xuất: trừ FIFO
                $need = abs($qty);
                $batches = Batch::where('material_id', $material->id)
                    ->where('branch_id', $v['branch_id'])
                    ->where('status', 'active')
                    ->where('current_quantity', '>', 0)
                    ->orderByRaw('expired_at IS NULL, expired_at ASC, id ASC')
                    ->lockForUpdate()
                    ->get();
                $available = $batches->sum('current_quantity');
                if ($available < $need) {
                    return response()->json([
                        'success' => false,
                        'message' => "Tồn kho không đủ (còn {$available} {$material->unit}).",
                    ], 422);
                }
                foreach ($batches as $b) {
                    if ($need <= 0) break;
                    $take = min($b->current_quantity, $need);
                    $remaining = (float) $b->current_quantity - $take;
                    $b->decrement('current_quantity', $take);
                    $need -= $take;
                    // Gói 55: set exhausted khi hết (đồng nhất với InventoryService)
                    if ($remaining <= 0) {
                        $b->status = 'exhausted';
                        $b->save();
                    }
                }
            }
            return response()->json(['success' => true, 'message' => 'Đã cập nhật tồn kho.']);
        });
    }
}