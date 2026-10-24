<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\ShiftSwapRequest;
use App\Models\WorkSchedule;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Spec P4-B5 (Đại Vương chốt 2026-10-19): đổi ca thật giữa 2 NV.
// Luồng: A tạo yêu cầu (chọn ca mình + ca của B) → B xác nhận (qua hub) → quản lý duyệt → hoán đổi.
// Từ chối ở bước nào cũng dừng + thông báo.
class ShiftSwapController extends Controller
{
    // NV A: xem ca của đồng nghiệp trong 1 ngày để chọn đổi
    public function colleagues(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate(['date' => 'required|date|after_or_equal:today']);
        // Audit 2026-10-23 A1-14: chỉ liệt kê ca của NV cùng CN với mình
        $myBranches = $emp->allBranchIds();
        $scheds = WorkSchedule::with(['employee:id,full_name', 'workShift:id,name,start_time,end_time'])
            ->where('date', $v['date'])
            ->where('employee_id', '!=', $emp->id)
            ->where(fn ($q) => $q->whereIn('branch_id', $myBranches)
                ->orWhereHas('employee', fn ($e) => $e->whereIn('branch_id', $myBranches)))
            ->get()
            ->map(fn ($s) => [
                'work_schedule_id' => $s->id,
                'employee_id' => $s->employee_id,
                'employee_name' => $s->employee?->full_name,
                'shift_name' => $s->workShift?->name,
                'start_time' => $s->workShift?->start_time ? substr((string) $s->workShift->start_time, 0, 5) : null,
                'end_time' => $s->workShift?->end_time ? substr((string) $s->workShift->end_time, 0, 5) : null,
            ]);
        return response()->json(['success' => true, 'data' => $scheds]);
    }

