<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\Setting;
use App\Models\WorkSchedule;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 35: Chấm công QR — NV tự check-in/out; admin xem lưới tuần.
class AttendanceController extends Controller
{
    // Spec P4-B4: tìm ca của NV trong ngày (đã xếp; giờ custom ưu tiên hơn giờ ca mẫu)
    // Audit 2026-10-23 A1-8: ngày có thể có 2 ca — chọn ca có giờ bắt đầu GẦN
    // thời điểm đối chiếu nhất (mặc định: hiện tại), không lấy dòng đầu tiên nữa.
    private function todayShift(int $employeeId, string $date, ?Carbon $at = null): ?array
    {
        $list = WorkSchedule::with('workShift:id,name,start_time,end_time')
            ->where('employee_id', $employeeId)->where('date', $date)->get()
            ->filter(fn ($s) => $s->workShift);
        if ($list->isEmpty()) return null;
        $fmt = fn ($t) => $t instanceof \DateTimeInterface ? $t->format('H:i') : substr((string) $t, 0, 5);
        $at = $at ?? now();
        $best = null;
        $bestDiff = null;
        foreach ($list as $s) {
            $start = $s->custom_start_time ? $fmt($s->custom_start_time) : $fmt($s->workShift->start_time);
            $diff = abs(Carbon::parse($date . ' ' . $start)->diffInMinutes($at, false));
            if ($bestDiff === null || $diff < $bestDiff) {
                $bestDiff = $diff;
                $best = [
                    'name' => $s->workShift->name,
                    'start' => $start,
                    'end' => $s->custom_end_time ? $fmt($s->custom_end_time) : $fmt($s->workShift->end_time),
                ];
            }
        }
        return $best;
    }

