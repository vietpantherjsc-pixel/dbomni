<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PrepaidExpense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 57 (2026-10-14): CRUD chi phí trả trước / CAPEX + tính phân bổ đều theo tháng cho P&L.
class PrepaidExpenseController extends Controller
{
    use \App\Traits\ValidatesEmployeeBranch;

    // Đợt vá gộp gác chi nhánh (Đại Vương chốt 2026-11-08): khuôn gói Đặt
    // hàng — actor Employee ép phạm vi allBranchIds. Đặc thù họ này:
    // branch_id NULL = khoản TOÀN HỆ (mọi CN cùng thấy trong phân bổ P&L —
    // thiết kế sẵn có). Luật áp dụng: ĐỌC → khoản toàn hệ vẫn thấy được,
    // khoản của CN ngoài phân công → 404; GHI (sửa/xóa) → khoản toàn hệ là
    // vùng của admin, NV thao tác → 404 như ngoài phân công. Actor User
    // giữ toàn quyền.
    protected function denyPrepaidBranch(Request $request, $branchId, bool $write = false): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor instanceof \App\Models\Employee) return null;
        if ($branchId === null) {
            return $write
                ? response()->json(['success' => false, 'message' => 'Không tìm thấy khoản chi phí trả trước.'], 404)
                : null;
        }
        if (!in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Không tìm thấy khoản chi phí trả trước.'], 404);
        }
        return null;
    }

    public function index(Request $request): JsonResponse
    {
        $q = PrepaidExpense::with('branch:id,name')
            ->when($request->filled('branch_id'), fn($qq) => $qq->where(function ($w) use ($request) {
                $w->where('branch_id', $request->branch_id)->orWhereNull('branch_id');
            }))
            ->when($request->has('active'), fn($qq) => $qq->where('is_active', (bool) $request->query('active')))
            ->orderByDesc('start_date');
        // Đợt vá gộp gác CN: NV chỉ thấy khoản thuộc CN được phân công +
        // khoản toàn hệ (branch_id NULL) theo thiết kế phân bổ P&L sẵn có.
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $ids = $actor->allBranchIds();
            $q->where(function ($w) use ($ids) {
                $w->whereIn('branch_id', $ids)->orWhereNull('branch_id');
            });
        }
        $items = $q->get()->map(function (PrepaidExpense $p) {
            $d = $p->toArray();
            $d['monthly_amount'] = $p->monthlyAmount();
            return $d;
        });
        return response()->json(['success' => true, 'data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'required|string|max:150',
            'category' => 'nullable|in:rent,capex,software,other',
            'total_amount' => 'required|numeric|min:1',
            'start_date' => 'required|date',
            'months' => 'required|integer|min:1|max:120',
            'notes' => 'nullable|string|max:500',
            'is_active' => 'boolean',
        ]);
        // Đợt vá gộp gác CN: NV tạo khoản → CN resolve theo phân công;
        // branch_id để trống (toàn hệ) cũng rơi về CN chính của NV — khoản
        // toàn hệ chỉ do admin tạo (điểm lệch khuôn có chủ đích, xem deny ở trên).
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $v['branch_id'] = $this->resolveEmployeeBranch($actor, $v['branch_id'] ?? null);
        }
        $p = PrepaidExpense::create($v);
        $d = $p->fresh()->toArray();
        $d['monthly_amount'] = $p->fresh()->monthlyAmount();
        return response()->json(['success' => true, 'data' => $d], 201);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $p = PrepaidExpense::with('branch:id,name')->findOrFail($id);
        if ($deny = $this->denyPrepaidBranch($request, $p->branch_id)) return $deny;
        $d = $p->toArray();
        $d['monthly_amount'] = $p->monthlyAmount();
        return response()->json(['success' => true, 'data' => $d]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $p = PrepaidExpense::findOrFail($id);
        if ($deny = $this->denyPrepaidBranch($request, $p->branch_id, true)) return $deny;
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'sometimes|string|max:150',
            'category' => 'nullable|in:rent,capex,software,other',
            'total_amount' => 'sometimes|numeric|min:1',
            'start_date' => 'sometimes|date',
            'months' => 'sometimes|integer|min:1|max:120',
            'notes' => 'nullable|string|max:500',
            'is_active' => 'boolean',
        ]);
        // NV sửa: CN đích trong payload cũng resolve theo phân công (không
        // dời khoản sang CN ngoài phân công hay sang toàn hệ qua đường sửa).
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && array_key_exists('branch_id', $v)) {
            $v['branch_id'] = $this->resolveEmployeeBranch($actor, $v['branch_id']);
        }
        $p->update($v);
        $d = $p->fresh()->toArray();
        $d['monthly_amount'] = $p->fresh()->monthlyAmount();
        return response()->json(['success' => true, 'data' => $d]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $p = PrepaidExpense::findOrFail($id);
        if ($deny = $this->denyPrepaidBranch($request, $p->branch_id, true)) return $deny;
        $p->delete();
        return response()->json(['success' => true]);
    }

    /**
     * Tính tổng phân bổ của các khoản active vào khoảng [from, to] (Y-m-d).
     * Dùng cho P&L: PrepaidExpenseController::allocation($from, $to, $branchId).
     */
    public static function allocation(string $from, string $to, $branchId = null): array
    {
        $q = PrepaidExpense::where('is_active', true)
            ->when($branchId, fn($qq) => $qq->where(function ($w) use ($branchId) {
                $w->where('branch_id', $branchId)->orWhereNull('branch_id');
            }));
        $items = [];
        $total = 0.0;
        foreach ($q->get() as $p) {
            $amt = $p->allocationFor($from, $to);
            if ($amt > 0) {
                $items[] = ['id' => $p->id, 'name' => $p->name, 'category' => $p->category, 'amount' => $amt];
                $total += $amt;
            }
        }
        return ['items' => $items, 'total' => round($total, 0)];
    }
}
