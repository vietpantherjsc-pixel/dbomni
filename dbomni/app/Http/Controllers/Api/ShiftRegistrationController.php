<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Setting;
use App\Models\ShiftRegistration;
use App\Models\ShiftRegWeek;
use App\Models\WorkShift;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 35: Đăng ký ca — NV chỉ thấy/sửa của chính mình; admin xem theo tuần/chi nhánh.
class ShiftRegistrationController extends Controller
{
    // Gói 37: hạn chót đăng ký = thứ + giờ đã cài, tính trong TUẦN TRƯỚC tuần mục tiêu.
    // VD: tuần mục tiêu 12/10 (T2), cài Thứ 7 20:00 → hạn = 10/10 20:00.
    public static function deadlineForWeek(Carbon $monday): Carbon
    {
        $wd = (int) Setting::get('shift_reg_deadline_weekday', '5');
        if ($wd < 0 || $wd > 6) $wd = 5;
        $tm = (string) Setting::get('shift_reg_deadline_time', '20:00');
        if (!preg_match('/^(\d{1,2}):(\d{2})$/', trim($tm), $m)) {
            $h = 20;
            $mi = 0;
        } else {
            $h = min(23, (int) $m[1]);
            $mi = min(59, (int) $m[2]);
        }
        return $monday->copy()->subWeek()->addDays($wd)->setTime($h, $mi, 0);
    }
    // NV lấy ca khả dụng trong khoảng ngày (theo chi nhánh của mình)
    public function availableShifts(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $branchIds = $emp->allBranchIds();
        $shifts = WorkShift::where('is_active', true)
            ->where(function ($q) use ($branchIds) {
                $q->whereNull('branch_id');
                if (!empty($branchIds)) $q->orWhereIn('branch_id', $branchIds);
            })
            ->orderBy('sort_order')->orderBy('id')->get();
        return response()->json(['success' => true, 'data' => $shifts]);
    }

    // NV lấy đăng ký của mình trong tuần (week = ngày Thứ 2, Y-m-d)
    public function myWeek(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        // audit #12: validate tham số week
        $v = $request->validate(['week' => 'nullable|date']);
        $monday = Carbon::parse($v['week'] ?? now()->startOfWeek()->toDateString())->startOfWeek();
        $days = [];
        for ($i = 0; $i < 7; $i++) $days[] = $monday->copy()->addDays($i)->toDateString();
        $regs = ShiftRegistration::with('workShift:id,name,start_time,end_time')
            ->where('employee_id', $emp->id)
            ->whereIn('date', $days)->get()
            // audit #9: map date về Y-m-d (đừng để "2026-10-12 00:00:00" như Gói 35d)
            ->map(function ($r) {
                $a = $r->toArray();
                $a['date'] = $r->date->toDateString();
                return $a;
            })
            ->groupBy('date');
        // Gói 37: thông tin hạn chót + lượt gửi còn lại
        $deadline = self::deadlineForWeek($monday);
        $submitCount = (int) (ShiftRegWeek::where('employee_id', $emp->id)
            ->where('week_start', $days[0])->value('submit_count') ?? 0);
        $submitsLeft = max(0, 2 - $submitCount);
        return response()->json([
            'success' => true,
            'data' => [
                'week_start' => $days[0],
                'week_end' => $days[6],
                'days' => $days,
                'registrations' => $regs,
                'deadline_at' => $deadline->format('Y-m-d H:i'),
                'submit_count' => $submitCount,
                'submits_left' => $submitsLeft,
                'can_submit' => now()->lt($deadline) && $submitsLeft > 0,
            ],
        ]);
    }

