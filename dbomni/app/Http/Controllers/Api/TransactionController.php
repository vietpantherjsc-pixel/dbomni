<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Transaction;
use App\Models\TransactionCategory;
use App\Models\TransactionPayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 27 (2026-10-09): Thu-Chi hoàn thiện.
// - CRUD phiếu thu/chi + lọc + tổng kết kỳ.
// - Phiếu tự sinh (related_type != null, VD: từ nhập kho): chỉ cho sửa ghi chú, không cho sửa số tiền, không cho xóa.
// Gói 60: dùng ValidatesEmployeeBranch để NV nhiều CN chọn CN thao tác.
class TransactionController extends Controller
{
    // Audit 2026-10-23 B-5: NV chỉ thao tác phiếu thu/chi thuộc CN phân công
    // (phiếu branch_id = null là phiếu chung toàn chuỗi — vẫn xem/thao tác được).
    protected function denyTransactionBranch(Request $request, $branchId): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && $branchId !== null
            && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Phiếu không thuộc chi nhánh bạn được phân công.'], 403);
        }
        return null;
    }
    use \App\Traits\ValidatesEmployeeBranch;
    /** Danh sách danh mục thu/chi (kèm cờ is_system). */
    public function categories(): JsonResponse
    {
        $cats = TransactionCategory::orderBy('type')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $cats]);
    }

    /** Danh sách phiếu + tổng kết kỳ theo bộ lọc. */
    public function index(Request $request): JsonResponse
    {
        // Lát 1c (rà soát đêm 2026-11-04): tách PHẠM VI TỔNG khỏi bộ lọc của tab.
        // Trước đây summary tính trên chính query đã lọc theo `type` của tab →
        // "Tồn quỹ" ở tab Phiếu thu ≠ tab Phiếu chi; và tính cả phiếu CHỜ DUYỆT
        // (duyệt xong tổng không đổi). Nay: tổng tính trên phạm vi chung (CN /
        // quỹ / kỳ / đối tác / danh mục / tìm kiếm — KHÔNG lọc type và trạng
        // thái duyệt) với cơ số tiền hiệu lực thống nhất ở $effective.
        $scope = Transaction::query()
            ->when($request->filled('branch_id'), fn($qq) => $qq->where('branch_id', $request->branch_id))
            ->when($request->filled('category_id'), fn($qq) => $qq->where('category_id', $request->category_id))
            ->when($request->filled('partner_id'), fn($qq) => $qq->where('partner_id', $request->partner_id))
            ->when($request->filled('account_id'), fn($qq) => $qq->where('account_id', $request->account_id)) // Gói 57
            ->when($request->user() instanceof \App\Models\Employee, fn($qq) => $qq->where(fn($w) => $w->whereIn('branch_id', $request->user()->allBranchIds())->orWhereNull('branch_id')))
            ->when($request->filled('date_from'), fn($qq) => $qq->whereDate('paid_at', '>=', $request->date_from))
            ->when($request->filled('date_to'), fn($qq) => $qq->whereDate('paid_at', '<=', $request->date_to))
            ->when($request->filled('search'), function ($qq) use ($request) {
                $s = '%' . $request->search . '%';
                $qq->where(fn($w) => $w->where('code', 'like', $s)->orWhere('note', 'like', $s));
            });

        // Cơ số TIỀN HIỆU LỰC (dùng chung cho tổng + lũy kế): đã thanh toán,
        // chưa bị từ chối, và đã qua duyệt. Phiếu tự sinh từ duyệt nhập kho /
        // nhập nhanh (related_type inbound_receipt/batch) sinh ra TỪ hành động
        // duyệt nên hiệu lực ngay dù không mang dấu duyệt riêng (dữ liệu cũ
        // cũng theo lệ này); các đời tạo mới đã được đóng dấu duyệt tại nguồn.
        $effective = fn($qq) => $qq->where('status', 'paid')->whereNull('rejected_at')
            ->where(fn($w) => $w->where(fn($a) => $a->whereNotNull('approved_by')->orWhereNotNull('approved_by_employee_id'))
                ->orWhereIn('related_type', ['inbound_receipt', 'batch']));

        $q = (clone $scope)->with(['category:id,name,type', 'branch:id,name', 'partner:id,code,name', 'account:id,name,type'])
            ->when($request->filled('type'), fn($qq) => $qq->where('type', $request->type))
            ->when($request->filled('status'), fn($qq) => $qq->where('status', $request->status))
            // Gói 59: lọc phiếu chờ duyệt cho trang duyệt của quản lý.
            // Gói "Chờ duyệt trên Hub" (2026-10-21): chờ = đủ 3 điều kiện (chưa duyệt user/employee, chưa từ chối).
            ->when($request->input('pending_approval') == '1', fn($qq) => $qq->pendingApproval())
            // Gói "Chờ duyệt trên Hub" (2026-10-21): lọc theo trạng thái duyệt (trang Thu chi Admin).
            ->when($request->input('approval_status') === 'pending', fn($qq) => $qq->pendingApproval())
            ->when($request->input('approval_status') === 'approved', fn($qq) => $qq->wasApproved())
            ->when($request->input('approval_status') === 'rejected', fn($qq) => $qq->wasRejected())
            ->orderByDesc('paid_at')
            ->orderByDesc('id');

        $summary = [
            'total_income' => (float) $effective((clone $scope)->where('type', 'income'))->sum('amount'),
            'total_expense' => (float) $effective((clone $scope)->where('type', 'expense'))->sum('amount'),
        ];
        $summary['balance'] = $summary['total_income'] - $summary['total_expense'];

        $page = $q->paginate(20)->appends($request->query());
        $items = collect($page->items());

        // Gói 57: running balance — số dư lũy kế theo thứ tự thời gian.
        // Nếu lọc theo 1 quỹ: bắt đầu từ opening_balance của quỹ;
        // ngược lại bắt đầu từ 0 (chỉ mang tính tham khảo vì nhiều quỹ).
        // Lát 1c: lũy kế chạy trên TOÀN BỘ tập đã lọc (không chỉ trang hiện
        // tại) và chỉ cộng phiếu hiệu lực theo $effective — trước đây chạy
        // trên 1 trang và cộng cả phiếu đã bị từ chối (lệch với Tồn quỹ).
        $opening = 0.0;
        if ($request->filled('account_id') && class_exists(\App\Models\Account::class)) {
            $acc = \App\Models\Account::find($request->account_id);
            if ($acc) $opening = (float) $acc->opening_balance;
        }
        $chrono = (clone $q)->reorder()->orderBy('paid_at')->orderBy('id')
            ->get(['id', 'type', 'amount', 'status', 'approved_by', 'approved_by_employee_id', 'rejected_at', 'related_type', 'paid_at']);
        $bal = $opening;
        $rbMap = [];
        foreach ($chrono as $tx) {
            $isEffective = $tx->status === 'paid' && $tx->rejected_at === null
                && ($tx->approved_by !== null || $tx->approved_by_employee_id !== null
                    || in_array($tx->related_type, ['inbound_receipt', 'batch'], true));
            if ($isEffective) {
                $bal += $tx->type === 'income' ? (float) $tx->amount : -(float) $tx->amount;
            }
            $rbMap[$tx->id] = round($bal, 0);
        }
        $data = $items->map(function ($tx) use ($rbMap) {
            $d = $tx->toArray();
            $d['running_balance'] = $rbMap[$tx->id] ?? null;
            $d['is_approved'] = $tx->approved_by !== null || $tx->approved_by_employee_id !== null; // Gói 59 + Hub 2026-10-21
            $d['is_rejected'] = $tx->rejected_at !== null; // Gói "Chờ duyệt trên Hub" (2026-10-21)
            return $d;
        })->values();

        return response()->json(['success' => true, 'data' => $data, 'pagination' => [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'total' => $page->total(),
        ], 'summary' => $summary]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'type' => 'required|in:income,expense',
            'category_id' => 'required|exists:transaction_categories,id',
            'branch_id' => 'nullable|exists:branches,id',
            'partner_id' => 'nullable|exists:partners,id', // Gói 29: đối tác (công nợ)
            'is_debt' => 'nullable|boolean', // Gói 29: tick "Ghi công nợ" -> pending, chưa trả
            'amount' => 'required|numeric|min:1',
            'paid_at' => 'nullable|date',
            'occurred_at' => 'nullable|date', // Gói 57: ngày thực chi/phát sinh
            'account_id' => 'nullable|exists:accounts,id', // Gói 57: quỹ/tài khoản
            'attachment' => 'nullable|string|max:255', // Gói 57: path ảnh chứng từ (frontend upload riêng)
            'status' => 'nullable|in:paid,pending,cancelled', // Spec P4-B2: phiếu lương tự sinh chuyển sang hủy khi mở khóa
            'payment_method' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
        ]);

        // Danh mục phải cùng loại thu/chi với phiếu.
        $cat = TransactionCategory::findOrFail($v['category_id']);
        if ($cat->type !== $v['type']) {
            return response()->json(['success' => false, 'message' => 'Danh mục không khớp loại phiếu (thu/chi).'], 422);
        }

        // Gói 29: ghi công nợ -> trạng thái chờ thanh toán, chưa trả đồng nào.
        $isDebt = (bool) ($v['is_debt'] ?? false);
        $status = $isDebt ? 'pending' : ($v['status'] ?? 'paid');

        // Gói 59: NV tạo → chờ quản lý duyệt; admin tạo → duyệt ngay.
        // Gói 60: NV được chọn CN trong danh sách phân công.
        $actor = $request->user();
        $isEmployee = $actor instanceof \App\Models\Employee;
        $branchId = $isEmployee
            ? $this->resolveEmployeeBranch($actor, $v['branch_id'] ?? null)
            : ($v['branch_id'] ?? null);
        // Gói chặn tự duyệt (2026-11-06): ghi vết người tạo CẢ 2 phía qua
        // ApprovalActor — phía NV nay có cột riêng created_by_employee_id
        // (migration 000100); trước đây NV tạo ghi null nên không có dữ kiện.
        [$creatorUserId, $creatorEmployeeId] = \App\Support\ApprovalActor::ids($actor);

        $tx = DB::transaction(function () use ($v, $status, $branchId, $isEmployee, $creatorUserId, $creatorEmployeeId) {
            return Transaction::create([
                'code' => Transaction::nextCode($v['type']),
                'type' => $v['type'],
                'category_id' => $v['category_id'],
                'branch_id' => $branchId,
                'partner_id' => $v['partner_id'] ?? null,
                'amount' => $v['amount'],
                'paid_amount' => $status === 'paid' ? $v['amount'] : 0,
                'paid_at' => $v['paid_at'] ?? now()->toDateString(),
                'occurred_at' => $v['occurred_at'] ?? null, // Gói 57
                'account_id' => $v['account_id'] ?? null, // Gói 57
                'attachment' => $v['attachment'] ?? null, // Gói 57
                'approved_by' => $isEmployee ? null : auth()->id(), // Gói 59
                'approved_at' => $isEmployee ? null : now(), // Gói 59
                'status' => $status,
                'payment_method' => $v['payment_method'] ?? null,
                'note' => $v['note'] ?? null,
                'created_by' => $creatorUserId, // Gói 59 + chặn tự duyệt: phía User (NV tạo = null)
                'created_by_employee_id' => $creatorEmployeeId, // Gói chặn tự duyệt (2026-11-06)
            ]);
        });

        return response()->json(['success' => true, 'data' => $tx->load('category', 'branch', 'partner', 'account')], 201);
    }

    // Sổ #94 (2026-11-05): phân giải tham số {id} của route — tham số route là
    // chuỗi, ép kiểu int mù khiến gọi bằng MÃ PHIẾU nổ TypeError 500 (vật chứng
    // sống 06:26:05 ở pay()). Số → tra theo id (hành vi cũ không đổi); không
    // phải số → tra theo mã phiếu (code). Danh mục không có mã nên không phải
    // số = không thấy. Không thấy ở cả hai → nơi gọi trả 404 JSON.
    protected function resolveTransaction($id): ?Transaction
    {
        return is_numeric($id)
            ? Transaction::find((int) $id)
            : Transaction::where('code', (string) $id)->first();
    }

    protected function resolveCategory($id): ?TransactionCategory
    {
        return is_numeric($id) ? TransactionCategory::find((int) $id) : null;
    }

    public function update(Request $request, $id): JsonResponse
    {
        $tx = $this->resolveTransaction($id);
        if (!$tx) return response()->json(['success' => false, 'message' => 'Không tìm thấy phiếu.'], 404);
        if ($deny = $this->denyTransactionBranch($request, $tx->branch_id)) return $deny;

        // Gói "Chờ duyệt trên Hub" (2026-10-21): phiếu đã từ chối là hồ sơ đóng — không sửa.
        if ($tx->rejected_at !== null) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã bị từ chối, không thể sửa. Hãy tạo phiếu mới.'], 422);
        }

        // Remedy NV-G5 (2026-11-06): phiếu đang còn nợ (status = 'pending', mọi
        // phiếu nợ — có hay không đối tác) chỉ đổi trạng thái qua Ghi thanh toán
        // (pay()); form Sửa không được lật 'paid'/'cancelled', bịt đường vòng
        // nhánh đồng bộ bên dưới gán paid_amount = amount ghi khống, 0 payment.
        if ($tx->status === 'pending' && $request->filled('status') && $request->input('status') !== 'pending') {
            return response()->json(['success' => false, 'message' => 'Phiếu đang còn nợ — trạng thái chỉ thay đổi khi ghi thanh toán qua chức năng Ghi thanh toán. Form Sửa không được chuyển trạng thái phiếu nợ.'], 422);
        }

        // Gói 27: phiếu tự sinh chỉ cho sửa ghi chú.
        // Gói 29: phiếu đã có thanh toán trừ dần cũng chỉ cho sửa ghi chú (giữ toàn vẹn công nợ).
        if ($tx->isAuto() || $tx->payments()->exists()) {
            $v = $request->validate(['note' => 'nullable|string|max:500']);
            $tx->update(['note' => $v['note'] ?? null]);
            return response()->json(['success' => true, 'data' => $tx->fresh()->load('category', 'branch', 'partner')]);
        }

        $v = $request->validate([
            'category_id' => 'sometimes|exists:transaction_categories,id',
            'branch_id' => 'nullable|exists:branches,id',
            'partner_id' => 'nullable|exists:partners,id', // Gói 29
            'amount' => 'sometimes|numeric|min:1',
            'paid_at' => 'nullable|date',
            'occurred_at' => 'nullable|date', // Gói 57
            'account_id' => 'nullable|exists:accounts,id', // Gói 57
            'attachment' => 'nullable|string|max:255', // Gói 57
            'status' => 'nullable|in:paid,pending,cancelled', // Spec P4-B2: phiếu lương tự sinh chuyển sang hủy khi mở khóa
            'payment_method' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
        ]);

        if (isset($v['category_id'])) {
            $cat = TransactionCategory::findOrFail($v['category_id']);
            if ($cat->type !== $tx->type) {
                return response()->json(['success' => false, 'message' => 'Danh mục không khớp loại phiếu (thu/chi).'], 422);
            }
        }

        // Gói 29: đồng bộ paid_amount khi đổi trạng thái/số tiền.
        if (isset($v['status']) && $v['status'] === 'paid') {
            $v['paid_amount'] = $v['amount'] ?? $tx->amount;
        } elseif (isset($v['amount']) && $tx->status === 'paid') {
            $v['paid_amount'] = $v['amount'];
        }

        $tx->update($v);
        return response()->json(['success' => true, 'data' => $tx->fresh()->load('category', 'branch', 'partner')]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $tx = $this->resolveTransaction($id);
        if (!$tx) return response()->json(['success' => false, 'message' => 'Không tìm thấy phiếu.'], 404);
        if ($deny = $this->denyTransactionBranch($request, $tx->branch_id)) return $deny;
        // Gói 27: phiếu tự sinh giữ lại để đối soát với kho — không cho xóa.
        if ($tx->isAuto()) {
            return response()->json([
                'success' => false,
                'message' => 'Phiếu tự động từ nhập kho không được xóa. Muốn điều chỉnh, hãy xử lý phiếu nhập kho gốc.',
            ], 422);
        }
        // Gói 29: phiếu đã có thanh toán trừ dần — không cho xóa để giữ lịch sử công nợ.
        if ($tx->payments()->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Phiếu đã có lịch sử thanh toán, không được xóa.',
            ], 422);
        }
        $tx->delete();
        return response()->json(['success' => true]);
    }

    /**
     * Gói 29: thanh toán trừ dần công nợ 1 phiếu.
     * Validate amount <= còn nợ; cộng paid_amount; đủ -> status = paid.
     */
    public function pay(Request $request, $id): JsonResponse
    {
        $tx = $this->resolveTransaction($id);
        if (!$tx) return response()->json(['success' => false, 'message' => 'Không tìm thấy phiếu.'], 404);
        if ($deny = $this->denyTransactionBranch($request, $tx->branch_id)) return $deny;
        // Gói "Chờ duyệt trên Hub" (2026-10-21): phiếu đã từ chối không được thanh toán tiếp.
        if ($tx->rejected_at !== null) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã bị từ chối, không thể thanh toán.'], 422);
        }
        $remaining = $tx->remaining();
        if ($remaining <= 0) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã thanh toán đủ, còn nợ 0đ.'], 422);
        }

        $v = $request->validate([
            'amount' => 'required|numeric|min:1|max:' . $remaining,
            'paid_at' => 'nullable|date',
            'payment_method' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
        ]);

        // Sổ #76 (2026-11-04, cùng họ #75): created_by của transaction_payments
        // là FK users — phiên NV ghi thanh toán mà lấy auth()->id() sẽ 1452.
        // Bảng không có cột created_by_employee_id nên NV → null.
        [$payUserId, $payEmployeeId] = \App\Support\ApprovalActor::ids($request->user());
        if ($payUserId === null && $payEmployeeId === null) {
            $payUserId = auth()->id();
        }
        $payment = DB::transaction(function () use ($tx, $v, $payUserId) {
            $p = TransactionPayment::create([
                'transaction_id' => $tx->id,
                'amount' => $v['amount'],
                'paid_at' => $v['paid_at'] ?? now()->toDateString(),
                'payment_method' => $v['payment_method'] ?? null,
                'note' => $v['note'] ?? null,
                'created_by' => $payUserId,
            ]);
            $tx->increment('paid_amount', $v['amount']);
            $tx->refresh();
            if ((float) $tx->paid_amount >= (float) $tx->amount) {
                $tx->update(['status' => 'paid']);
            }
            return $p;
        });

        $fresh = $tx->fresh()->load('category', 'branch', 'partner');
        return response()->json(['success' => true, 'data' => [
            'payment' => $payment,
            'transaction' => $fresh,
            'remaining' => $fresh->remaining(),
        ]]);
    }

    // Gói 59: quản lý duyệt phiếu do NV tạo (route permission:finance.transactions.approve).
    // Gói "Chờ duyệt trên Hub" (2026-10-21): ghi vết Employee qua ApprovalActor; chặn cả phiếu đã từ chối.
    public function approve(Request $request, $id): JsonResponse
    {
        $tx = $this->resolveTransaction($id);
        if (!$tx) return response()->json(['success' => false, 'message' => 'Không tìm thấy phiếu.'], 404);
        if ($deny = $this->denyTransactionBranch($request, $tx->branch_id)) return $deny;
        if ($tx->approved_by !== null || $tx->approved_by_employee_id !== null || $tx->rejected_at !== null) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã được xử lý (duyệt/từ chối) trước đó.'], 422);
        }
        // Gói chặn tự duyệt (2026-11-06): người tạo không được tự duyệt phiếu của mình.
        if ($deny = \App\Support\SelfApprovalGuard::check($tx, $tx->created_by, $tx->created_by_employee_id, $request, 'transaction', 'approve')) return $deny;
        // Sổ #75 (2026-11-04): truyền $request->user() — ids() không đối số mù
        // với phiên NV duyệt trực tiếp, fallback sẽ ghi mã NV vào FK users.
        [$uid, $eid] = \App\Support\ApprovalActor::ids($request->user());
        if ($uid === null && $eid === null) {
            $uid = auth()->id(); // luồng Admin cũ
        }
        $tx->update(['approved_by' => $uid, 'approved_by_employee_id' => $eid, 'approved_at' => now()]);
        $d = $tx->fresh()->toArray();
        $d['is_approved'] = true;
        return response()->json(['success' => true, 'data' => $d]);
    }

    /**
     * Gói "Chờ duyệt trên Hub" (2026-10-21, ĐÃ CHỐT — mục 4.3 spec): từ chối phiếu thu/chi.
     * Dùng chung cho Admin (route permission:finance.transactions.approve) và Hub (EmployeeApprovalController gọi lại).
     * Lý do BẮT BUỘC (trim không rỗng, tối đa 500 ký tự). Phiếu bị từ chối = hồ sơ đóng (terminal):
     * không sửa, không gửi lại, không duyệt lại — muốn xử lý lại thì tạo phiếu mới.
     */
    public function reject(Request $request, $id): JsonResponse
    {
        $v = $request->validate([
            'reason' => 'required|string|max:500',
        ]);
        $reason = trim($v['reason']);
        if ($reason === '') {
            return response()->json(['success' => false, 'message' => 'Lý do từ chối không được để trống.'], 422);
        }
        $tx = $this->resolveTransaction($id);
        if (!$tx) return response()->json(['success' => false, 'message' => 'Không tìm thấy phiếu.'], 404);
        if ($deny = $this->denyTransactionBranch($request, $tx->branch_id)) return $deny;
        if ($tx->approved_by !== null || $tx->approved_by_employee_id !== null || $tx->rejected_at !== null) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã được xử lý (duyệt/từ chối) trước đó.'], 422);
        }
        // Gói chặn tự duyệt (2026-11-06): người tạo không được tự từ chối phiếu của mình.
        if ($deny = \App\Support\SelfApprovalGuard::check($tx, $tx->created_by, $tx->created_by_employee_id, $request, 'transaction', 'reject')) return $deny;
        // Sổ #75 (2026-11-04): truyền $request->user() như ở approve().
        [$uid, $eid] = \App\Support\ApprovalActor::ids($request->user());
        if ($uid === null && $eid === null) {
            $uid = auth()->id(); // luồng Admin cũ
        }
        $tx->update([
            // F4 (Đại Vương phán 2026-11-05 "Hiển thị đã hủy"): phiếu bị từ chối
            // duyệt thì TRẠNG THÁI cũng chuyển 'cancelled' — dấu từ chối
            // (rejected_at/reason/by) giữ nguyên làm vết duyệt. Mọi bề mặt tiền
            // vốn lọc (status='paid' + rejected_at null) nên số không đổi;
            // bề mặt hiển thị đọc status sẽ thấy "Đã hủy" như phán.
            'status' => 'cancelled',
            'rejected_at' => now(),
            'reject_reason' => $reason,
            'rejected_by' => $uid,
            'rejected_by_employee_id' => $eid,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã từ chối phiếu ' . $tx->code . '.']);
    }

    /** Sửa danh mục (tên; loại không cho đổi nếu đã có phiếu). */
    public function updateCategory(Request $request, $id): JsonResponse
    {
        $cat = $this->resolveCategory($id);
        if (!$cat) return response()->json(['success' => false, 'message' => 'Không tìm thấy danh mục.'], 404);
        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'type' => 'sometimes|in:income,expense',
        ]);
        if (isset($v['type']) && $v['type'] !== $cat->type && $cat->transactions()->exists()) {
            return response()->json(['success' => false, 'message' => 'Danh mục đã có phiếu, không được đổi loại thu/chi.'], 422);
        }
        // Tránh trùng tên cùng loại.
        if (isset($v['name'])) {
            $dup = TransactionCategory::where('name', $v['name'])
                ->where('type', $v['type'] ?? $cat->type)
                ->where('id', '!=', $cat->id)->exists();
            if ($dup) {
                return response()->json(['success' => false, 'message' => 'Tên danh mục đã tồn tại.'], 422);
            }
        }
        $cat->update($v);
        return response()->json(['success' => true, 'data' => $cat->fresh()]);
    }

    /** Xóa danh mục (chặn danh mục hệ thống và danh mục đang có phiếu). */
    public function destroyCategory($id): JsonResponse
    {
        $cat = $this->resolveCategory($id);
        if (!$cat) return response()->json(['success' => false, 'message' => 'Không tìm thấy danh mục.'], 404);
        if ($cat->is_system) {
            return response()->json(['success' => false, 'message' => 'Danh mục hệ thống không được xóa.'], 422);
        }
        if ($cat->transactions()->exists()) {
            return response()->json(['success' => false, 'message' => 'Danh mục đang có phiếu, không được xóa.'], 422);
        }
        $cat->delete();
        return response()->json(['success' => true]);
    }

    /** Thêm danh mục mới. */
    public function storeCategory(Request $request): JsonResponse
    {
        $v = $request->validate([
            'name' => 'required|string|max:100',
            'type' => 'required|in:income,expense',
        ]);
        $cat = TransactionCategory::firstOrCreate(
            ['name' => $v['name'], 'type' => $v['type']],
            ['is_system' => false]
        );
        return response()->json(['success' => true, 'data' => $cat], 201);
    }
}
