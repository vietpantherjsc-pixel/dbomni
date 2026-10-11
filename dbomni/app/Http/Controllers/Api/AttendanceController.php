<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\WorkSchedule;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 35: Chấm công QR — NV tự check-in/out; admin xem lưới tuần.
class AttendanceController extends Controller
{
    // NV chấm công vào (body: branch_id, token từ QR)
    public function checkIn(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'token' => 'required|string',
        ]);
        $branch = Branch::find($v['branch_id']);
        if (!$branch || !hash_equals((string) $branch->attendance_qr_token, (string) $v['token'])) {
            return response()->json(['success' => false, 'message' => 'Mã QR không hợp lệ.'], 422);
        }
        $today = now()->toDateString();
        $att = Attendance::firstOrNew([
            'employee_id' => $emp->id, 'branch_id' => $branch->id, 'date' => $today,
        ]);
        if ($att->exists && $att->check_in) {
            return response()->json(['success' => false, 'message' => 'Hôm nay bạn đã chấm công vào lúc ' . Carbon::parse($att->check_in)->format('H:i') . '.'], 422);
        }
        $att->check_in = now();
        $att->save();
        return response()->json(['success' => true, 'message' => 'Chấm công vào thành công lúc ' . now()->format('H:i') . '.', 'data' => $att]);
    }

    // NV chấm công ra
    public function checkOut(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'token' => 'required|string',
        ]);
        $branch = Branch::find($v['branch_id']);
        if (!$branch || !hash_equals((string) $branch->attendance_qr_token, (string) $v['token'])) {
            return response()->json(['success' => false, 'message' => 'Mã QR không hợp lệ.'], 422);
        }
        $today = now()->toDateString();
        $att = Attendance::where('employee_id', $emp->id)->where('branch_id', $branch->id)->where('date', $today)->first();
        if (!$att || !$att->check_in) {
            return response()->json(['success' => false, 'message' => 'Bạn chưa chấm công vào hôm nay.'], 422);
        }
        if ($att->check_out) {
            return response()->json(['success' => false, 'message' => 'Hôm nay bạn đã chấm công ra lúc ' . Carbon::parse($att->check_out)->format('H:i') . '.'], 422);
        }
        $att->check_out = now();
        $att->save();
        $hours = round(Carbon::parse($att->check_in)->diffInMinutes($att->check_out) / 60, 1);
        return response()->json(['success' => true, 'message' => "Chấm công ra thành công. Hôm nay bạn làm {$hours} giờ.", 'data' => $att]);
    }

    // NV xem lịch sử của chính mình (theo tháng)
    public function myHistory(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $month = $request->query('month', now()->format('Y-m'));
        $items = Attendance::with('branch:id,name')
            ->where('employee_id', $emp->id)
            ->where('date', 'like', $month . '%')
            ->orderBy('date', 'desc')->get()
            ->map(function ($a) {
                $a->work_hours = ($a->check_in && $a->check_out)
                    ? round(Carbon::parse($a->check_in)->diffInMinutes($a->check_out) / 60, 1) : null;
                return $a;
            });
        return response()->json(['success' => true, 'data' => $items]);
    }

    // NV xem trạng thái hôm nay của mình tại 1 chi nhánh
    public function myToday(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $branchId = $request->query('branch_id');
        $today = now()->toDateString();
        $att = Attendance::where('employee_id', $emp->id)->where('date', $today)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->first();
        return response()->json(['success' => true, 'data' => $att]);
    }

    // Admin: lưới chấm công theo tuần
    public function grid(Request $request): JsonResponse
    {
        $v = $request->validate([
            'week' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        $monday = Carbon::parse($v['week'])->startOfWeek();
        $days = [];
        for ($i = 0; $i < 7; $i++) $days[] = $monday->copy()->addDays($i)->toDateString();

        $empQ = Employee::where('is_active', true)->select('id', 'full_name', 'branch_id');
        if (!empty($v['branch_id'])) $empQ->where('branch_id', $v['branch_id']);
        $employees = $empQ->orderBy('full_name')->get();

        $atts = Attendance::whereIn('date', $days)
            ->when(!empty($v['branch_id']), fn($q) => $q->where('branch_id', $v['branch_id']))
            ->get()->groupBy(fn($a) => $a->employee_id . '|' . $a->date->toDateString());

        $scheds = WorkSchedule::with('workShift:id,start_time,end_time')
            ->whereIn('date', $days)
            ->when(!empty($v['branch_id']), fn($q) => $q->where('branch_id', $v['branch_id']))
            ->get()->groupBy(fn($s) => $s->employee_id . '|' . $s->date->toDateString());

        $leaveDays = [];
        $leaves = LeaveRequest::where('status', 'approved')
            ->where('date_from', '<=', $days[6])->where(function ($q) use ($days) {
                $q->whereNull('date_to')->orWhere('date_to', '>=', $days[0]);
            })->get();
        foreach ($leaves as $lv) {
            $from = $lv->date_from->toDateString();
            $to = $lv->date_to ? $lv->date_to->toDateString() : null;
            foreach ($days as $d) {
                if ($d >= $from && (!$to || $d <= $to)) {
                    $leaveDays[$lv->employee_id . '|' . $d] = true;
                }
            }
        }

        $rows = $employees->map(function ($e) use ($days, $atts, $scheds, $leaveDays) {
            $cells = [];
            foreach ($days as $d) {
                $key = $e->id . '|' . $d;
                $rec = $atts->get($key)?->first();
                $schedList = $scheds->get($key, collect());
                $scheduledMin = $schedList->sum(function ($s) {
                    $st = Carbon::parse($s->custom_start_time ?: $s->workShift->start_time);
                    $en = Carbon::parse($s->custom_end_time ?: $s->workShift->end_time);
                    if ($en->lte($st)) $en->addDay(); // ca qua đêm
                    return (int) $st->diffInMinutes($en);
                });
                // Gói 40: giờ bắt đầu ca sớm nhất trong ngày (HH:MM) — frontend tô đỏ khi đi trễ
                $scheduledStart = $schedList->map(function ($s) {
                    $t = $s->custom_start_time ?: ($s->workShift?->start_time);
                    return $t ? substr((string) $t, 0, 5) : null;
                })->filter()->min();
                $hours = ($rec && $rec->check_in && $rec->check_out)
                    ? round(Carbon::parse($rec->check_in)->diffInMinutes($rec->check_out) / 60, 1) : null;
                // xanh = đủ công, vàng = thiếu/về sớm hoặc chưa ra, xám = nghỉ
                $status = 'absent';
                if (isset($leaveDays[$key])) $status = 'leave';
                elseif ($rec && $rec->check_in && $rec->check_out) {
                    $status = ($scheduledMin > 0 && $hours < $scheduledMin / 60 * 0.9) ? 'partial' : 'present';
                } elseif ($rec && $rec->check_in) $status = 'partial';
                $cells[$d] = [
                    'status' => $status,
                    'check_in' => $rec?->check_in, 'check_out' => $rec?->check_out,
                    'hours' => $hours, 'scheduled_hours' => $scheduledMin > 0 ? round($scheduledMin / 60, 1) : null,
                    'scheduled_start' => $scheduledStart, // Gói 40: HH:MM, null nếu không có lịch
                ];
            }
            return ['id' => $e->id, 'full_name' => $e->full_name, 'branch_id' => $e->branch_id, 'days' => $cells];
        });

        return response()->json([
            'success' => true,
            'data' => ['week_start' => $days[0], 'week_end' => $days[6], 'days' => $days, 'rows' => $rows],
        ]);
    }

    // Gói 46: Thống kê ca theo tháng cho cột "Tổng số ca" (bảng chấm công).
    // numerator = số ca (ngày, ca) DISTINCT đã duyệt hoặc đã xếp; denominator = tổng ca đã đăng ký.
    public function shiftStats(Request $request): JsonResponse
    {
        $v = $request->validate([
            'month' => 'required|date_format:Y-m',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        [$y, $m] = explode('-', $v['month']);

        $empQ = Employee::where('is_active', true)->select('id');
        if (!empty($v['branch_id'])) $empQ->where('branch_id', $v['branch_id']);
        $empIds = $empQ->pluck('id');

        $regs = \App\Models\ShiftRegistration::whereIn('employee_id', $empIds)
            ->whereYear('date', $y)->whereMonth('date', $m)
            ->get(['employee_id', 'date', 'work_shift_id', 'status']);
        $scheds = WorkSchedule::whereIn('employee_id', $empIds)
            ->whereYear('date', $y)->whereMonth('date', $m)
            ->get(['employee_id', 'date', 'work_shift_id']);

        $byEmp = [];
        foreach ($empIds as $eid) $byEmp[$eid] = ['registered' => 0, 'done_keys' => []];
        foreach ($regs as $r) {
            $b = &$byEmp[$r->employee_id];
            $b['registered']++;
            if ($r->status === 'approved') $b['done_keys'][$r->date->toDateString() . '|' . $r->work_shift_id] = true;
            unset($b);
        }
        foreach ($scheds as $s) {
            $byEmp[$s->employee_id]['done_keys'][$s->date->toDateString() . '|' . $s->work_shift_id] = true;
        }
        $data = [];
        foreach ($byEmp as $eid => $b) {
            $data[] = [
                'employee_id' => $eid,
                'done' => count($b['done_keys']),
                'registered' => $b['registered'],
            ];
        }
        return response()->json(['success' => true, 'data' => $data]);
    }
}
