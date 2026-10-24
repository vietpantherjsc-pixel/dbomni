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
    // Audit 2026-10-23 B-5: NV chỉ xem/điều chỉnh tồn thuộc CN phân công.
    protected function denyStockBranch(Request $request, $branchId): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Chi nhánh không thuộc phạm vi của bạn.'], 403);
        }
        return null;
    }
    /**
     * Báo cáo tồn kho theo chi nhánh và cảnh báo nguyên liệu sắp hết
     */
    public function getStockByBranch(Request $request, int $branchId): JsonResponse
    {
        if ($deny = $this->denyStockBranch($request, $branchId)) return $deny;
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

    // Spec P4-A1: BTP dưới ngưỡng khẩu phần (mặc định 20, cấu hình được)
    // khẩu phần = tồn BTP hiện tại / lượng BTP trung bình cho 1 đơn vị sản phẩm
    public function btpLowStock(Request $request): JsonResponse
    {
        $branchId = (int) $request->query('branch_id', 0);
        if ($branchId > 0 && ($deny = $this->denyStockBranch($request, $branchId))) return $deny;
        $threshold = (float) \App\Models\Setting::get('btp_low_portion_threshold', 20);

        $btpIds = \App\Models\ProductionRecipe::distinct()->pluck('material_id');
        if ($btpIds->isEmpty()) {
            return response()->json(['success' => true, 'data' => [], 'threshold' => $threshold]);
        }

        // Lượng BTP trung bình cho 1 đơn vị SP (từ định mức món)
        $avgUse = \App\Models\Recipe::whereIn('material_id', $btpIds)
            ->selectRaw('material_id, AVG(quantity) as avg_qty')->groupBy('material_id')->pluck('avg_qty', 'material_id');

        $stocks = Batch::whereIn('material_id', $btpIds)->where('status', 'active')
            ->when($branchId > 0, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === 0 && $request->user() instanceof \App\Models\Employee, fn ($q) => $q->whereIn('branch_id', $request->user()->allBranchIds()))
            ->selectRaw('material_id, branch_id, SUM(current_quantity) as stock')
            ->groupBy('material_id', 'branch_id')->get();

        $mats = Material::whereIn('id', $btpIds)->pluck('name', 'id');
        $branches = Branch::pluck('name', 'id');

        $out = [];
        foreach ($stocks as $s) {
            $avg = (float) ($avgUse[$s->material_id] ?? 0);
            if ($avg <= 0) continue;
            $portions = floor((float) $s->stock / $avg);
            if ($portions <= $threshold) {
                $out[] = [
                    'material_id' => $s->material_id,
                    'material_name' => $mats[$s->material_id] ?? ('#' . $s->material_id),
                    'branch_id' => $s->branch_id,
                    'branch_name' => $branches[$s->branch_id] ?? '',
                    'stock' => (float) $s->stock,
                    'portions' => (int) $portions,
                ];
            }
        }
        usort($out, fn ($a, $b) => $a['portions'] <=> $b['portions']);
        return response()->json(['success' => true, 'data' => $out, 'threshold' => $threshold]);
    }

    // Spec P4-A2: lô sắp hết HSD (≤7 ngày: đỏ; ≤30 ngày: cam)
    public function expiringBatches(Request $request): JsonResponse
    {
        $branchId = (int) $request->query('branch_id', 0);
        if ($branchId > 0 && ($deny = $this->denyStockBranch($request, $branchId))) return $deny;
        $today = \Carbon\Carbon::today();
        $rows = Batch::with('material:id,name,unit')
            ->where('status', 'active')->where('current_quantity', '>', 0)
            ->whereNotNull('expired_at')
            ->where('expired_at', '<=', $today->copy()->addDays(30)->toDateString())
            ->when($branchId > 0, fn ($q) => $q->where('branch_id', $branchId))
            ->when($branchId === 0 && $request->user() instanceof \App\Models\Employee, fn ($q) => $q->whereIn('branch_id', $request->user()->allBranchIds()))
            ->orderBy('expired_at')->get()
            ->map(function ($b) use ($today) {
                $days = $today->diffInDays(\Carbon\Carbon::parse($b->expired_at), false);
                return [
                    'batch_id' => $b->id,
                    'batch_code' => $b->batch_code,
                    'material_name' => $b->material?->name,
                    'unit' => $b->material?->unit,
                    'quantity' => (float) $b->current_quantity,
                    'expired_at' => \Carbon\Carbon::parse($b->expired_at)->format('d/m/Y'),
                    'days_left' => (int) $days,
                    'level' => $days <= 7 ? 'red' : 'orange',
                    'branch_id' => $b->branch_id,
                ];
            });
        return response()->json(['success' => true, 'data' => $rows]);
    }

    // Gói 55 p11: điều chỉnh tồn nhanh ± (từ nút −/+ trong danh sách)
    // Gói 55 p11b: bắt buộc nhập lý do (min 10 ký tự); vượt ngưỡng giá trị
    // (settings.inventory_adjust_threshold, mặc định 500k) thì CHẶN + ghi log
    // yêu cầu vào stock_movements để quản lý duyệt, không thực hiện ngay.
    public function quickAdjust(Request $request): JsonResponse
    {
        $v = $request->validate([
            'material_id' => 'required|exists:materials,id',
            'quantity' => 'required|numeric|not_in:0', // dương = nhập, âm = xuất; Audit 23/10 KHO-09: cấm 0
            'branch_id' => 'required|exists:branches,id',
            'reason' => 'required|string|min:10|max:500', // Gói 55 p11b: lý do bắt buộc
        ]);
        if ($deny = $this->denyStockBranch($request, $v['branch_id'])) return $deny;
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
            // Audit 2026-10-23 KHO-09: nhánh vượt ngưỡng trước đây ghi log "CHỜ DUYỆT"
            // nhưng KHÔNG có đầu mối duyệt nào trong hệ thống -> nay TỪ CHỐI rõ ràng:
            // không đổi kho, log chỉ còn vai trò vết kiểm toán của yêu cầu bị từ chối.
            // Điều chỉnh lớn đi qua luồng kiểm kê + đề xuất điều chỉnh (có duyệt thật).
            \App\Models\StockMovement::create([
                'branch_id' => $v['branch_id'],
                'material_id' => $material->id,
                'batch_id' => null,
                'quantity' => 0,
                'unit_cost' => $avgCost,
                'reference_type' => 'adjustment',
                'reference_id' => null,
                'note' => 'Yêu cầu điều chỉnh vượt ngưỡng - ĐÃ TỪ CHỐI (chưa đổi kho): ' . ($qty > 0 ? '+' : '') . $qty . ' ' . $material->unit
                    . ' (giá trị ≈ ' . number_format($adjustValue, 0, ',', '.') . 'đ, ngưỡng ' . number_format($threshold, 0, ',', '.') . 'đ)'
                    . ' | Lý do: ' . $reason
                    . ' | Người yêu cầu: ' . $this->actorName($request),
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Giá trị điều chỉnh (≈ ' . number_format($adjustValue, 0, ',', '.') . 'đ) vượt ngưỡng '
                    . number_format($threshold, 0, ',', '.') . 'đ nên bị từ chối. Hãy thực hiện qua phiếu kiểm kê + đề xuất điều chỉnh để được duyệt, hoặc điều chỉnh ngưỡng trong Thiết lập.',
                'needs_approval' => true,
            ], 403);
        }

        // Gói SEC2: return nằm NGOÀI closure transaction (không return response trong transaction)
        $result = DB::transaction(function () use ($material, $qty, $v, $reason, $request, $avgCost) {
            if ($qty > 0) {
                // Nhập: tạo lô mới
                $batch = Batch::create([
                    'material_id' => $material->id,
                    'branch_id' => $v['branch_id'],
                    // Luật bỏ gạch mở rộng (2026-10-21 ~23:09): mã lô nối liền không '-'
                    'batch_code' => 'ADJ' . now()->format('YmdHis') . $material->id,
                    'initial_quantity' => $qty,
                    'current_quantity' => $qty,
                    // Audit 2026-10-23 KHO-08: giá vốn tham chiếu = giá vốn bình quân hiện có
                    'unit_cost' => $avgCost,
                    'status' => 'active',
                ]);
                // Gói 55 p11af: nhật ký điều chỉnh (nhập = số âm theo quy ước stock_movements)
                \App\Models\StockMovement::create([
                    'branch_id' => $v['branch_id'],
                    'material_id' => $material->id,
                    'batch_id' => $batch->id,
                    'quantity' => -$qty,
                    'unit_cost' => $avgCost,
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
                    // Audit 2026-10-23 KHO-05 (mở rộng cùng cơ chế): loại lô đã quá hạn
                    ->where(fn ($q) => $q->whereNull('expired_at')->orWhere('expired_at', '>=', now()->toDateString()))
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