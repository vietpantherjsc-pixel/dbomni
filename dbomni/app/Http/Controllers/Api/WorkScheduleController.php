<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\ScheduleNote;
use App\Models\User;
use App\Models\WorkSchedule;
use App\Models\WorkShift;
use App\Models\WorkShiftCapacity;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        $actor = $request->user();
        if ($actor instanceof Employee) {
            $scope = $actor->allBranchIds();
            if (!empty($v['branch_id']) && !in_array((int) $v['branch_id'], $scope, true)) {
                return response()->json(['success' => false, 'message' => 'Chi nhánh ngoài phạm vi phân công của bạn.'], 403);
            }
            if (empty($v['branch_id'])) {
                $q->where(fn ($qq) => $qq->whereIn('branch_id', $scope)
                    ->orWhereHas('employee', fn ($e) => $e->whereIn('branch_id', $scope)));
            }
        }
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
        // Gói 38: created_by chỉ set khi người thao tác là User (tài khoản admin);
        // Employee thao tác (quản lý là NV) thì để null để tránh lỗi FK users.id -> 500
        $actor = $request->user();
        $createdBy = $actor instanceof User ? $actor->id : null;

        try {
            $sched = DB::transaction(fn () => $this->doAssign($v, $createdBy, $actor));
        } catch (\RuntimeException $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }
        return response()->json(['success' => true, 'message' => 'Đã xếp ca.', 'data' => $sched]);
    }

    // Audit 2026-10-23 A1-11: dòng lịch thuộc phạm vi của actor Employee không?
    // (theo CN của dòng lịch, dòng chưa gắn CN thì theo CN chính của NV trên dòng)
    private function scheduleInScope($actor, WorkSchedule $sched): bool
    {
        if (!$actor instanceof Employee) return true;
        $scope = $actor->allBranchIds();
        if ($sched->branch_id !== null) return in_array((int) $sched->branch_id, $scope, true);
        $empBranch = (int) (Employee::where('id', $sched->employee_id)->value('branch_id') ?? 0);
        return in_array($empBranch, $scope, true);
    }

    // Gói 42: lưu hàng loạt các ô đã nháp của 1 chi nhánh trong 1 transaction.
    // { items: [{employee_id, work_shift_id, date, branch_id?, custom_start_time?, custom_end_time?}], deletes: [schedule_id] }
    public function batchSave(Request $request): JsonResponse
    {
        $v = $request->validate([
            'items' => 'nullable|array|max:500',
            'items.*.employee_id' => 'required|exists:employees,id',
            'items.*.work_shift_id' => 'required|exists:work_shifts,id',
            'items.*.date' => 'required|date',
            'items.*.branch_id' => 'nullable|exists:branches,id',
            'items.*.custom_start_time' => 'nullable|date_format:H:i',
            'items.*.custom_end_time' => 'nullable|date_format:H:i',
            'deletes' => 'nullable|array|max:500',
            'deletes.*' => 'integer|exists:work_schedules,id',
        ]);
        if (empty($v['items']) && empty($v['deletes'])) {
            return response()->json(['success' => true, 'message' => 'Không có thay đổi.']);
        }
        foreach ($v['items'] ?? [] as &$it) {
            foreach (['custom_start_time', 'custom_end_time'] as $f) {
                if (!empty($it[$f])) $it[$f] = $this->normTime($it[$f]);
            }
        }
        unset($it);
        $actor = $request->user();
        $createdBy = $actor instanceof User ? $actor->id : null;
        try {
            DB::transaction(function () use ($v, $createdBy, $actor) {
                if (!empty($v['deletes'])) {
                    // Audit 2026-10-23 A1-11: chỉ được xóa dòng lịch thuộc phạm vi CN của mình
                    if ($actor instanceof Employee) {
                        $targets = WorkSchedule::whereIn('id', $v['deletes'])->get();
                        foreach ($targets as $t) {
                            if (!$this->scheduleInScope($actor, $t)) {
                                throw new \RuntimeException('Có dòng lịch thuộc chi nhánh bạn không được phân công.');
                            }
                        }
                    }
                    WorkSchedule::whereIn('id', $v['deletes'])->delete();
                }
                foreach ($v['items'] ?? [] as $it) {
                    $this->doAssign($it, $createdBy, $actor);
                }
            });
        } catch (\RuntimeException $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }
        return response()->json(['success' => true, 'message' => 'Đã lưu lịch làm việc.']);
    }

    // Gói 42: lõi gán 1 NV vào ca (kiểm tra sức chứa) — gọi trong transaction của caller.
    private function doAssign(array $v, ?int $createdBy, $actor = null)
    {
        $emp = Employee::find($v['employee_id']);
        if (!$emp) {
            throw new \RuntimeException('Nhân viên không tồn tại.');
        }
        // Audit 2026-10-23 A1-7: chặn xếp ca cho NV đã nghỉ việc
        if (!$emp->is_active) {
            throw new \RuntimeException('NV ' . $emp->full_name . ' đã nghỉ việc, không xếp ca được.');
        }
        $shift = WorkShift::find($v['work_shift_id']);
        // Audit 2026-10-23 A1-12: CN của dòng lịch không để trống bừa — suy từ
        // payload, rồi CN của ca mẫu, rồi CN chính của NV.
        $branchId = $v['branch_id'] ?? $shift?->branch_id ?? $emp->branch_id;
        // Audit 2026-10-23 A1-7: CN xếp ca phải thuộc phân công của NV
        if ($branchId !== null && !in_array((int) $branchId, $emp->allBranchIds(), true)) {
            throw new \RuntimeException('NV ' . $emp->full_name . ' không được phân công tại chi nhánh này.');
        }
        // Audit 2026-10-23 A1-5: chặn ca CHỒNG GIỜ với ca khác của NV trong ngày
        // (xếp nhiều ca/ngày vẫn được — chỉ chặn khi khoảng giờ giao nhau).
        $fmtT = fn ($t) => $t === null ? null : substr((string) $t, 0, 5);
        $startStr = $fmtT($v['custom_start_time'] ?? $shift?->start_time);
        $endStr = $fmtT($v['custom_end_time'] ?? $shift?->end_time);
        if ($startStr && $endStr) {
            $start = Carbon::parse($v['date'] . ' ' . $startStr);
            $end = Carbon::parse($v['date'] . ' ' . $endStr);
            if ($end->lte($start)) $end->addDay(); // ca qua đêm
            $others = WorkSchedule::with('workShift:id,name,start_time,end_time')
                ->where('employee_id', $v['employee_id'])->where('date', $v['date'])
                ->where('work_shift_id', '!=', $v['work_shift_id'])->get();
            foreach ($others as $o) {
                $oStart = $fmtT($o->custom_start_time ?: $o->workShift?->start_time);
                $oEnd = $fmtT($o->custom_end_time ?: $o->workShift?->end_time);
                if (!$oStart || !$oEnd) continue;
                $os = Carbon::parse($v['date'] . ' ' . $oStart);
                $oe = Carbon::parse($v['date'] . ' ' . $oEnd);
                if ($oe->lte($os)) $oe->addDay();
                if ($start->lt($oe) && $os->lt($end)) {
                    throw new \RuntimeException('NV ' . $emp->full_name . ' đã có ca "' . ($o->workShift?->name ?? '') . '" chồng giờ ngày ' . Carbon::parse($v['date'])->format('d/m') . '.');
                }
            }
        }
        $weekday = ((int) Carbon::parse($v['date'])->dayOfWeek + 6) % 7; // 0=Thứ 2
        $cap = WorkShiftCapacity::where('work_shift_id', $v['work_shift_id'])
            ->where('weekday', $weekday)
            ->lockForUpdate()
            ->first();
        if ($cap && $cap->max_staff !== null) {
            // Audit 2026-10-23 A1-16: sức chứa tính THEO CHI NHÁNH của dòng lịch
            // (ca dùng chung nhiều CN không còn cộng dồn toàn hệ thống)
            $cnt = WorkSchedule::where('work_shift_id', $v['work_shift_id'])
                ->where('date', $v['date'])
                ->where('employee_id', '!=', $v['employee_id'])
                ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
                ->count();
            if ($cnt >= $cap->max_staff) {
                $d = Carbon::parse($v['date'])->format('d/m');
                throw new \RuntimeException('Ca ' . ($shift?->name ?? '') . ' ngày ' . $d . ' đã đủ ' . $cap->max_staff . ' người.');
            }
        }
        return WorkSchedule::updateOrCreate(
            ['employee_id' => $v['employee_id'], 'work_shift_id' => $v['work_shift_id'], 'date' => $v['date']],
            [
                'branch_id' => $branchId,
                'custom_start_time' => $v['custom_start_time'] ?? null,
                'custom_end_time' => $v['custom_end_time'] ?? null,
                'created_by' => $createdBy,
            ]
        );
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $sched = WorkSchedule::findOrFail($id);
        if (!$this->scheduleInScope($request->user(), $sched)) {
            return response()->json(['success' => false, 'message' => 'Dòng lịch thuộc chi nhánh bạn không được phân công.'], 403);
        }
        $sched->delete();
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
