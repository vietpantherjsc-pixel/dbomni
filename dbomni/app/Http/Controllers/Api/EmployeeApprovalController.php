<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\InboundReceipt;
use App\Models\LeaveRequest;
use App\Models\OutboundReceipt;
use App\Models\ShiftRegistration;
use App\Models\StocktakeAdjustment;
use App\Models\StockTransfer;
use App\Models\Transaction;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\ApprovalActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

// Gói "Chờ duyệt trên Hub" (2026-10-21, spec ĐÃ CHỐT): cụm Chờ duyệt cho quản lý trực ca.
// 1 controller duy nhất — ánh xạ type → [khóa quyền, model, method duyệt/từ chối] bằng bảng
// cấu hình; nghiệp vụ dùng lại 100% method hiện có của controller Admin (không viết lại).
// Ghi vết người xử lý là Employee thật qua ApprovalActor (cột *_employee_id).
class EmployeeApprovalController extends Controller
{
    public const TYPES = [
        'inbound' => ['permission' => 'inventory.manage', 'model' => InboundReceipt::class, 'label' => 'Phiếu nhập kho', 'icon' => '📥'],
        'outbound' => ['permission' => 'inventory.manage', 'model' => OutboundReceipt::class, 'label' => 'Phiếu xuất kho', 'icon' => '📤'],
        'transfer' => ['permission' => 'inventory.manage', 'model' => StockTransfer::class, 'label' => 'Phiếu chuyển kho', 'icon' => '🔄'],
        'stocktake_adjustment' => ['permission' => 'inventory.manage', 'model' => StocktakeAdjustment::class, 'label' => 'Điều chỉnh kiểm kê', 'icon' => '📋'],
        'transaction' => ['permission' => 'finance.manage', 'model' => Transaction::class, 'label' => 'Phiếu thu/chi', 'icon' => '🧾'],
        'shift_registration' => ['permission' => 'staff.edit', 'model' => ShiftRegistration::class, 'label' => 'Đăng ký ca', 'icon' => '📅'],
        'leave_request' => ['permission' => 'staff.edit', 'model' => LeaveRequest::class, 'label' => 'Xin nghỉ phép', 'icon' => '🏖️'],
    ];

    /** Nhãn nút hành động "từ chối" theo loại (nhóm kho = Hủy phiếu — mục 4.1 spec). */
    public const REJECT_LABEL = [
        'inbound' => 'Hủy phiếu',
        'outbound' => 'Hủy phiếu',
        'transfer' => 'Hủy phiếu',
        'stocktake_adjustment' => 'Từ chối',
        'transaction' => 'Từ chối',
        'shift_registration' => 'Từ chối',
        'leave_request' => 'Từ chối',
    ];

    private function employee(Request $request): Employee
    {
        $u = $request->user();
        abort_unless($u instanceof Employee, 403, 'Chỉ nhân viên mới dùng chức năng này.');
        return $u;
    }

    private function typeConfig(string $type): array
    {
        abort_unless(isset(self::TYPES[$type]), 404, 'Loại phiếu không hợp lệ.');
        return self::TYPES[$type];
    }

    /** Các loại NV được quyền duyệt (User = tất cả; Employee = theo ma trận quyền — mirror CheckPermission). */
    public function visibleTypes(Employee $emp): array
    {
        $out = [];
        foreach (self::TYPES as $type => $cfg) {
            if ($emp instanceof User) {
                $out[$type] = $cfg;
                continue;
            }
            $role = $emp->role;
            if ($role && $role->hasPermission($cfg['permission'])) {
                $out[$type] = $cfg;
            }
        }
        return $out;
    }

    /** Chi nhánh đang chọn phải thuộc danh sách CN của NV — ngoài danh sách → 403. */
    private function branchId(Request $request, Employee $emp): int
    {
        $bid = (int) $request->input('branch_id', $request->query('branch_id', 0));
        abort_unless($bid > 0 && in_array($bid, $emp->allBranchIds(), true), 403, 'Chi nhánh không thuộc phạm vi của bạn.');
        return $bid;
    }

