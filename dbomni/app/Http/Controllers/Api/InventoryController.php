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
    // Gói 55 p11b: bắt buộc nhập lý do (min 10 ký tự); vượt ngưỡng giá trị
    // (settings.inventory_adjust_threshold, mặc định 500k) thì CHẶN + ghi log
    // yêu cầu vào stock_movements để quản lý duyệt, không thực hiện ngay.
    public function quickAdjust(Request $request): JsonResponse
    {
        $v = $request->validate([
            'material_id' => 'required|exists:materials,id',
            'quantity' => 'required|numeric', // dương = nhập, âm = xuất
            'branch_id' => 'required|exists:branches,id',
            'reason' => 'required|string|min:10|max:500', // Gói 55 p11b: lý do bắt buộc
        ]);
        $material = Material::findOrFail($v['material_id']);
        $qty = (float) $v['quantity'];
        $reason = trim($v['reason']);

        // Gói 55 p11b: tính giá trị điều chỉnh theo giá vốn bình quân lô đang có
        $avgCost = (float) \App\Models\Batch::where('material_id', $material->id)
            ->where('branch_id', $v['branch_id'])
            ->where('status', 'active')
            ->where('current_quantity', '>', 0)
            ->selectRaw('SUM(current_quantity * unit_cost) / NULLIF(SUM(current_quantity), 0) AS avg_cost')
            ->value('avg_cost');
        $adjustValue = abs($qty) * $avgCost;
        $threshold = (float) \App\Models\Setting::get('inventory_adjust_threshold', '500000');
        if ($threshold > 0 && $adjustValue > $threshold) {
            // Vượt ngưỡng: không thực hiện, ghi log yêu cầu chờ duyệt (số lượng 0 = chưa đổi kho)
            \App\Models\StockMovement::create([
                'branch_id' => $v['branch_id'],
                'material_id' => $material->id,
                'batch_id' => null,
                'quantity' => 0,
                'unit_cost' => $avgCost,
                'reference_type' => 'adjustment',
                'reference_id' => null,
                'note' => 'Yêu cầu điều chỉnh vượt ngưỡng - CHỜ DUYỆT: ' . ($qty > 0 ? '+' : '') . $qty . ' ' . $material->unit
                    . ' (giá trị ≈ ' . number_format($adjustValue, 0, ',', '.') . 'đ, ngưỡng ' . number_format($threshold, 0, ',', '.') . 'đ)'
                    . ' | Lý do: ' . $reason
                    . ' | Người yêu cầu: ' . $this->actorName($request),
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Giá trị điều chỉnh (≈ ' . number_format($adjustValue, 0, ',', '.') . 'đ) vượt ngưỡng '
                    . number_format($threshold, 0, ',', '.') . 'đ. Yêu cầu đã được ghi lại, vui lòng nhờ quản lý duyệt.',
                'needs_approval' => true,
            ], 403);
        }

        // Gói SEC2: return nằm NGOÀI closure transaction (không return response trong transaction)
        $result = DB::transaction(function () use ($material, $qty, $v, $reason, $request) {
            if ($qty > 0) {
                // Nhập: tạo lô mới
                $batch = Batch::create([
                    'material_id' => $material->id,
                    'branch_id' => $v['branch_id'],
                    'batch_code' => 'ADJ-' . now()->format('YmdHis') . '-' . $material->id,
                    'initial_quantity' => $qty,
                    'current_quantity' => $qty,
                    'unit_cost' => 0,
                    'status' => 'active',
                ]);
                // Gói 55 p11af: nhật ký điều chỉnh (nhập = số âm theo quy ước stock_movements)
                \App\Models\StockMovement::create([
                    'branch_id' => $v['branch_id'],
                    'material_id' => $material->id,
                    'batch_id' => $batch->id,
                    'quantity' => -$qty,
                    'unit_cost' => 0,
                    'reference_type' => 'adjustment',
                    'reference_id' => null,
                    'note' => 'Điều chỉnh nhanh: nhập ' . $qty . ' ' . $material->unit . ' | Lý do: ' . $reason,
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
                    return [
                        'success' => false,
                        'message' => "Tồn kho không đủ (còn {$available} {$material->unit}).",
                        'status' => 422,
                    ];
                }
                foreach ($batches as $b) {
                    if ($need <= 0) break;
                    $take = min($b->current_quantity, $need);
                    $remaining = (float) $b->current_quantity - $take;
                    $b->decrement('current_quantity', $take);
                    $need -= $take;
                    // Gói 55 p11af: nhật ký điều chỉnh từng lô (xuất = số dương)
                    \App\Models\StockMovement::create([
                        'branch_id' => $v['branch_id'],
                        'material_id' => $material->id,
                        'batch_id' => $b->id,
                        'quantity' => (float) $take,
                        'unit_cost' => (float) $b->unit_cost,
                        'reference_type' => 'adjustment',
                        'reference_id' => null,
                        'note' => 'Điều chỉnh nhanh: xuất ' . $take . ' ' . $material->unit . ' | Lý do: ' . $reason,
                    ]);
                    // Gói SEC2: dùng epsilon < 0.001 đồng nhất với InventoryService
                    if ($remaining < 0.001) {
                        $b->status = 'exhausted';
                        $b->save();
                    }
                }
            }
            return ['success' => true, 'message' => 'Đã cập nhật tồn kho.', 'status' => 200];
        });

        return response()->json(
            ['success' => $result['success'], 'message' => $result['message']],
            $result['status']
        );
    }

    // Gói 55 p11b: tên người gọi để ghi log yêu cầu điều chỉnh
    private function actorName(Request $request): string
    {
        $actor = $request->user();
        if (!$actor) return '';
        return trim((string) ($actor->full_name ?? $actor->name ?? $actor->username ?? ''));
    }
}