    // Audit 2026-10-23 A3-1: NV chỉ chấm công tại CN được phân công
    private function denyUnassignedBranch(Employee $emp, int $branchId): ?JsonResponse
    {
        if (!in_array($branchId, $emp->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Bạn không được phân công tại chi nhánh này.'], 403);
        }
        return null;
    }

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
        if ($deny = $this->denyUnassignedBranch($emp, (int) $branch->id)) return $deny;
        $today = now()->toDateString();
        // Audit 2026-10-23 A4-2: tối đa 2 cặp vào/ra mỗi (NV, CN, ngày) — ca gãy 2 đoạn.
        // Đang có ca MỞ tại CN này (chưa chấm ra) thì phải chấm ra trước.
        $open = Attendance::where('employee_id', $emp->id)->where('branch_id', $branch->id)
            ->whereNotNull('check_in')->whereNull('check_out')
            ->orderByDesc('check_in')->first();
        if ($open) {
            return response()->json(['success' => false, 'message' => 'Bạn đang trong ca chưa chấm ra (vào lúc ' . Carbon::parse($open->check_in)->format('H:i d/m') . '). Hãy chấm công ra trước.'], 422);
        }
        $todayCount = Attendance::where('employee_id', $emp->id)->where('branch_id', $branch->id)
            ->where('date', $today)->count();
        if ($todayCount >= 2) {
            return response()->json(['success' => false, 'message' => 'Hôm nay bạn đã chấm đủ 2 lượt vào/ra tại chi nhánh này.'], 422);
        }
        $att = new Attendance([
            'employee_id' => $emp->id, 'branch_id' => $branch->id, 'date' => $today,
        ]);
        $att->check_in = now();
        // Spec P4-B4: đối chiếu ca — đi muộn = vào sau giờ ca + grace period
        $shift = $this->todayShift($emp->id, $today);
        $msg = 'Chấm công vào thành công lúc ' . now()->format('H:i') . '.';
        if (!$shift) {
            $att->outside_shift = true;
            $msg .= ' (Cảnh báo: hôm nay bạn không có ca nào được xếp.)';
        } else {
            $grace = (int) Setting::get('attendance_grace_minutes', 10);
            $lateAt = Carbon::parse($shift['start'])->addMinutes($grace);
            if (now()->gt($lateAt)) {
                $att->is_late = true;
                $msg .= " (Đi muộn — ca {$shift['name']} bắt đầu {$shift['start']}).";
            }
        }
        $att->save();
        return response()->json(['success' => true, 'message' => $msg, 'data' => $att]);
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
        if ($deny = $this->denyUnassignedBranch($emp, (int) $branch->id)) return $deny;
        // Audit 2026-10-23 A4-1: chấm ra tìm bản ghi ĐANG MỞ gần nhất tại CN này
        // (không khóa theo ngày) -> ca qua đêm vào tối hôm trước ra sáng hôm sau
        // vẫn chấm được.
        $att = Attendance::where('employee_id', $emp->id)->where('branch_id', $branch->id)
            ->whereNotNull('check_in')->whereNull('check_out')
            ->orderByDesc('check_in')->first();
        if (!$att) {
            $openElsewhere = Attendance::where('employee_id', $emp->id)
                ->whereNotNull('check_in')->whereNull('check_out')
                ->orderByDesc('check_in')->first();
            if ($openElsewhere) {
                return response()->json(['success' => false, 'message' => 'Bạn đang có ca chưa chấm ra tại chi nhánh khác (vào lúc ' . Carbon::parse($openElsewhere->check_in)->format('H:i d/m') . '). Hãy chấm ra tại chi nhánh đó.'], 422);
            }
            return response()->json(['success' => false, 'message' => 'Bạn chưa chấm công vào.'], 422);
        }
        $att->check_out = now();
        // Spec P4-B4: về sớm = ra trước giờ kết thúc ca (ca khớp theo giờ VÀO của bản ghi;
        // ca qua đêm: giờ kết thúc thuộc ngày hôm sau)
        $attDate = $att->date->toDateString();
        $shift = $this->todayShift($emp->id, $attDate, Carbon::parse($att->check_in));
        $earlyMsg = '';
        if ($shift) {
            $endAt = Carbon::parse($attDate . ' ' . $shift['end']);
            if ($endAt->lte(Carbon::parse($attDate . ' ' . $shift['start']))) $endAt->addDay();
            if (now()->lt($endAt)) {
                $att->is_early_leave = true;
                $earlyMsg = " (Về sớm — ca {$shift['name']} kết thúc {$shift['end']}).";
            }
        }
        $att->save();
        $hours = round(Carbon::parse($att->check_in)->diffInMinutes($att->check_out) / 60, 1);
        return response()->json(['success' => true, 'message' => "Chấm công ra thành công. Ca này bạn làm {$hours} giờ.{$earlyMsg}", 'data' => $att]);
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
            ->orderByDesc('check_in')->first();
        if (!$att) {
            // Audit 2026-10-23 A4-1: chưa có bản ghi hôm nay -> trả bản ghi đang MỞ
            // (ca qua đêm từ hôm trước) để giao diện hiện nút chấm ra.
            $att = Attendance::where('employee_id', $emp->id)
                ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
                ->whereNotNull('check_in')->whereNull('check_out')
                ->orderByDesc('check_in')->first();
        }
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
                // Audit 2026-10-23 A4-2: 1 ngày có thể có 2 bản ghi (2 cặp vào/ra) —
                // lưới cộng dồn giờ của cả 2 cặp; vào = sớm nhất, ra = muộn nhất
                // (chỉ khi mọi cặp đã đóng).
                $dayRecs = $atts->get($key, collect());
                $rec = $dayRecs->first();
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
                $hours = null;
                if ($dayRecs->isNotEmpty() && $dayRecs->every(fn ($r) => $r->check_in && $r->check_out)) {
                    $hours = round($dayRecs->sum(fn ($r) => Carbon::parse($r->check_in)->diffInMinutes($r->check_out)) / 60, 1);
                }
                $firstIn = $dayRecs->filter(fn ($r) => $r->check_in)->sortBy('check_in')->first()?->check_in;
                $lastOut = $dayRecs->every(fn ($r) => $r->check_out) && $dayRecs->isNotEmpty()
                    ? $dayRecs->sortByDesc('check_out')->first()?->check_out : null;
                // xanh = đủ công, vàng = thiếu/về sớm hoặc chưa ra, xám = nghỉ
                $status = 'absent';
                if (isset($leaveDays[$key])) $status = 'leave';
                elseif ($hours !== null) {
                    $status = ($scheduledMin > 0 && $hours < $scheduledMin / 60 * 0.9) ? 'partial' : 'present';
                } elseif ($rec && $rec->check_in) $status = 'partial';
                $cells[$d] = [
                    // Bổ sung Mảng 4 (A3-7 FE): id bản ghi đầu (theo giờ vào) để
                    // quản lý mở modal sửa giờ; pair_count = số cặp chấm trong ngày
                    'attendance_id' => optional($list->sortBy('check_in')->first())->id,
                    'pair_count' => $list->count(),
                    'status' => $status,
                    'check_in' => $firstIn, 'check_out' => $lastOut,
                    'hours' => $hours, 'scheduled_hours' => $scheduledMin > 0 ? round($scheduledMin / 60, 1) : null,
                    'scheduled_start' => $scheduledStart, // Gói 40: HH:MM, null nếu không có lịch
                    // Spec P4-B4: cờ đi muộn / về sớm / chấm ngoài ca (bất kỳ cặp nào trong ngày)
                    'is_late' => $dayRecs->contains(fn ($r) => (bool) $r->is_late),
                    'is_early_leave' => $dayRecs->contains(fn ($r) => (bool) $r->is_early_leave),
                    'outside_shift' => $dayRecs->isNotEmpty() && $dayRecs->every(fn ($r) => (bool) $r->outside_shift),
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
        // Audit 2026-10-23 A1-9: ca đã được duyệt NGHỈ theo ca (Gói 46) không còn
        // tính là ca đã hoàn thành — trước đây đăng ký đã duyệt vẫn nằm trong
        // done_keys dù NV đã nghỉ ca đó.
        $leaveKeys = \App\Models\ShiftLeaveRequest::whereIn('employee_id', $empIds)
            ->where('status', 'approved')
            ->whereYear('date', $y)->whereMonth('date', $m)
            ->get(['employee_id', 'date', 'work_shift_id'])
            ->map(fn ($l) => $l->employee_id . '|' . $l->date->toDateString() . '|' . $l->work_shift_id)
            ->flip()->all();
        foreach ($byEmp as $eid => &$b) {
            foreach (array_keys($b['done_keys']) as $k) {
                if (isset($leaveKeys[$eid . '|' . $k])) unset($b['done_keys'][$k]);
            }
        }
        unset($b);
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

    // Audit 2026-10-23 A3-7: admin sửa giờ vào/ra của 1 bản ghi chấm công.
    // Mọi lần sửa đều ghi 1 dòng attendance_edits (ai sửa, cũ -> mới, lý do).
    public function updateTimes(Request $request, int $id): JsonResponse
    {
        $v = $request->validate([
            'check_in' => 'nullable|date',
            'check_out' => 'nullable|date', // thứ tự vào<ra kiểm thủ công sau khi gộp với giá trị cũ
            'reason' => 'nullable|string|max:500',
        ]);
        $att = Attendance::findOrFail($id);
        $newIn = array_key_exists('check_in', $v) && $v['check_in'] ? Carbon::parse($v['check_in']) : $att->check_in;
        $newOut = array_key_exists('check_out', $v) && $v['check_out'] ? Carbon::parse($v['check_out']) : $att->check_out;
        if ($newIn && $newOut && $newOut->lte($newIn)) {
            return response()->json(['success' => false, 'message' => 'Giờ ra phải sau giờ vào.'], 422);
        }
        [$userId, $employeeId] = \App\Support\ApprovalActor::ids($request->user());
        \Illuminate\Support\Facades\DB::transaction(function () use ($att, $newIn, $newOut, $v, $userId, $employeeId) {
            \App\Models\AttendanceEdit::create([
                'attendance_id' => $att->id,
                'editor_user_id' => $userId,
                'editor_employee_id' => $employeeId,
                'old_check_in' => $att->check_in,
                'new_check_in' => $newIn,
                'old_check_out' => $att->check_out,
                'new_check_out' => $newOut,
                'reason' => $v['reason'] ?? null,
            ]);
            $att->check_in = $newIn;
            $att->check_out = $newOut;
            if ($newIn) $att->date = $newIn->toDateString();
            $att->save();
        });
        return response()->json(['success' => true, 'message' => 'Đã sửa giờ chấm công.', 'data' => $att->fresh()]);
    }
}
