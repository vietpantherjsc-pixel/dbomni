<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ScheduleNote;
use App\Models\WorkSchedule;
use App\Models\WorkShift;
use App\Models\WorkShiftCapacity;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 35: Xếp ca — quản lý gán ca + điều chỉnh giờ vào/ra riêng từng NV.
class WorkScheduleController extends Controller
{
    // Gói 35b: chuẩn hóa giờ về dạng 24h "H:i" trước khi validate
    private function normTime(?string $v): ?string
    {
        if ($v === null || trim($v) === '') return $v;
        $v = trim($v);
        if (preg_match('/^(\d{1,2}):(\d{2})(?::\d{2})?$/', $v, $m)) {
            return sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
        }
        if (preg_match('/^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i', $v, $m)) {
            $h = ((int) $m[1]) % 12 + (strtoupper($m[3]) === 'P' ? 12 : 0);
            return sprintf('%02d:%02d', $h, (int) $m[2]);
        }
        return $v;
    }
    // Lấy lịch đã xếp theo tuần (+ chi nhánh)
    public function week(Request $request): JsonResponse
    {
        $v = $request->validate([
            'week' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        $monday = Carbon::parse($v['week'])->startOfWeek();
        $days = [];
        for ($i = 0; $i < 7; $i++) $days[] = $monday->copy()->addDays($i)->toDateString();

        $q = WorkSchedule::with(['employee:id,full_name,branch_id', 'workShift:id,name,start_time,end_time'])
            ->whereIn('date', $days);
        if (!empty($v['branch_id'])) $q->where('branch_id', $v['branch_id']);
        $items = $q->orderBy('date')->get()->map(function ($s) {
            // Gói 35d: date cast serialize thành "Y-m-d H:i:s" làm lưới admin
            // so khớp Y-m-d thất bại → trả về Y-m-d cho đúng
            $a = $s->toArray();
            $a['date'] = $s->date->toDateString();
            $a['start_time'] = $s->custom_start_time ?: $s->workShift->start_time;
            $a['end_time'] = $s->custom_end_time ?: $s->workShift->end_time;
            $a['is_custom'] = (bool) ($s->custom_start_time || $s->custom_end_time);
            return $a;
        });
        // Gói 37: sức chứa theo ca×ngày + ghi chú tuần
        $caps = [];
        foreach (WorkShiftCapacity::all() as $c) {
            $caps[(string) $c->work_shift_id][(int) $c->weekday] = $c->max_staff === null ? null : (int) $c->max_staff;
        }
        $note = null;
        if (!empty($v['branch_id'])) {
            $note = ScheduleNote::where('branch_id', $v['branch_id'])->where('week_start', $days[0])->value('note');
        } else {
            $note = ScheduleNote::whereNull('branch_id')->where('week_start', $days[0])->value('note');
        }
        return response()->json([
            'success' => true,
            'data' => [
                'week_start' => $days[0], 'week_end' => $days[6], 'days' => $days,
                'schedules' => $items, 'capacities' => $caps, 'note' => $note,
            ],
        ]);
    }

    // Gán / cập nhật 1 ô xếp ca (upsert theo NV + ca + ngày)
    public function assign(Request $request): JsonResponse
    {
        foreach (['custom_start_time', 'custom_end_time'] as $f) {
            if ($request->filled($f)) $request->merge([$f => $this->normTime($request->input($f))]);
        }
        $v = $request->validate([
            'employee_id' => 'required|exists:employees,id',
            'work_shift_id' => 'required|exists:work_shifts,id',
            'date' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
            'custom_start_time' => 'nullable|date_format:H:i',
            'custom_end_time' => 'nullable|date_format:H:i',
        ]);
        // Gói 37: kiểm tra sức chứa của ô ca×ngày (không tính chính NV này vì upsert)
        $weekday = ((int) Carbon::parse($v['date'])->dayOfWeek + 6) % 7; // 0=Thứ 2
        $cap = WorkShiftCapacity::where('work_shift_id', $v['work_shift_id'])->where('weekday', $weekday)->first();
        if ($cap && $cap->max_staff !== null) {
            $cnt = WorkSchedule::where('work_shift_id', $v['work_shift_id'])
                ->where('date', $v['date'])
                ->where('employee_id', '!=', $v['employee_id'])
                ->count();
            if ($cnt >= $cap->max_staff) {
                $shift = WorkShift::find($v['work_shift_id']);
                $d = Carbon::parse($v['date'])->format('d/m');
                return response()->json([
                    'success' => false,
                    'message' => 'Ca ' . ($shift?->name ?? '') . ' ngày ' . $d . ' đã đủ ' . $cap->max_staff . ' người.',
                ], 422);
            }
        }
        $sched = WorkSchedule::updateOrCreate(
            ['employee_id' => $v['employee_id'], 'work_shift_id' => $v['work_shift_id'], 'date' => $v['date']],
            [
                'branch_id' => $v['branch_id'] ?? null,
                'custom_start_time' => $v['custom_start_time'] ?? null,
                'custom_end_time' => $v['custom_end_time'] ?? null,
                'created_by' => $request->user()?->id,
            ]
        );
        return response()->json(['success' => true, 'message' => 'Đã xếp ca.', 'data' => $sched]);
    }

    public function destroy(int $id): JsonResponse
    {
        WorkSchedule::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã gỡ ca đã xếp.']);
    }

    // Gói 37: đặt sức chứa 1 ô ca×ngày (max_staff null/rỗng = không giới hạn)
    public function saveCapacity(Request $request): JsonResponse
    {
        $v = $request->validate([
            'work_shift_id' => 'required|exists:work_shifts,id',
            'weekday' => 'required|integer|min:0|max:6',
            'max_staff' => 'nullable|integer|min:1|max:100',
        ]);
        if ($v['max_staff'] === null) {
            WorkShiftCapacity::where('work_shift_id', $v['work_shift_id'])->where('weekday', $v['weekday'])->delete();
        } else {
            WorkShiftCapacity::updateOrCreate(
                ['work_shift_id' => $v['work_shift_id'], 'weekday' => $v['weekday']],
                ['max_staff' => $v['max_staff']]
            );
        }
        return response()->json(['success' => true, 'message' => 'Đã lưu sức chứa.']);
    }

    // Gói 37: lấy ghi chú tuần
    public function getNote(Request $request): JsonResponse
    {
        $v = $request->validate([
            'week' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        $monday = Carbon::parse($v['week'])->startOfWeek()->toDateString();
        $q = ScheduleNote::where('week_start', $monday);
        if (!empty($v['branch_id'])) $q->where('branch_id', $v['branch_id']);
        else $q->whereNull('branch_id');
        return response()->json(['success' => true, 'data' => ['note' => $q->value('note')]]);
    }

    // Gói 37b: map ghi chú tuần theo chi nhánh (cho chế độ xem tất cả CN)
    public function notesMap(Request $request): JsonResponse
    {
        $v = $request->validate(['week' => 'required|date']);
        $monday = Carbon::parse($v['week'])->startOfWeek()->toDateString();
        $out = [];
        foreach (ScheduleNote::where('week_start', $monday)->pluck('note', 'branch_id') as $bid => $note) {
            $out[$bid === '' || $bid === null ? 'null' : (string) $bid] = $note;
        }
        return response()->json(['success' => true, 'data' => $out]);
    }

    // Gói 37: lưu ghi chú tuần
    public function saveNote(Request $request): JsonResponse
    {
        $v = $request->validate([
            'week' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
            'note' => 'nullable|string|max:2000',
        ]);
        $monday = Carbon::parse($v['week'])->startOfWeek()->toDateString();
        if (!empty($v['branch_id'])) {
            ScheduleNote::updateOrCreate(
                ['branch_id' => $v['branch_id'], 'week_start' => $monday],
                ['note' => $v['note'] ?? null]
            );
        } else {
            ScheduleNote::updateOrCreate(
                ['week_start' => $monday, 'branch_id' => null],
                ['note' => $v['note'] ?? null]
            );
        }
        return response()->json(['success' => true, 'message' => 'Đã lưu ghi chú tuần.']);
    }
}
