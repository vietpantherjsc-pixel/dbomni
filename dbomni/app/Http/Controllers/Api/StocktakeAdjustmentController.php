<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\StockMovement;
use App\Models\StocktakeAdjustment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 55 p11b: duyệt đề xuất điều chỉnh kho từ chênh lệch kiểm kê.
// Chốt phiếu kiểm kê chỉ ghi nhận; vượt ngưỡng → sinh đề xuất pending.
// Quản lý duyệt (permission:inventory.manage) mới thực hiện điều chỉnh kho thật.
class StocktakeAdjustmentController extends Controller
{
    // Danh sách đề xuất (mặc định chỉ pending)
    public function index(Request $request): JsonResponse
    {
        $q = StocktakeAdjustment::with(['material:id,name,unit', 'branch:id,name', 'stocktake:id'])
            ->orderByDesc('id');
        if ($request->filled('branch_id')) $q->where('branch_id', $request->input('branch_id'));
        if ($request->filled('status')) {
            $q->where('status', $request->input('status'));
        } else {
            $q->where('status', 'pending');
        }
        $per = min((int) $request->input('per_page', 20), 200);
        return response()->json(['success' => true, 'data' => $q->paginate($per)]);
    }

    // Duyệt → thực hiện điều chỉnh kho thật (tạo lô tăng / trừ FIFO) + ghi nhật ký
    public function approve(Request $request, int $id): JsonResponse
    {
        $actor = $request->user();
        $adj = StocktakeAdjustment::with('material')->where('status', 'pending')->findOrFail($id);
        $material = $adj->material;
        if (!$material) {
            return response()->json(['success' => false, 'message' => 'Nguyên liệu không còn tồn tại.'], 422);
        }

        try {
            DB::transaction(function () use ($adj, $material, $actor) {
            // Audit 2026-10-23 KHO-03: khóa dòng phiếu + kiểm tra lại trạng thái
            // TRONG transaction (mẫu InboundReceipt::approve) — chống duyệt trùng
            // khi 2 request chạy đồng thời.
            $locked = StocktakeAdjustment::where('id', $adj->id)->lockForUpdate()->first();
            if (!$locked || $locked->status !== 'pending') {
                throw new \Exception('Đề xuất đã được xử lý trước đó.');
            }
            $diff = (float) $adj->diff_qty;
            $branchId = $adj->branch_id;
            if ($diff > 0) {
                // Thừa so với sổ: tạo lô điều chỉnh tăng
                // Audit 2026-10-23 KHO-08: giá vốn tham chiếu = giá vốn bình quân
                // các lô đang có của NL tại CN (thay vì 0).
                $refCost = (float) (Batch::where('branch_id', $branchId)
                    ->where('material_id', $material->id)
                    ->where('status', 'active')
                    ->where('current_quantity', '>', 0)
                    ->selectRaw('SUM(current_quantity * unit_cost) / NULLIF(SUM(current_quantity), 0) AS c')
                    ->value('c') ?? 0);
                $batch = Batch::create([
                    'branch_id' => $branchId,
                    'material_id' => $material->id,
                    // Ngoại lệ luật định dạng mã (Đại Vương chốt 2026-10-21 ~23:14): họ DC-ADJ giữ '-'
                    // làm mốc phân đoạn giữa 2 số id có độ dài thay đổi (phiếu + nguyên liệu).
                    'batch_code' => 'DC-ADJ' . $adj->id . '-' . $material->id,
                    'initial_quantity' => $diff,
                    'current_quantity' => $diff,
                    'unit_cost' => $refCost,
                    'status' => 'active',
                ]);
                StockMovement::create([
                    'branch_id' => $branchId,
                    'material_id' => $material->id,
                    'batch_id' => $batch->id,
                    'quantity' => -$diff, // nhập = số âm theo quy ước
                    'unit_cost' => $refCost,
                    'reference_type' => 'adjustment',
                    'reference_id' => $adj->id,
                    'note' => 'Duyệt điều chỉnh kiểm kê #' . $adj->stocktake_id . ': tăng ' . $diff . ' ' . $material->unit,
                ]);
            } elseif ($diff < 0) {
                // Thiếu so với sổ: trừ FIFO
                $need = abs($diff);
                $batches = Batch::where('branch_id', $branchId)
                    ->where('material_id', $material->id)
                    ->where('status', 'active')
                    ->where('current_quantity', '>', 0)
                    // Audit 2026-10-23 KHO-05: duyệt điều chỉnh giảm cũng loại lô đã quá hạn
                    ->where(fn ($q) => $q->whereNull('expired_at')->orWhere('expired_at', '>=', now()->toDateString()))
                    ->orderByRaw('expired_at IS NULL, expired_at ASC, id ASC')
                    ->lockForUpdate()
                    ->get();
                $available = (float) $batches->sum('current_quantity');
                if ($available < $need - 0.001) {
                    throw new \Exception("Tồn kho hiện tại chỉ còn {$available} {$material->unit}, không đủ để điều chỉnh giảm {$need}.");
                }
                foreach ($batches as $b) {
                    if ($need <= 0) break;
                    $take = min((float) $b->current_quantity, $need);
                    $remaining = (float) $b->current_quantity - $take;
                    $b->decrement('current_quantity', $take);
                    $need -= $take;
                    StockMovement::create([
                        'branch_id' => $branchId,
                        'material_id' => $material->id,
                        'batch_id' => $b->id,
                        'quantity' => (float) $take,
                        'unit_cost' => (float) $b->unit_cost,
                        'reference_type' => 'adjustment',
                        'reference_id' => $adj->id,
                        'note' => 'Duyệt điều chỉnh kiểm kê #' . $adj->stocktake_id . ': giảm ' . $take . ' ' . $material->unit,
                    ]);
                    if ($remaining < 0.001) {
                        $b->status = 'exhausted';
                        $b->save();
                    }
                }
            }
            $adj->update([
                'status' => 'approved',
                'approved_by_user_id' => $actor instanceof \App\Models\User ? $actor->id : null,
                // Gói "Chờ duyệt trên Hub" (2026-10-21): người duyệt là Employee
                'approved_by_employee_id' => \App\Support\ApprovalActor::ids($actor)[1],
                'approved_at' => now(),
            ]);
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }

        return response()->json(['success' => true, 'message' => 'Đã duyệt và điều chỉnh kho.']);
    }

    // Từ chối đề xuất (không đổi kho)
    public function reject(Request $request, int $id): JsonResponse
    {
        $v = $request->validate(['note' => 'nullable|string|max:500']);
        $adj = StocktakeAdjustment::where('status', 'pending')->findOrFail($id);
        $actor = $request->user();
        $adj->update([
            'status' => 'rejected',
            'approved_by_user_id' => $actor instanceof \App\Models\User ? $actor->id : null,
            // Gói "Chờ duyệt trên Hub" (2026-10-21): người từ chối là Employee
            'approved_by_employee_id' => \App\Support\ApprovalActor::ids($actor)[1],
            'approved_at' => now(),
            'note' => trim(($adj->note ? $adj->note . ' | ' : '') . 'Từ chối: ' . ($v['note'] ?? 'không ghi lý do')),
        ]);
        return response()->json(['success' => true, 'message' => 'Đã từ chối đề xuất.']);
    }
}