    /** Query gốc theo chi nhánh (chưa lọc trạng thái) — dùng chung cho chờ duyệt và đã xử lý. */
    private function branchScope(string $type, int $branchId)
    {
        return match ($type) {
            'inbound' => InboundReceipt::where('branch_id', $branchId),
            'outbound' => OutboundReceipt::where('branch_id', $branchId),
            'transfer' => StockTransfer::where(fn ($q) => $q->where('from_branch_id', $branchId)->orWhere('to_branch_id', $branchId)),
            'stocktake_adjustment' => StocktakeAdjustment::where('branch_id', $branchId),
            'transaction' => Transaction::where('branch_id', $branchId),
            'shift_registration' => ShiftRegistration::whereHas('employee', fn ($q) => $q->where('branch_id', $branchId)),
            'leave_request' => LeaveRequest::whereHas('employee', fn ($q) => $q->where('branch_id', $branchId)),
        };
    }

    /** Điều kiện "đang chờ duyệt" của từng loại (khớp đúng Admin). */
    private function applyPending(string $type, $q)
    {
        return match ($type) {
            'inbound' => $q->where('status', 'draft'),
            'outbound' => $q->where('status', 'draft'),
            'transfer' => $q->where('status', 'draft'),
            'stocktake_adjustment' => $q->where('status', 'pending'),
            // Điều kiện chờ của thu/chi = đủ 3 cột (mục 4.3 spec)
            'transaction' => $q->whereNull('approved_by')->whereNull('approved_by_employee_id')->whereNull('rejected_at'),
            'shift_registration' => $q->where('status', 'submitted'),
            'leave_request' => $q->where('status', 'pending'),
        };
    }

    /** Query "đang chờ duyệt" của từng loại tại 1 chi nhánh (điều kiện khớp đúng Admin). */
    private function pendingQuery(string $type, int $branchId)
    {
        return $this->applyPending($type, $this->branchScope($type, $branchId));
    }

    /** Cột ghi vết Employee xử lý của từng loại (cho màn "Đã xử lý hôm nay"). */
    private function handlerColumn(string $type): array
    {
        return match ($type) {
            'inbound' => ['approved_by_employee_id', 'cancelled_by_employee_id'],
            'outbound' => ['confirmed_by_employee_id', 'cancelled_by_employee_id'],
            'transfer' => ['confirmed_by_employee_id', 'cancelled_by_employee_id'],
            'stocktake_adjustment' => ['approved_by_employee_id'],
            'transaction' => ['approved_by_employee_id', 'rejected_by_employee_id'],
            'shift_registration' => ['handled_by_employee_id'],
            'leave_request' => ['handled_by_employee_id'],
        };
    }

    /** Phiếu NV này đã xử lý (duyệt/từ chối) — cho màn "Đã xử lý hôm nay" và xem chi tiết. */
    private function handledQuery(string $type, int $branchId, Employee $emp)
    {
        $q = $this->branchScope($type, $branchId);
        $cols = $this->handlerColumn($type);
        return $q->where(fn ($w) => collect($cols)->each(fn ($c) => $w->orWhere($c, $emp->id)));
    }

    /** GET /employee/approvals/counts — số chờ theo từng loại NV có quyền + tổng. */
    public function counts(Request $request): JsonResponse
    {
        $emp = $this->employee($request);
        $bid = $this->branchId($request, $emp);
        $types = [];
        $total = 0;
        foreach ($this->visibleTypes($emp) as $type => $cfg) {
            $q = $this->pendingQuery($type, $bid);
            $count = (clone $q)->count();
            $oldest = $count > 0 ? (clone $q)->orderBy('created_at')->value('created_at') : null;
            $types[$type] = [
                'label' => $cfg['label'],
                'icon' => $cfg['icon'],
                'reject_label' => self::REJECT_LABEL[$type],
                'count' => $count,
                'oldest_at' => $oldest,
            ];
            $total += $count;
        }
        return response()->json(['success' => true, 'data' => ['types' => $types, 'total' => $total]]);
    }

