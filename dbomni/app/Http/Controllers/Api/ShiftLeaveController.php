<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\ShiftLeaveRequest;
use App\Models\ShiftRegistration;
use App\Models\WorkSchedule;
use App\Models\WorkShift;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 46: Yêu cầu nghỉ theo ca đã đăng ký/xếp.
// - NV: qua link /xin-nghi (đăng nhập PIN), chỉ được tạo trước giờ ca ít nhất 48h.
// - Quản lý: tạo trực tiếp (bỏ qua 48h), duyệt → tự động gỡ ca khỏi lịch xếp.
class ShiftLeaveController extends Controller
{
    // Ca sắp tới của NV (đã xếp hoặc đã duyệt đăng ký), chưa có yêu cầu nghỉ.
    public function myShifts(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $today = Carbon::today();

        $scheds = WorkSchedule::with('workShift:id,name,start_time,end_time')
            ->where('employee_id', $emp->id)
            ->where('date', '>=', $today->toDateString())
            ->get()
            ->map(fn($s) => [
                'date' => $s->date->toDateString(),
                'work_shift_id' => $s->work_shift_id,
                'work_schedule_id' => $s->id,
                'shift_name' => $s->workShift?->name ?? '',
                'start_time' => $s->workShift?->start_time ?? '',
                'end_time' => $s->workShift?->end_time ?? '',
            ]);

        $regs = ShiftRegistration::with('workShift:id,name,start_time,end_time')
            ->where('employee_id', $emp->id)
            ->where('status', 'approved')
            ->where('date', '>=', $today->toDateString())
            ->get()
            ->map(fn($r) => [
                'date' => $r->date->toDateString(),
                'work_shift_id' => $r->work_shift_id,
                'work_schedule_id' => null,
                'shift_name' => $r->workShift?->name ?? '',
                'start_time' => $r->workShift?->start_time ?? '',
                'end_time' => $r->workShift?->end_time ?? '',
            ]);

        // Gộp, loại trùng (ca vừa duyệt vừa xếp), loại ca đã có yêu cầu nghỉ pending/approved
        $all = $scheds->concat($regs)->unique(fn($x) => $x['date'] . '|' . $x['work_shift_id'])->values();
        $existing = ShiftLeaveRequest::where('employee_id', $emp->id)
            ->whereIn('status', ['pending', 'approved'])
            ->get(['date', 'work_shift_id'])
            ->map(fn($x) => $x->date->toDateString() . '|' . $x->work_shift_id)
            ->all();
        $all = $all->reject(fn($x) => in_array($x['date'] . '|' . $x['work_shift_id'], $existing))->values();

        return response()->json(['success' => true, 'data' => $all]);
    }

    // NV xem yêu cầu của mình
    public function myList(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $items = ShiftLeaveRequest::with('workShift:id,name,start_time,end_time')
            ->where('employee_id', $emp->id)
            ->orderByDesc('created_at')->get();
        return response()->json(['success' => true, 'data' => $items]);
    }