    // NV A: tạo yêu cầu đổi ca
    public function store(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'requester_schedule_id' => 'required|exists:work_schedules,id',
            'target_employee_id' => 'required|exists:employees,id|different:' . $emp->id,
            'target_schedule_id' => 'required|exists:work_schedules,id',
        ]);

        $mySched = WorkSchedule::findOrFail($v['requester_schedule_id']);
        $theirSched = WorkSchedule::findOrFail($v['target_schedule_id']);
        if ($mySched->employee_id !== $emp->id) {
            return response()->json(['success' => false, 'message' => 'Ca của bạn không hợp lệ.'], 422);
        }
        if ($theirSched->employee_id != $v['target_employee_id']) {
            return response()->json(['success' => false, 'message' => 'Ca của NV kia không hợp lệ.'], 422);
        }
        if ($mySched->date->toDateString() < Carbon::today()->toDateString()
            || $theirSched->date->toDateString() < Carbon::today()->toDateString()) {
            return response()->json(['success' => false, 'message' => 'Chỉ đổi ca từ hôm nay trở đi.'], 422);
        }

        // Audit 2026-10-23 A1-4: chặn yêu cầu trùng đang chờ cho cùng cặp ca
        $dup = ShiftSwapRequest::where('requester_schedule_id', $mySched->id)
            ->where('target_schedule_id', $theirSched->id)
            ->whereIn('status', ['pending', 'target_confirmed'])->exists();
        if ($dup) {
            return response()->json(['success' => false, 'message' => 'Đã có yêu cầu đổi ca đang chờ cho cặp ca này.'], 422);
        }

        $req = ShiftSwapRequest::create([
            'requester_id' => $emp->id,
            'target_id' => $v['target_employee_id'],
            'requester_schedule_id' => $mySched->id,
            'target_schedule_id' => $theirSched->id,
            'status' => 'pending',
        ]);
        return response()->json(['success' => true, 'data' => $req,
            'message' => 'Đã gửi yêu cầu đổi ca. Chờ NV kia xác nhận.'], 201);
    }

    // NV B: danh sách yêu cầu chờ mình xác nhận
    public function pendingForMe(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $rows = ShiftSwapRequest::with(['requester:id,full_name', 'requesterSchedule.workShift:id,name,start_time,end_time', 'targetSchedule.workShift:id,name,start_time,end_time'])
            ->where('target_id', $emp->id)->where('status', 'pending')
            ->orderBy('id', 'desc')->get();
        return response()->json(['success' => true, 'data' => $rows]);
    }

    // NV B: xác nhận / từ chối
    public function confirm(Request $request, int $id): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate(['accept' => 'required|boolean', 'reason' => 'nullable|string|max:500']);
        $req = ShiftSwapRequest::where('id', $id)->where('target_id', $emp->id)->where('status', 'pending')->firstOrFail();
        if ($v['accept']) {
            $req->update(['status' => 'target_confirmed', 'target_confirmed_at' => now()]);
            $msg = 'Bạn đã xác nhận đổi ca. Chờ quản lý duyệt.';
        } else {
            $req->update(['status' => 'rejected', 'reject_reason' => $v['reason'] ?: 'NV từ chối']);
            $msg = 'Đã từ chối yêu cầu đổi ca.';
        }
        return response()->json(['success' => true, 'message' => $msg]);
    }

    // NV A: xem yêu cầu của mình
    public function myRequests(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $rows = ShiftSwapRequest::with(['target:id,full_name', 'requesterSchedule.workShift:id,name', 'targetSchedule.workShift:id,name'])
            ->where('requester_id', $emp->id)->orderBy('id', 'desc')->limit(20)->get();
        return response()->json(['success' => true, 'data' => $rows]);
    }

    // Quản lý: danh sách chờ duyệt
    public function index(): JsonResponse
    {
        $rows = ShiftSwapRequest::with(['requester:id,full_name', 'target:id,full_name',
                'requesterSchedule.workShift:id,name,start_time,end_time', 'targetSchedule.workShift:id,name,start_time,end_time'])
            ->where('status', 'target_confirmed')->orderBy('id', 'desc')->get();
        return response()->json(['success' => true, 'data' => $rows]);
    }

    // Quản lý: duyệt → hoán đổi ca 2 NV
    public function approve(Request $request, int $id): JsonResponse
    {
        $req = ShiftSwapRequest::where('id', $id)->where('status', 'target_confirmed')->firstOrFail();
        try {
            DB::transaction(function () use ($req, $request) {
            $a = WorkSchedule::findOrFail($req->requester_schedule_id);
            $b = WorkSchedule::findOrFail($req->target_schedule_id);
            // Audit 2026-10-23 A1-4: trước khi hoán đổi phải kiểm 2 dòng lịch còn
            // thuộc đúng 2 NV của yêu cầu và ngày chưa qua (lịch có thể đã đổi
            // tay sau khi NV kia xác nhận)
            if ((int) $a->employee_id !== (int) $req->requester_id || (int) $b->employee_id !== (int) $req->target_id) {
                throw new \RuntimeException('Lịch ca đã thay đổi so với lúc tạo yêu cầu. Hãy hủy yêu cầu và tạo lại.');
            }
            if ($a->date->toDateString() < Carbon::today()->toDateString() || $b->date->toDateString() < Carbon::today()->toDateString()) {
                throw new \RuntimeException('Ca đã qua ngày, không đổi được nữa.');
            }
            // Hoán đổi employee_id của 2 dòng lịch (giữ nguyên ca/ngày/CN)
            $tmp = $a->employee_id;
            $a->employee_id = $b->employee_id;
            $b->employee_id = $tmp;
            $a->save(); $b->save();
            // Audit 2026-10-23 A1-1: người duyệt ghi theo ApprovalActor — Employee
            // duyệt ghi decided_by_employee_id, không ép id NV vào FK users nữa
            [$decidedUserId, $decidedEmployeeId] = \App\Support\ApprovalActor::ids($request->user());
            $req->update(['status' => 'approved', 'decided_by' => $decidedUserId, 'decided_by_employee_id' => $decidedEmployeeId]);
            });
        } catch (\RuntimeException $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }
        return response()->json(['success' => true, 'message' => 'Đã duyệt và hoán đổi ca của 2 NV.']);
    }

    // Quản lý: từ chối
    public function reject(Request $request, int $id): JsonResponse
    {
        $v = $request->validate(['reason' => 'nullable|string|max:500']);
        $req = ShiftSwapRequest::where('id', $id)->whereIn('status', ['pending', 'target_confirmed'])->firstOrFail();
        // Audit 2026-10-23 A1-1: ghi vết người từ chối theo ApprovalActor
        [$decidedUserId, $decidedEmployeeId] = \App\Support\ApprovalActor::ids($request->user());
        $req->update(['status' => 'rejected', 'reject_reason' => $v['reason'] ?: 'Quản lý từ chối', 'decided_by' => $decidedUserId, 'decided_by_employee_id' => $decidedEmployeeId]);
        return response()->json(['success' => true, 'message' => 'Đã từ chối yêu cầu đổi ca.']);
    }
}