    /** Tóm tắt 1 dòng cho thẻ danh sách (mục 6.2 spec). */
    private function summarize(string $type, $m): array
    {
        return match ($type) {
            'inbound' => [
                'title' => $m->code,
                'meta' => $m->items_count . ' dòng hàng · ' . number_format((float) $m->grand_total) . 'đ',
                'creator' => $this->creatorName($m),
            ],
            'outbound' => [
                'title' => $m->code,
                'meta' => $m->items_count . ' dòng · Lý do: ' . ($m->reason_label ?? $m->reason),
                'creator' => $this->creatorName($m),
            ],
            'transfer' => [
                'title' => $m->code,
                'meta' => $m->items_count . ' dòng · ' . ($m->fromBranch?->name ?? '') . ' → ' . ($m->toBranch?->name ?? ''),
                'creator' => $this->creatorName($m),
            ],
            'stocktake_adjustment' => [
                'title' => ($m->material?->name ?? 'Nguyên liệu #' . $m->material_id),
                'meta' => 'Chênh lệch: ' . ($m->diff_qty >= 0 ? '+' : '') . $m->diff_qty . ' ' . ($m->material?->unit ?? ''),
                'creator' => $this->creatorName($m),
            ],
            'transaction' => [
                'title' => $m->code,
                'meta' => ($m->type === 'income' ? 'Thu' : 'Chi') . ' · ' . number_format((float) $m->amount) . 'đ · ' . ($m->category?->name ?? ''),
                'creator' => $this->creatorName($m),
            ],
            'shift_registration' => [
                'title' => $m->employee?->full_name ?? ('NV #' . $m->employee_id),
                'meta' => ($m->workShift?->name ?? 'Ca') . ' · ' . $m->date,
                'creator' => null,
            ],
            'leave_request' => [
                'title' => $m->employee?->full_name ?? ('NV #' . $m->employee_id),
                'meta' => $this->leaveTypeLabel($m->type) . ' · ' . $m->date_from . ($m->date_to ? ' → ' . $m->date_to : ''),
                'creator' => null,
            ],
        };
    }

    private function creatorName($m): ?string
    {
        if (isset($m->createdByEmployee) && $m->createdByEmployee) return $m->createdByEmployee->full_name;
        if (isset($m->createdByUser) && $m->createdByUser) return $m->createdByUser->name;
        if (isset($m->employee) && $m->employee) return $m->employee->full_name;
        if (isset($m->requestedBy) && $m->requestedBy) return $m->requestedBy->full_name;
        return null;
    }

    /** GET /employee/approvals/{type} — danh sách chờ, cũ nhất trước, 20/trang. */
    public function index(Request $request, string $type): JsonResponse
    {
        $this->typeConfig($type);
        $emp = $this->employee($request);
        $bid = $this->branchId($request, $emp);
        $with = match ($type) {
            'inbound' => ['items', 'partner:id,name', 'createdByEmployee:id,full_name', 'createdByUser:id,name'],
            'outbound' => ['items', 'employee:id,full_name'],
            'transfer' => ['items', 'fromBranch:id,name', 'toBranch:id,name', 'createdByEmployee:id,full_name', 'createdByUser:id,name'],
            'stocktake_adjustment' => ['material:id,name,unit', 'requestedBy:id,full_name'],
            'transaction' => ['category:id,name', 'creator:id,name'],
            'shift_registration' => ['employee:id,full_name', 'workShift:id,name'],
            'leave_request' => ['employee:id,full_name'],
        };
        $withCounts = in_array($type, ['inbound', 'outbound', 'transfer'], true) ? ['items as items_count'] : [];
        $page = $this->pendingQuery($type, $bid)->with($with)->withCount($withCounts)
            ->orderBy('created_at')->orderBy('id')
            ->paginate(20);
        $items = collect($page->items())->map(fn ($m) => array_merge(
            ['id' => $m->id, 'created_at' => $m->created_at],
            $this->summarize($type, $m)
        ))->values();
        return response()->json(['success' => true, 'data' => $items, 'pagination' => [
            'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(),
        ]]);
    }