    // NV nộp/lưu nháp đăng ký cả tuần (ghi đè đăng ký tuần đó của mình)
    public function submitWeek(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'week' => 'required|date',
            'status' => 'required|in:draft,submitted',
            'selections' => 'required|array',
            'selections.*.work_shift_id' => 'required|exists:work_shifts,id',
            'selections.*.date' => 'required|date',
        ]);
        $monday = Carbon::parse($v['week'])->startOfWeek();
        $days = [];
        for ($i = 0; $i < 7; $i++) $days[] = $monday->copy()->addDays($i)->toDateString();

        // Gói 37: quá hạn → chặn cả lưu nháp lẫn gửi
        $deadline = self::deadlineForWeek($monday);
        if (now()->gt($deadline)) {
            return response()->json(['success' => false, 'message' => 'Đã quá hạn đăng ký ca tuần này.'], 422);
        }
        // Gói 37: gửi xong được gửi lại 1 lần (tối đa 2 lượt GỬI); draft không tính
        // audit #13: check + increment submit_count trong transaction với lockForUpdate
        // để 2 request gửi đồng thời không vượt quá 2 lượt
        if ($v['status'] === 'submitted') {
            $ok = DB::transaction(function () use ($emp, $days) {
                $rw = ShiftRegWeek::where('employee_id', $emp->id)
                    ->where('week_start', $days[0])
                    ->lockForUpdate()
                    ->first();
                if (!$rw) {
                    $rw = ShiftRegWeek::create([
                        'employee_id' => $emp->id,
                        'week_start' => $days[0],
                        'submit_count' => 0,
                    ]);
                }
                if ($rw->submit_count >= 2) return false;
                $rw->increment('submit_count');
                return true;
            });
            if (!$ok) {
                return response()->json(['success' => false, 'message' => 'Đã hết lượt gửi lại đăng ký ca tuần này.'], 422);
            }
        }

        DB::transaction(function () use ($emp, $days, $v) {
            // CC-R2: chỉ xóa dòng chưa duyệt — giữ nguyên dòng đã approved
            // (quyết định duyệt của quản lý không bị hủy âm thầm)
            $approvedKeys = ShiftRegistration::where('employee_id', $emp->id)
                ->whereIn('date', $days)
                ->where('status', 'approved')
                ->get(['work_shift_id', 'date'])
                ->map(fn ($r) => $r->work_shift_id . '|' . $r->date)
                ->flip()
                ->toArray();
            ShiftRegistration::where('employee_id', $emp->id)
                ->whereIn('date', $days)
                ->where('status', '!=', 'approved')
                ->delete();
            $rows = [];
            $now = now();
            foreach ($v['selections'] as $s) {
                if (!in_array($s['date'], $days, true)) continue;
                // Bỏ qua selection trùng dòng đã duyệt (không ghi đè)
                if (isset($approvedKeys[$s['work_shift_id'] . '|' . $s['date']])) continue;
                $rows[] = [
                    'employee_id' => $emp->id,
                    'work_shift_id' => $s['work_shift_id'],
                    'date' => $s['date'],
                    'status' => $v['status'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            // unique(employee, shift, date): loại trùng lặp trong payload
            $seen = [];
            $rows = array_values(array_filter($rows, function ($r) use (&$seen) {
                $k = $r['work_shift_id'] . '|' . $r['date'];
                if (isset($seen[$k])) return false;
                $seen[$k] = true;
                return true;
            }));
            if (!empty($rows)) ShiftRegistration::insert($rows);
        });

        $msg = $v['status'] === 'submitted' ? 'Đã gửi đăng ký ca.' : 'Đã lưu nháp.';
        return response()->json(['success' => true, 'message' => $msg]);
    }

    // Admin: xem đăng ký theo tuần + chi nhánh (gộp theo NV)
    public function adminWeek(Request $request): JsonResponse
    {
        $v = $request->validate([
            'week' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        $monday = Carbon::parse($v['week'])->startOfWeek();
        $days = [];
        for ($i = 0; $i < 7; $i++) $days[] = $monday->copy()->addDays($i)->toDateString();

        $q = ShiftRegistration::with(['employee:id,full_name,branch_id', 'workShift:id,name,start_time,end_time'])
            ->whereIn('date', $days)
            // audit #16: loại bản nháp — admin chỉ xem submitted/approved/rejected
            ->whereIn('status', ['submitted', 'approved', 'rejected']);
        if (!empty($v['branch_id'])) {
            $q->whereHas('employee', function ($qq) use ($v) {
                $qq->where('branch_id', $v['branch_id']);
            });
        }
        $regs = $q->orderBy('date')->get()->map(function ($r) {
            // Gói 35d: date cast serialize thành "Y-m-d H:i:s" làm lưới admin
            // so khớp Y-m-d thất bại → trả về Y-m-d cho đúng
            $a = $r->toArray();
            $a['date'] = $r->date->toDateString();
            return $a;
        });
        return response()->json([
            'success' => true,
            'data' => ['week_start' => $days[0], 'week_end' => $days[6], 'days' => $days, 'registrations' => $regs],
        ]);
    }

    // B2: duyệt đăng ký ca (chỉ khi đang chờ)
    public function approve(Request $request, int $id): JsonResponse
    {
        $reg = ShiftRegistration::findOrFail($id);
        if ($reg->status !== 'submitted') {
            return response()->json(['success' => false, 'message' => 'Chỉ duyệt được đăng ký đang chờ.'], 422);
        }
        $reg->status = 'approved';
        $reg->save();
        return response()->json(['success' => true, 'message' => 'Đã duyệt đăng ký ca.']);
    }

    // Gói 41: duyệt + tự động xếp NV vào ca (dùng trên bảng Xếp ca).
    // Gán ca trước (kiểm tra sức chứa), gán OK mới duyệt → không bị duyệt mà rớt ca.
    public function approveAndAssign(Request $request, int $id): JsonResponse
    {
        $reg = ShiftRegistration::with('employee:id,branch_id')->findOrFail($id);
        if ($reg->status !== 'submitted') {
            return response()->json(['success' => false, 'message' => 'Chỉ duyệt được đăng ký đang chờ.'], 422);
        }
        // Dùng chung logic gán ca (có kiểm tra sức chứa trong transaction)
        $assignReq = Request::create('/api/work-schedules/assign', 'POST', [
            'employee_id' => $reg->employee_id,
            'work_shift_id' => $reg->work_shift_id,
            'date' => $reg->date instanceof Carbon ? $reg->date->toDateString() : (string) $reg->date,
            'branch_id' => $reg->employee?->branch_id,
        ]);
        $assignReq->setUserResolver(fn () => $request->user());
        $res = app(WorkScheduleController::class)->assign($assignReq);
        if ($res->getStatusCode() !== 200) {
            return $res; // lỗi (VD vượt sức chứa) → giữ nguyên chưa duyệt
        }
        $reg->status = 'approved';
        $reg->save();
        return response()->json(['success' => true, 'message' => 'Đã duyệt và xếp ca.']);
    }

    // B2: từ chối đăng ký ca (chỉ khi đang chờ). Chưa có cột lưu lý do → note chỉ validate, không lưu.
    public function reject(Request $request, int $id): JsonResponse
    {
        $v = $request->validate(['note' => 'nullable|string|max:500']);
        $reg = ShiftRegistration::findOrFail($id);
        if ($reg->status !== 'submitted') {
            return response()->json(['success' => false, 'message' => 'Chỉ từ chối được đăng ký đang chờ.'], 422);
        }
        $reg->status = 'rejected';
        $reg->save();
        return response()->json(['success' => true, 'message' => 'Đã từ chối đăng ký ca.']);
    }
}
