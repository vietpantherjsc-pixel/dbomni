<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\RevenueTarget;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

// Chương trình chỉ số 360 — Đợt 2, N-3 (Phụ lục khóa 2026-11-15): mục
// tiêu doanh thu tháng theo (chi nhánh × tháng), phục vụ TC-3. Chỉ theo
// từng CN — không cho branch_id = 0 ("Tất cả"). Ghi gác lá thật mới
// finance.targets.edit (không dùng alias finance.manage).
class RevenueTargetController extends Controller
{
    use \App\Traits\ValidatesEmployeeBranch;

    /** Employee chỉ ghi/xem dòng của CN mình phụ trách; Chủ CN chỉ CN mình. */
    private function assertBranchScope(Request $request, int $branchId): void
    {
        $u = $request->user();
        if ($u instanceof Employee && !in_array($branchId, $this->effectiveBranchScope($u), true)) {
            abort(403, 'Chi nhánh này không thuộc phạm vi phụ trách của bạn.');
        }
        if ($u instanceof User && $u->isBranchOwner() && (int) $u->owner_branch_id !== $branchId) {
            abort(403, 'Chủ Chi Nhánh chỉ được đặt mục tiêu cho chi nhánh của mình.');
        }
    }

    /** CN được xem ở index: Employee/Chủ CN chỉ thấy CN trong phạm vi. */
    private function visibleBranchIds(Request $request): ?array
    {
        $u = $request->user();
        if ($u instanceof Employee) {
            return $this->effectiveBranchScope($u);
        }
        if ($u instanceof User && $u->isBranchOwner()) {
            return [(int) $u->owner_branch_id];
        }
        return null; // User Chủ Sở Hữu: toàn chuỗi
    }

    private function present(RevenueTarget $row): array
    {
        return [
            'id' => (int) $row->id,
            'branch_id' => (int) $row->branch_id,
            'branch' => $row->branch->name ?? null,
            'month' => $row->month->format('Y-m'),
            'target_amount' => (float) $row->target_amount,
        ];
    }

    public function index(Request $request): JsonResponse
    {
        $month = $request->query('month');
        if (!preg_match('/^\d{4}-\d{2}$/', (string) $month)) {
            $month = Carbon::now('Asia/Ho_Chi_Minh')->format('Y-m');
        }
        $monthStart = Carbon::createFromFormat('Y-m-d', $month . '-01', 'Asia/Ho_Chi_Minh')->startOfDay();
        $branchId = (int) $request->query('branch_id', 0);
        $visible = $this->visibleBranchIds($request);
        if ($branchId > 0) {
            if ($visible !== null && !in_array($branchId, $visible, true)) {
                return response()->json(['success' => false, 'message' => 'Chi nhánh không thuộc phạm vi của bạn.'], 403);
            }
        } elseif ($visible !== null) {
            // Nhân viên/Chủ CN xem "Tất cả" → chỉ các CN trong phạm vi.
            $rows = RevenueTarget::with('branch')
                ->whereIn('branch_id', $visible)
                ->whereDate('month', $monthStart->toDateString())
                ->orderBy('branch_id')->get();
            return response()->json(['success' => true, 'data' => [
                'month' => $month,
                'branch_id' => 0,
                'targets' => $rows->map(fn($r) => $this->present($r))->values()->all(),
                'total' => (float) $rows->sum('target_amount'),
            ]]);
        }
        $q = RevenueTarget::with('branch')->whereDate('month', $monthStart->toDateString());
        if ($branchId > 0) $q->where('branch_id', $branchId);
        $rows = $q->orderBy('branch_id')->get();
        return response()->json(['success' => true, 'data' => [
            'month' => $month,
            'branch_id' => $branchId,
            'targets' => $rows->map(fn($r) => $this->present($r))->values()->all(),
            'total' => (float) $rows->sum('target_amount'),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|integer|min:1|exists:branches,id',
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'target_amount' => 'required|numeric|min:0|max:9999999999999.99',
        ]);
        $branchId = (int) $validated['branch_id'];
        $this->assertBranchScope($request, $branchId);
        $monthStart = Carbon::createFromFormat('Y-m-d', $validated['month'] . '-01', 'Asia/Ho_Chi_Minh')->startOfDay();
        $actor = $request->user();
        $userId = $actor instanceof User ? (int) $actor->id : null;
        $row = RevenueTarget::updateOrCreate(
            ['branch_id' => $branchId, 'month' => $monthStart->toDateString()],
            ['target_amount' => $validated['target_amount'], 'updated_by' => $userId]
        );
        if ($row->wasRecentlyCreated) {
            $row->update(['created_by' => $userId]);
        }
        return response()->json(['success' => true, 'message' => 'Đã lưu mục tiêu tháng.', 'data' => $this->present($row->fresh())]);
    }
}