    /** Nhãn loại nghỉ phép (cột type: nghi|doica|khac). */
    private function leaveTypeLabel(?string $type): string
    {
        return match ($type) {
            'doica' => 'Đổi ca',
            'khac' => 'Nghỉ khác',
            default => 'Nghỉ phép',
        };
    }

    /** Tên chi nhánh của phiếu (dòng nhắc trong hộp xác nhận — mục 4.4 spec). */
    private function branchNames(string $type, $m): array
    {
        return match ($type) {
            'transfer' => [($m->fromBranch?->name ?? ''), ($m->toBranch?->name ?? '')],
            'shift_registration', 'leave_request' => [($m->employee?->branch?->name ?? '')],
            default => [($m->branch?->name ?? '')],
        };
    }

    /** GET /employee/approvals/{type}/{id} — chi tiết phiếu + tên CN của phiếu. */
    public function show(Request $request, string $type, int $id): JsonResponse
    {
        $this->typeConfig($type);
        $emp = $this->employee($request);
        $bid = $this->branchId($request, $emp);
        $m = $this->pendingQuery($type, $bid)->find($id);
        $canAct = $m !== null;
        if (!$m) {
            // Phiếu NV này đã xử lý (màn "Đã xử lý hôm nay") → cho xem chi tiết, không hành động
            $m = $this->handledQuery($type, $bid, $emp)->find($id);
        }
        abort_unless($m, 404, 'Phiếu không tồn tại hoặc không thuộc chi nhánh này.');
        $with = match ($type) {
            'inbound' => ['items.material:id,name,unit', 'partner:id,name', 'branch:id,name', 'createdByEmployee:id,full_name', 'createdByUser:id,name'],
            'outbound' => ['items.material:id,name,unit', 'branch:id,name', 'employee:id,full_name'],
            'transfer' => ['items.material:id,name,unit', 'fromBranch:id,name', 'toBranch:id,name', 'createdByEmployee:id,full_name', 'createdByUser:id,name'],
            'stocktake_adjustment' => ['material:id,name,unit', 'branch:id,name', 'requestedBy:id,full_name'],
            'transaction' => ['category:id,name', 'branch:id,name', 'account:id,name', 'partner:id,name', 'creator:id,name'],
            'shift_registration' => ['employee:id,full_name,branch_id', 'employee.branch:id,name', 'workShift'],
            'leave_request' => ['employee:id,full_name,branch_id', 'employee.branch:id,name'],
        };
        $m->load($with);
        return response()->json(['success' => true, 'data' => [
            'record' => $m,
            'branch_names' => $this->branchNames($type, $m),
            'reject_label' => self::REJECT_LABEL[$type],
            'can_act' => $canAct,
        ]]);
    }

    /** Kiểm approval_token (mục 5b spec) — thiếu/hết hạn/sai NV → 403 mã PIN_REQUIRED. */
    private function checkApprovalToken(Request $request, Employee $emp): ?JsonResponse
    {
        $token = (string) $request->input('approval_token', '');
        $valid = $token !== '' && hash_equals((string) Cache::get('approval_token:' . $emp->id), $token);
        if (!$valid) {
            return response()->json([
                'success' => false, 'code' => 'PIN_REQUIRED',
                'message' => 'Vui lòng nhập lại mã PIN để xác nhận hành động này.',
            ], 403);
        }
        return null;
    }