    // NV tạo yêu cầu (check 48h)
    public function store(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'date' => 'required|date',
            'work_shift_id' => 'required|exists:work_shifts,id',
            'reason' => 'nullable|string|max:500',
        ]);

        $shift = WorkShift::findOrFail($v['work_shift_id']);
        $shiftStart = Carbon::parse($v['date'] . ' ' . $shift->start_time);
        if ($shiftStart->lt(Carbon::now()->addHours(48))) {
            return response()->json([
                'success' => false,
                'message' => 'Chỉ được xin nghỉ trước giờ ca ít nhất 48 giờ. Trường hợp gấp, vui lòng liên hệ quản lý trực tiếp.',
            ], 422);
        }

        // Phải là ca của chính NV (đã xếp hoặc đã duyệt đăng ký)
        $sched = WorkSchedule::where('employee_id', $emp->id)
            ->where('date', $v['date'])->where('work_shift_id', $v['work_shift_id'])->first();
        $reg = ShiftRegistration::where('employee_id', $emp->id)
            ->where('date', $v['date'])->where('work_shift_id', $v['work_shift_id'])
            ->where('status', 'approved')->first();
        if (!$sched && !$reg) {
            return response()->json(['success' => false, 'message' => 'Ca này không thuộc lịch của bạn.'], 422);
        }

        $dup = ShiftLeaveRequest::where('employee_id', $emp->id)
            ->where('date', $v['date'])->where('work_shift_id', $v['work_shift_id'])
            ->whereIn('status', ['pending', 'approved'])->exists();
        if ($dup) {
            return response()->json(['success' => false, 'message' => 'Ca này đã có yêu cầu nghỉ.'], 422);
        }

        $lr = ShiftLeaveRequest::create([
            'employee_id' => $emp->id,
            'date' => $v['date'],
            'work_shift_id' => $v['work_shift_id'],
            'work_schedule_id' => $sched?->id,
            'reason' => $v['reason'] ?? null,
            'status' => 'pending',
            'is_manager_created' => false,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã gửi yêu cầu nghỉ, chờ quản lý duyệt.', 'data' => $lr]);
    }

    // Admin: danh sách
    public function index(Request $request): JsonResponse
    {
        $q = ShiftLeaveRequest::with(['employee:id,full_name,branch_id', 'workShift:id,name,start_time,end_time'])
            ->orderByDesc('created_at');
        if ($request->filled('status')) $q->where('status', $request->string('status'));
        return response()->json(['success' => true, 'data' => $q->get()]);
    }

    // Admin: tạo trực tiếp cho NV (bỏ qua 48h) — tạo là duyệt luôn + gỡ ca
    public function managerStore(Request $request): JsonResponse
    {
        $v = $request->validate([
            'employee_id' => 'required|exists:employees,id',
            'date' => 'required|date',
            'work_shift_id' => 'required|exists:work_shifts,id',
            'reason' => 'nullable|string|max:500',
        ]);
        return DB::transaction(function () use ($v) {
            $sched = WorkSchedule::where('employee_id', $v['employee_id'])
                ->where('date', $v['date'])->where('work_shift_id', $v['work_shift_id'])->first();
            $lr = ShiftLeaveRequest::create([
                'employee_id' => $v['employee_id'],
                'date' => $v['date'],
                'work_shift_id' => $v['work_shift_id'],
                'work_schedule_id' => $sched?->id,
                'reason' => $v['reason'] ?? null,
                'status' => 'approved',
                'is_manager_created' => true,
            ]);
            if ($sched) $sched->delete();
            return response()->json(['success' => true, 'message' => 'Đã tạo và duyệt yêu cầu nghỉ, ca đã được gỡ khỏi lịch xếp.', 'data' => $lr]);
        });
    }

    // Admin: duyệt → tự động gỡ ca khỏi lịch xếp
    public function approve(int $id): JsonResponse
    {
        return DB::transaction(function () use ($id) {
            $lr = ShiftLeaveRequest::findOrFail($id);
            if ($lr->status !== 'pending') {
                return response()->json(['success' => false, 'message' => 'Yêu cầu đã được xử lý.'], 422);
            }
            $lr->update(['status' => 'approved']);
            // Gỡ ca khỏi lịch xếp (tìm lại theo NV+ngày+ca để chắc chắn, kể cả khi xếp sau lúc tạo yêu cầu)
            WorkSchedule::where('employee_id', $lr->employee_id)
                ->where('date', $lr->date->toDateString())
                ->where('work_shift_id', $lr->work_shift_id)
                ->delete();
            return response()->json(['success' => true, 'message' => 'Đã duyệt và gỡ ca khỏi lịch xếp.']);
        });
    }

    public function reject(int $id): JsonResponse
    {
        $lr = ShiftLeaveRequest::findOrFail($id);
        if ($lr->status !== 'pending') {
            return response()->json(['success' => false, 'message' => 'Yêu cầu đã được xử lý.'], 422);
        }
        $lr->update(['status' => 'rejected']);
        return response()->json(['success' => true, 'message' => 'Đã từ chối yêu cầu.']);
    }
}
