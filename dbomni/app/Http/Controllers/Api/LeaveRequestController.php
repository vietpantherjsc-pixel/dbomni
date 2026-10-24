<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 35: Yêu cầu nghỉ / đổi ca — NV tạo, admin duyệt/từ chối.
class LeaveRequestController extends Controller
{
    // NV tạo yêu cầu (chỉ của chính mình)
    public function store(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        // Spec danh mục dùng chung: chuẩn hóa mã cũ 'khac' -> 'other' trước khi validate
        if ($request->input('type') === 'khac') {
            $request->merge(['type' => 'other']);
        }
        $v = $request->validate([
            'type' => ['required', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('leave_types'))],
            'date_from' => 'required|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'reason' => 'nullable|string|max:500',
        ]);
        $lr = LeaveRequest::create($v + ['employee_id' => $emp->id]);
        return response()->json(['success' => true, 'message' => 'Đã gửi yêu cầu, chờ quản lý duyệt.', 'data' => $lr]);
    }

    // NV xem yêu cầu của mình
    public function myList(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $items = LeaveRequest::where('employee_id', $emp->id)->orderBy('created_at', 'desc')->get();
        return response()->json(['success' => true, 'data' => $items]);
    }

    // Admin: danh sách (lọc theo trạng thái)
    public function index(Request $request): JsonResponse
    {
        $q = LeaveRequest::with('employee:id,full_name,branch_id')->orderBy('created_at', 'desc');
        if ($request->filled('status')) $q->where('status', $request->string('status'));
        // Audit 2026-10-23 A1-2: quản lý là Employee chỉ thấy yêu cầu của CN mình
        $actor = $request->user();
        if ($actor instanceof Employee) {
            $q->whereHas('employee', fn ($qq) => $qq->whereIn('branch_id', $actor->allBranchIds()));
        }
        return response()->json(['success' => true, 'data' => $q->get()]);
    }

    // Audit 2026-10-23 A1-2: kiểm phạm vi CN trước khi duyệt/từ chối
    private function denyLeaveBranch(Request $request, LeaveRequest $lr): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof Employee) {
            $empBranch = (int) (Employee::where('id', $lr->employee_id)->value('branch_id') ?? 0);
            if (!in_array($empBranch, $actor->allBranchIds(), true)) {
                return response()->json(['success' => false, 'message' => 'Yêu cầu thuộc chi nhánh bạn không được phân công.'], 403);
            }
        }
        return null;
    }

    public function approve(Request $request, int $id): JsonResponse
    {
        $lr = LeaveRequest::findOrFail($id);
        if ($deny = $this->denyLeaveBranch($request, $lr)) return $deny;
        // Audit 2026-10-23 A1-3: chỉ duyệt yêu cầu đang chờ (trước đây duyệt lại
        // được cả yêu cầu đã từ chối)
        if ($lr->status !== 'pending') {
            return response()->json(['success' => false, 'message' => 'Yêu cầu đã được xử lý trước đó.'], 422);
        }
        // Gói 38: handled_by chỉ set khi người duyệt là User (admin); Employee duyệt thì null (tránh lỗi FK)
        $actor = $request->user();
        // Gói "Chờ duyệt trên Hub" (2026-10-21): Employee duyệt → ghi handled_by_employee_id (tránh lỗi FK users)
        [$handledUserId, $handledEmployeeId] = \App\Support\ApprovalActor::ids($actor);
        $lr->update(['status' => 'approved', 'handled_by' => $handledUserId, 'handled_by_employee_id' => $handledEmployeeId]);
        // Audit 2026-10-23 A1-9: đồng bộ với cơ chế nghỉ theo ca — duyệt nghỉ
        // thì gỡ lịch đã xếp trong khoảng ngày nghỉ (trước đây lịch vẫn còn,
        // 2 cơ chế cho kết quả khác nhau trên cùng 1 ngày nghỉ).
        $from = $lr->date_from->toDateString();
        $to = $lr->date_to ? $lr->date_to->toDateString() : $from;
        \App\Models\WorkSchedule::where('employee_id', $lr->employee_id)
            ->whereBetween('date', [$from, $to])->delete();
        return response()->json(['success' => true, 'message' => 'Đã duyệt yêu cầu.']);
    }

    public function reject(Request $request, int $id): JsonResponse
    {
        $lr = LeaveRequest::findOrFail($id);
        if ($deny = $this->denyLeaveBranch($request, $lr)) return $deny;
        // Audit 2026-10-23 A1-3: chỉ từ chối yêu cầu đang chờ
        if ($lr->status !== 'pending') {
            return response()->json(['success' => false, 'message' => 'Yêu cầu đã được xử lý trước đó.'], 422);
        }
        // Gói 38: handled_by chỉ set khi người duyệt là User (admin); Employee duyệt thì null (tránh lỗi FK)
        $actor = $request->user();
        // Gói "Chờ duyệt trên Hub" (2026-10-21): Employee từ chối → ghi handled_by_employee_id
        [$handledUserId, $handledEmployeeId] = \App\Support\ApprovalActor::ids($actor);
        $lr->update(['status' => 'rejected', 'handled_by' => $handledUserId, 'handled_by_employee_id' => $handledEmployeeId]);
        return response()->json(['success' => true, 'message' => 'Đã từ chối yêu cầu.']);
    }
}