    private function delegate(string $type, string $action, Request $request, int $id): JsonResponse
    {
        ApprovalActor::set($this->employee($request));
        try {
            return match ([$type, $action]) {
                ['inbound', 'approve'] => app(InboundReceiptController::class)->approve($id),
                ['inbound', 'reject'] => app(InboundReceiptController::class)->cancel($id),
                ['outbound', 'approve'] => app(OutboundController::class)->confirm($request, $id),
                ['outbound', 'reject'] => app(OutboundController::class)->cancel($id),
                ['transfer', 'approve'] => app(StockTransferController::class)->confirm($id, $request, app(InventoryService::class)),
                ['transfer', 'reject'] => app(StockTransferController::class)->cancel($id),
                ['stocktake_adjustment', 'approve'] => app(StocktakeAdjustmentController::class)->approve($request, $id),
                ['stocktake_adjustment', 'reject'] => app(StocktakeAdjustmentController::class)->reject($request, $id),
                ['transaction', 'approve'] => app(TransactionController::class)->approve($id),
                ['transaction', 'reject'] => app(TransactionController::class)->reject($request, $id),
                ['shift_registration', 'approve'] => app(ShiftRegistrationController::class)->approve($request, $id),
                ['shift_registration', 'reject'] => app(ShiftRegistrationController::class)->reject($request, $id),
                ['leave_request', 'approve'] => app(LeaveRequestController::class)->approve($request, $id),
                ['leave_request', 'reject'] => app(LeaveRequestController::class)->reject($request, $id),
                default => abort(404, 'Loại phiếu không hợp lệ.'),
            };
        } finally {
            ApprovalActor::clear();
        }
    }

    /** POST /employee/approvals/{type}/{id}/approve */
    public function approve(Request $request, string $type, int $id): JsonResponse
    {
        $this->typeConfig($type);
        $emp = $this->employee($request);
        $bid = $this->branchId($request, $emp);
        if ($err = $this->checkApprovalToken($request, $emp)) return $err;
        // Phiếu phải còn chờ tại CN này (chống duyệt trùng/khác CN)
        if (!$this->pendingQuery($type, $bid)->where('id', $id)->exists()) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã được xử lý hoặc không thuộc chi nhánh này.'], 422);
        }
        return $this->delegate($type, 'approve', $request, $id);
    }

    /** POST /employee/approvals/{type}/{id}/reject — note/reason tùy loại (mục 4 spec). */
    public function reject(Request $request, string $type, int $id): JsonResponse
    {
        $this->typeConfig($type);
        $emp = $this->employee($request);
        $bid = $this->branchId($request, $emp);
        if ($err = $this->checkApprovalToken($request, $emp)) return $err;
        if (!$this->pendingQuery($type, $bid)->where('id', $id)->exists()) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã được xử lý hoặc không thuộc chi nhánh này.'], 422);
        }
        // Nhóm kho: hủy phiếu (không lý do — backend cancel không nhận). KK/ca: note tùy chọn.
        // Thu/chi: reason BẮT BUỘC (validate trong TransactionController::reject). Xin nghỉ: không lý do.
        if (in_array($type, ['stocktake_adjustment', 'shift_registration'], true)) {
            $request->merge(['note' => $request->input('reason')]);
        }
        return $this->delegate($type, 'reject', $request, $id);
    }

    /** GET /employee/approvals/processed-today — phiếu chính NV này đã xử lý hôm nay (mục 5c, chỉ xem). */
    public function processedToday(Request $request): JsonResponse
    {
        $emp = $this->employee($request);
        $bid = $this->branchId($request, $emp);
        $today = now()->toDateString();
        $items = [];
        $push = function (string $type, $q, callable $fmt) use (&$items, $today) {
            foreach ($q->whereDate('updated_at', $today)->orderByDesc('updated_at')->limit(50)->get() as $m) {
                $items[] = array_merge(['type' => $type, 'action_at' => $m->updated_at], $fmt($m));
            }
        };
        if (isset($this->visibleTypes($emp)['inbound'])) {
            $push('inbound', InboundReceipt::where('branch_id', $bid)
                ->where(fn ($q) => $q->where('approved_by_employee_id', $emp->id)->orWhere('cancelled_by_employee_id', $emp->id)),
                fn ($m) => ['id' => $m->id, 'title' => $m->code, 'result' => $m->status === 'cancelled' ? 'cancelled' : 'approved', 'meta' => number_format((float) $m->grand_total) . 'đ']);
        }
        if (isset($this->visibleTypes($emp)['outbound'])) {
            $push('outbound', OutboundReceipt::where('branch_id', $bid)
                ->where(fn ($q) => $q->where('confirmed_by_employee_id', $emp->id)->orWhere('cancelled_by_employee_id', $emp->id)),
                fn ($m) => ['id' => $m->id, 'title' => $m->code, 'result' => $m->status === 'cancelled' ? 'cancelled' : 'approved', 'meta' => 'Đã chốt xuất']);
        }
        if (isset($this->visibleTypes($emp)['transfer'])) {
            $push('transfer', StockTransfer::where(fn ($q) => $q->where('confirmed_by_employee_id', $emp->id)->orWhere('cancelled_by_employee_id', $emp->id))
                ->where(fn ($q) => $q->where('from_branch_id', $bid)->orWhere('to_branch_id', $bid)),
                fn ($m) => ['id' => $m->id, 'title' => $m->code, 'result' => $m->status === 'cancelled' ? 'cancelled' : 'approved', 'meta' => 'Đã xác nhận chuyển']);
        }
        if (isset($this->visibleTypes($emp)['stocktake_adjustment'])) {
            $push('stocktake_adjustment', StocktakeAdjustment::where('branch_id', $bid)->where('approved_by_employee_id', $emp->id),
                fn ($m) => ['id' => $m->id, 'title' => $m->code ?? ('Điều chỉnh #' . $m->id), 'result' => $m->status === 'approved' ? 'approved' : 'rejected', 'meta' => 'Chênh lệch ' . $m->diff_qty]);
        }
        if (isset($this->visibleTypes($emp)['transaction'])) {
            $push('transaction', Transaction::where('branch_id', $bid)
                ->where(fn ($q) => $q->where('approved_by_employee_id', $emp->id)->orWhere('rejected_by_employee_id', $emp->id)),
                fn ($m) => ['id' => $m->id, 'title' => $m->code, 'result' => $m->rejected_at ? 'rejected' : 'approved', 'meta' => number_format((float) $m->amount) . 'đ']);
        }
        if (isset($this->visibleTypes($emp)['shift_registration'])) {
            $push('shift_registration', ShiftRegistration::where('handled_by_employee_id', $emp->id)
                ->whereHas('employee', fn ($q) => $q->where('branch_id', $bid)),
                fn ($m) => ['id' => $m->id, 'title' => $m->employee?->full_name ?? '', 'result' => $m->status === 'approved' ? 'approved' : 'rejected', 'meta' => (string) $m->date]);
        }
        if (isset($this->visibleTypes($emp)['leave_request'])) {
            $push('leave_request', LeaveRequest::where('handled_by_employee_id', $emp->id)
                ->whereHas('employee', fn ($q) => $q->where('branch_id', $bid)),
                fn ($m) => ['id' => $m->id, 'title' => $m->employee?->full_name ?? '', 'result' => $m->status === 'approved' ? 'approved' : 'rejected', 'meta' => $this->leaveTypeLabel($m->type) . ' ' . $m->date_from]);
        }
        usort($items, fn ($a, $b) => strcmp((string) $b['action_at'], (string) $a['action_at']));
        return response()->json(['success' => true, 'data' => $items]);
    }
}
