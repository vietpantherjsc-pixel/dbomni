<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Bonus;
use App\Models\Employee;
use App\Models\EmployeeInsurance;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\SalaryAdvance;
use App\Models\SalaryDay;
use App\Models\SalaryDeduction;
use App\Models\SalaryRecord;
use App\Models\Setting;
use App\Models\Violation;
use App\Models\WageLevel;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 26: Lương theo giờ — tổng giờ công × đơn giá giờ + phụ cấp ăn + thưởng lễ − ứng lương.
class SalaryController extends Controller
{
    // ---------- Bảng lương tháng (theo mẫu Excel của Đại Vương) ----------
    // GET /api/salary/{employee}?month=YYYY-MM
    public function show(Request $request, int $id): JsonResponse
    {
        $emp = Employee::with(['role:id,name', 'insurance'])->findOrFail($id);
        $month = $request->string('month', Carbon::now()->format('Y-m'))->toString();
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (YYYY-MM).'], 422);
        }

        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        $end = $start->copy()->endOfMonth();
        $daysInMonth = $start->daysInMonth;

        $record = SalaryRecord::where('employee_id', $id)->where('month', $month)->first();

        // Ngày lễ trong tháng (mỗi ngày có hệ số riêng) — Gói 30
        $holidays = Holiday::whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->orderBy('date')->get()
            ->keyBy(fn ($h) => $h->date->format('Y-m-d'));

        // Chi tiết từng ngày (Gói 55: 1 ngày có thể nhiều dòng theo CN → gộp để tính tổng)
        $days = SalaryDay::with('branch:id,name')->where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->orderBy('date')->orderBy('branch_id')
            ->get()->groupBy(fn ($d) => $d->date->format('Y-m-d'));
        $dayRows = [];
        for ($d = 1; $d <= $daysInMonth; $d++) {
            $key = sprintf('%s-%02d', $month, $d);
            $rows = $days->get($key);
            $hol = $holidays->get($key);
            if (!$rows || $rows->isEmpty()) {
                $dayRows[] = [
                    'key' => $key,
                    'date' => $d . '/' . $start->format('m/Y'),
                    'check_in' => null, 'check_out' => null, 'hours' => null,
                    'hours_source' => null, 'meal_count' => 0,
                    'branches' => [],
                    'is_holiday' => (bool) $hol,
                    'holiday_name' => $hol?->name,
                    'multiplier' => $hol ? (float) $hol->multiplier : null,
                ];
                continue;
            }
            // Gộp nhiều CN: cộng giờ, gộp suất ăn, giữ chi tiết từng CN
            $totalH = 0; $hasHours = false; $mealC = 0; $branches = [];
            $firstIn = null; $lastOut = null; $src = null;
            foreach ($rows as $r) {
                if ($r->hours !== null) { $totalH += (float) $r->hours; $hasHours = true; }
                $mealC += (int) ($r->meal_count ?? 0);
                $branches[] = [
                    'branch_id' => $r->branch_id,
                    'branch_name' => $r->branch?->name,
                    'check_in' => $r->check_in, 'check_out' => $r->check_out,
                    'hours' => $r->hours !== null ? (float) $r->hours : null,
                    'hours_source' => $r->hours_source,
                ];
                if ($r->check_in && (!$firstIn || $r->check_in < $firstIn)) $firstIn = $r->check_in;
                if ($r->check_out && (!$lastOut || $r->check_out > $lastOut)) $lastOut = $r->check_out;
                if (!$src) $src = $r->hours_source;
            }
            $dayRows[] = [
                'key' => $key,
                'date' => $d . '/' . $start->format('m/Y'),
                'check_in' => $firstIn, 'check_out' => $lastOut,
                'hours' => $hasHours ? round($totalH, 2) : null,
                'hours_source' => $src,
                'meal_count' => $mealC,
                'branches' => $branches, // chi tiết từng CN
                'is_holiday' => (bool) $hol,
                'holiday_name' => $hol?->name,
                'multiplier' => $hol ? (float) $hol->multiplier : null,
            ];
        }

        // ===== Gói 30: Chính sách lương trách nhiệm (chung toàn chuỗi) =====
        // resp_effective = max(0, base − min(violations, max_violations) × deduction)
        $respBase = (float) Setting::get('resp_base_per_hour', 2000);
        $respDed  = (float) Setting::get('resp_deduction_per_violation', 500);
        $respMax  = (int) Setting::get('resp_max_violations', 4);
        // Gói 40: số lỗi tự động cộng từ bảng violations; quản lý sửa đè khi violation_count NOT NULL
        $violationsAuto = (int) Violation::where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->sum('points');
        $violationsOverride = $record && $record->violation_count !== null;
        $violations = $violationsOverride ? (int) $record->violation_count : $violationsAuto;
        $cappedViol = min($violations, max(0, $respMax));
        $respEffective = max(0.0, $respBase - $cappedViol * $respDed);
        $fmtVnd = fn ($n) => number_format($n, 0, ',', '.');
        $respFormula = $fmtVnd($respBase) . ' − ' . $cappedViol . '×' . $fmtVnd($respDed);
        // Gói 30b: NV tắt "Áp dụng lương trách nhiệm" thì không hưởng khoản này
        $applyResp = (bool) (Employee::where('id', $id)->value('apply_responsibility') ?? true);
        if (!$applyResp) {
            $respEffective = 0.0;
            $respFormula = 'Không áp dụng';
        }

        // A. TỔNG GIỜ CÔNG (ưu tiên tổng từ chi tiết ngày, fallback bản ghi tay cũ)
        $dayHoursTotal = round(array_sum(array_column($dayRows, 'hours')), 2);
        $useDaily = $dayHoursTotal > 0;
        $totalHours = $useDaily ? $dayHoursTotal : (($record ? (float) $record->hours : 0));

        // Mức lương: đơn giá giờ/ngày = hourly_rate (mức tại ngày đó) + resp_effective (chính sách chung).
        // (Gói 30: wage_levels.responsibility_rate theo NV không còn dùng trong tính lương.)
        $levels = WageLevel::where('employee_id', $id)
            ->where('start_date', '<=', $end->toDateString())
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $start->toDateString()))
            ->orderBy('start_date')
            ->get();
        $rateForDate = function (string $dateStr) use ($levels, $respEffective) {
            $hourly = 0.0; $lv = null;
            foreach ($levels as $l) {
                $s = $l->start_date->toDateString();
                $e = $l->end_date ? $l->end_date->toDateString() : '9999-12-31';
                if ($dateStr >= $s && $dateStr <= $e) { $hourly = (float) $l->hourly_rate; $lv = $l; break; }
            }
            return ['level' => $lv, 'hourly' => $hourly, 'rate' => $hourly + $respEffective];
        };

        $base = 0.0; $w3weighted = 0.0;
        $holidayExtra = 0.0; $holidayHours = 0.0; $holidayDays = [];
        $baseLines = [];
        if ($useDaily) {
            $agg = [];
            foreach ($dayRows as $r) {
                $h = $r['hours'];
                if ($h <= 0) continue;
                $rr = $rateForDate($r['key']);
                $rate = $rr['rate'];
                $base += $h * $rate;
                $w3weighted += $h * $rr['hourly'];
                $lid = $rr['level']?->id ?? 0;
                if (!isset($agg[$lid])) $agg[$lid] = ['level' => $rr['level'], 'hourly' => $rr['hourly'], 'hours' => 0];
                $agg[$lid]['hours'] += $h;
                // Lễ: chỉ NV đi làm ngày đó mới được hưởng, hệ số riêng từng ngày
                if ($r['is_holiday']) {
                    $extra = $h * max(0, $r['multiplier'] - 1) * $rate;
                    $holidayExtra += $extra;
                    $holidayHours += $h;
                    $holidayDays[] = [
                        'date' => $r['date'], 'name' => $r['holiday_name'],
                        'multiplier' => $r['multiplier'], 'hours' => $h, 'extra' => round($extra),
                    ];
                }
            }
            foreach ($agg as $a) {
                $rt = $a['hourly'] + $respEffective;
                $baseLines[] = [
                    'hourly_rate' => $a['hourly'],
                    'responsibility_rate' => $respEffective,
                    'rate_total' => $rt,
                    'from' => $a['level']?->start_date?->toDateString(),
                    'to' => $a['level']?->end_date?->toDateString(),
                    'days' => null,
                    'hours' => round($a['hours'], 2),
                    'amount' => round($a['hours'] * $rt),
                ];
            }
        } else {
            // Fallback cũ: không có chi tiết ngày — chia giờ theo mức lương chồng lấn trong tháng
            foreach ($levels as $lv) {
                $lvStart = max($lv->start_date->toDateString(), $start->toDateString());
                $lvEnd = $lv->end_date ? min($lv->end_date->toDateString(), $end->toDateString()) : $end->toDateString();
                $overlapDays = Carbon::parse($lvStart)->diffInDays(Carbon::parse($lvEnd)) + 1;
                $portion = $daysInMonth > 0 ? $totalHours * $overlapDays / $daysInMonth : 0;
                $rate = (float) $lv->hourly_rate + $respEffective;
                $base += $portion * $rate;
                $w3weighted += $portion * (float) $lv->hourly_rate;
                $baseLines[] = [
                    'hourly_rate' => (float) $lv->hourly_rate,
                    'responsibility_rate' => $respEffective,
                    'rate_total' => $rate,
                    'from' => $lvStart, 'to' => $lvEnd, 'days' => $overlapDays,
                    'hours' => round($portion, 2), 'amount' => round($portion * $rate),
                ];
            }
            // Lễ fallback: dùng giờ lễ nhập tay cũ
            $holidayHours = (float) ($record->holiday_hours ?? 0);
            $avgRate = $totalHours > 0 ? $base / $totalHours : 0;
            $avgMult = $holidays->count() > 0 ? (float) $holidays->avg('multiplier') : 2.0;
            $holidayExtra = $holidayHours * $avgRate * max(0, $avgMult - 1);
            if ($holidayHours > 0) {
                $holidayDays[] = [
                    'date' => '', 'name' => 'Giờ lễ (nhập tay)',
                    'multiplier' => $avgMult, 'hours' => $holidayHours, 'extra' => round($holidayExtra),
                ];
            }
        }
        // 2. trách nhiệm/h (chính sách chung) ; 3. cơ bản/h (bình quân gia quyền) ; 4. = 2+3
        $w2 = $respEffective;
        $w3 = $totalHours > 0 ? $w3weighted / $totalHours : 0;
        $w4 = $w2 + $w3;

        // Phụ cấp ăn: tổng suất X theo ngày × mức/suất
        $mealAmount = (float) Setting::get('meal_price', Setting::get('meal_allowance_amount', 25000));
        $mealTotal = 0;
        foreach ($dayRows as $r) $mealTotal += $r['meal_count'] * $mealAmount;

        // Thưởng / Ứng lương trong tháng
        $bonuses = Bonus::where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])->get();
        $bonusTotal = (float) $bonuses->sum('amount');
        $advances = SalaryAdvance::where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])->get();
        $advanceTotal = (float) $advances->sum('amount');

        // 1. Các khoản trừ khác — Gói 40: tổng danh sách salary_deductions (cột cũ giữ lại, không dùng)
        $deductions = SalaryDeduction::where('employee_id', $id)->where('month', $month)
            ->orderBy('sort_order')->orderBy('id')->get();
        $otherDeduction = (float) $deductions->sum('amount');
        $otherDeductionNote = $deductions->map(fn ($d) => $d->name . ($d->note ? ' (' . $d->note . ')' : ''))->implode('; ');

        // D. BHXH
        $ins = $emp->insurance && $emp->insurance->is_active ? $emp->insurance : null;
        $rBhxh = (float) Setting::get('bhxh_emp_bhxh', 8);
        $rBhyt = (float) Setting::get('bhxh_emp_bhyt', 1.5);
        $rBhtn = (float) Setting::get('bhxh_emp_bhtn', 1);
        $rEmployer = (float) Setting::get('bhxh_employer_rate', 21.5);
        $empRate = $rBhxh + $rBhyt + $rBhtn;
        $insurance = null;
        $insuranceDeduct = 0;
        if ($ins) {
            $baseAmt = (float) $ins->base_amount;
            $empPart = $baseAmt * $empRate / 100;
            $employerPart = $baseAmt * $rEmployer / 100;
            $deduct = $ins->employer_pays_all ? 0 : $empPart;
            $insuranceDeduct = $deduct;
            $insurance = [
                'base_amount' => $baseAmt,
                'employer_pays_all' => (bool) $ins->employer_pays_all,
                'employee_rate' => $empRate,
                'employer_rate' => $rEmployer,
                'details' => [
                    ['label' => '8. BHXH (' . $rBhxh . '%)', 'amount' => round($baseAmt * $rBhxh / 100)],
                    ['label' => '9. BHYT (' . $rBhyt . '%)', 'amount' => round($baseAmt * $rBhyt / 100)],
                    ['label' => '10. BHTN (' . $rBhtn . '%)', 'amount' => round($baseAmt * $rBhtn / 100)],
                ],
                'employee_total' => round($empPart),
                'employer_total' => round($employerPart),
                'deducted' => round($deduct),
            ];
        }

        // B. LƯƠNG = A × 4  ;  C. THỰC NHẬN
        $gross = round($base);
        $net = $gross + round($mealTotal) + round($holidayExtra) + round($bonusTotal)
             - round($advanceTotal) - round($otherDeduction) - round($insuranceDeduct);

        return response()->json(['success' => true, 'data' => [
            'employee' => $emp,
            'month' => $month,
            'month_label' => 'THÁNG ' . $start->format('m/y'),
            'record' => $record,
            'days' => $dayRows,
            'summary' => [
                'total_hours' => $totalHours,
                'line1_deduction' => round($otherDeduction),
                'line1_note' => $otherDeductionNote,
                'line2_responsibility' => round($w2),
                'resp_formula' => $respFormula,
                'resp_base' => $respBase,
                'resp_deduction' => $respDed,
                'resp_max' => $respMax,
                'violations' => $violations,
                'violations_auto' => $violationsAuto, // Gói 40: tự cộng từ violations
                'violations_override' => (bool) $violationsOverride, // Gói 40: đang đè tay?
                'violation_note' => $record->violation_note ?? '',
                'line3_base_rate' => round($w3),
                'line4_rate' => round($w4),
                'gross' => $gross,
                'meal_total' => round($mealTotal),
                'meal_count_total' => array_sum(array_column($dayRows, 'meal_count')),
                'meal_price' => $mealAmount,
                'meal_amount' => $mealAmount,
                'holiday_extra' => round($holidayExtra),
                'holiday_hours' => $holidayHours,
                'holiday_days' => $holidayDays,
                'bonus_total' => round($bonusTotal),
                'advance_total' => round($advanceTotal),
                'net' => $net,
            ],
            'base_lines' => $baseLines,
            'bonuses' => $bonuses,
            'advances' => $advances,
            'deductions' => $deductions->map(fn ($d) => [ // Gói 40
                'id' => $d->id, 'name' => $d->name,
                'amount' => (float) $d->amount, 'note' => $d->note,
            ])->values(),
            'deductions_total' => round($otherDeduction), // Gói 40
            'insurance' => $insurance,
            'holidays_in_month' => $holidays,
        ]]);
    }

    // ---------- Giờ công tháng (nhập tay) ----------
    public function saveRecord(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'hours' => 'required|numeric|min:0|max:744',
            'work_days' => 'nullable|integer|min:0|max:31',
            'holiday_hours' => 'nullable|numeric|min:0|max:744',
            'other_deduction' => 'nullable|numeric|min:0',
            'other_deduction_note' => 'nullable|string|max:255',
            'note' => 'nullable|string|max:255',
        ]);
        $rec = SalaryRecord::updateOrCreate(
            ['employee_id' => $id, 'month' => $validated['month']],
            ['hours' => $validated['hours'], 'work_days' => $validated['work_days'] ?? 0,
             'holiday_hours' => $validated['holiday_hours'] ?? 0,
             'other_deduction' => $validated['other_deduction'] ?? 0,
             'other_deduction_note' => $validated['other_deduction_note'] ?? null,
             'note' => $validated['note'] ?? null]
        );
        return response()->json(['success' => true, 'data' => $rec]);
    }

    // ---------- Chi tiết ngày công ----------
    // GET /api/salary/{employee}/days?month=YYYY-MM
    public function getDays(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $month = $request->string('month', Carbon::now()->format('Y-m'))->toString();
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01');
        $end = $start->copy()->endOfMonth();
        // Gói 55: load kèm chi nhánh, 1 ngày có thể nhiều dòng (mỗi CN 1 dòng)
        $days = SalaryDay::with('branch:id,name')
            ->where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->orderBy('date')->orderBy('branch_id')
            ->get()->groupBy(fn ($d) => $d->date->format('Y-m-d'));
        $out = [];
        for ($d = 1; $d <= $start->daysInMonth; $d++) {
            $key = sprintf('%s-%02d', $month, $d);
            $rows = $days->get($key);
            if (!$rows || $rows->isEmpty()) {
                $out[] = [
                    'date' => $key,
                    'check_in' => null, 'check_out' => null,
                    'hours' => null, 'hours_source' => null,
                    'meal_count' => 0, 'meal_manual' => false,
                    'branch_id' => null, 'branch_name' => null,
                ];
            } else {
                foreach ($rows as $r) {
                    $out[] = [
                        'date' => $key,
                        'check_in' => $r->check_in, 'check_out' => $r->check_out,
                        'hours' => $r->hours !== null ? (float) $r->hours : null,
                        'hours_source' => $r->hours_source,
                        'meal_count' => (int) ($r->meal_count ?? 0),
                        'meal_manual' => (bool) ($r->meal_manual ?? false),
                        'branch_id' => $r->branch_id,
                        'branch_name' => $r->branch?->name,
                    ];
                }
            }
        }
        // Gói 30d: trả kèm cấu hình suất ăn để frontend tự tính live
        return response()->json(['success' => true, 'data' => $out, 'meta' => [
            'meal_min_hours' => (float) Setting::get('meal_min_hours', 14.5),
            'meal_price' => (float) Setting::get('meal_price', Setting::get('meal_allowance_amount', 25000)),
        ]]);
    }

    // POST /api/salary/{employee}/days  { month, days: [{date, branch_id, check_in, check_out, hours, meal_count}] }
    public function saveDays(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        $validated = $request->validate([
            'days' => 'required|array',
            'days.*.date' => 'required|date',
            'days.*.branch_id' => 'nullable|exists:branches,id',
            'days.*.check_in' => 'nullable|string|max:5',
            'days.*.check_out' => 'nullable|string|max:5',
            'days.*.hours' => 'nullable|numeric|min:0|max:24',
            'days.*.meal_count' => 'nullable|integer|min:0|max:10',
            'days.*.meal_manual' => 'nullable|boolean',
        ]);
        // Gói 30d: ngưỡng giờ tự tính suất ăn
        $mealThreshold = (float) Setting::get('meal_min_hours', 14.5);
        DB::transaction(function () use ($id, $emp, $validated, $mealThreshold) {
            foreach ($validated['days'] as $d) {
                $ci = !empty($d['check_in']) ? substr($d['check_in'], 0, 5) : null;
                $co = !empty($d['check_out']) ? substr($d['check_out'], 0, 5) : null;
                // Gói 55: chi nhánh của dòng (mặc định CN chính của NV)
                $brId = !empty($d['branch_id']) ? (int) $d['branch_id'] : $emp->branch_id;
                // Giữ null (ô trống) thay vì ép về 0 — quên chấm công thì để trống
                $hours = ($d['hours'] === null || $d['hours'] === '') ? null : (float) $d['hours'];
                // Tự tính giờ từ giờ vào/ra nếu không nhập tay
                if ($hours === null && $ci && $co) {
                    try {
                        $in = Carbon::createFromFormat('H:i', $ci);
                        $out = Carbon::createFromFormat('H:i', $co);
                        if ($out->lessThan($in)) $out->addDay(); // ca qua đêm
                        $hours = round($in->diffInMinutes($out) / 60, 2);
                    } catch (\Exception $e) { /* giữ null */ }
                }
                // Gói 30d: suất ăn — chỉnh tay thì giữ nguyên, không thì tự tính (>= ngưỡng giờ = 1 suất)
                $mealManual = !empty($d['meal_manual']);
                $mealCount = $mealManual ? (int) ($d['meal_count'] ?? 0)
                    : (($hours !== null && $hours >= $mealThreshold) ? 1 : 0);
                $ex = SalaryDay::where('employee_id', $id)->where('date', $d['date'])->where('branch_id', $brId)->first();
                // Chỉ lưu ngày có dữ liệu; ngày trắng thì xóa
                if (!$ci && !$co && $hours === null && !$mealCount) {
                    if ($ex) $ex->delete();
                    continue;
                }
                // Có thay đổi so với DB → đánh dấu nhập tay,
                // để lần "đổ giờ công từ chấm công" sau không ghi đè
                $dirty = !$ex
                    || $ex->check_in !== $ci
                    || $ex->check_out !== $co
                    || (float) ($ex->hours ?? 0) !== (float) ($hours ?? 0)
                    || (int) $ex->meal_count !== $mealCount
                    || (bool) $ex->meal_manual !== $mealManual;
                SalaryDay::updateOrCreate(
                    ['employee_id' => $id, 'date' => $d['date'], 'branch_id' => $brId],
                    ['check_in' => $ci, 'check_out' => $co,
                     'hours' => $hours, 'meal_count' => $mealCount, 'meal_manual' => $mealManual,
                     'hours_source' => $dirty ? 'manual' : $ex->hours_source]
                );
            }
        });
        return response()->json(['success' => true, 'message' => 'Đã lưu chi tiết ngày công.']);
    }

    // ---------- Đổ giờ công từ chấm công vào bảng lương ----------
    // POST /api/salary/import-attendance  { month: YYYY-MM, branch_id? }
    // Quy tắc (Đại Vương chốt):
    //  1. Nguồn giờ = giờ chấm thực tế (check-in/out), KHÔNG dùng giờ ca xếp.
    //  2. Quên chấm (thiếu check-in hoặc check-out) → giờ = null (để trống), quản lý nhập tay sau.
    //  3. Vượt giờ ca → tính lương thường x1 (giờ thực tế, không hệ số riêng).
    //  4. Ngày nghỉ được duyệt → giờ = 0, hours_source = 'leave'.
    //  5. Không ghi đè ô đã nhập tay (hours_source = 'manual', hoặc null + đã có dữ liệu).
    // Nhiều bản ghi chấm công cùng ngày (làm 2 chi nhánh): lấy check-in sớm nhất + check-out muộn nhất.
    public function importAttendance(Request $request): JsonResponse
    {
        $v = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        $month = $v['month'];
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        $end = $start->copy()->endOfMonth();
        $daysInMonth = $start->daysInMonth;
        $from = $start->toDateString();
        $to = $end->toDateString();

        // NV đang làm trong kỳ: kích hoạt + ngày vào làm không sau cuối tháng
        $empQ = Employee::where('is_active', true)
            ->where(fn ($q) => $q->whereNull('start_date')->orWhere('start_date', '<=', $to));
        if (!empty($v['branch_id'])) $empQ->where('branch_id', $v['branch_id']);
        $employees = $empQ->orderBy('full_name')->get(['id', 'full_name', 'branch_id']);
        $empIds = $employees->pluck('id');

        // (Gói 55: $attsByBranch và $existingByBranch được định nghĩa bên dưới)

        // Ngày nghỉ được duyệt → map NV|ngày
        $leaveMap = [];
        LeaveRequest::where('status', 'approved')
            ->whereIn('employee_id', $empIds)
            ->where('date_from', '<=', $to)
            ->where(fn ($q) => $q->whereNull('date_to')->orWhere('date_to', '>=', $from))
            ->get(['employee_id', 'date_from', 'date_to'])
            ->each(function ($lv) use (&$leaveMap, $from, $to) {
                $d = max($lv->date_from->toDateString(), $from);
                $last = $lv->date_to ? min($lv->date_to->toDateString(), $to) : $to;
                for ($c = $d; $c <= $last; $c = date('Y-m-d', strtotime($c . ' +1 day'))) {
                    $leaveMap[$lv->employee_id . '|' . $c] = true;
                }
            });

        $mealThreshold = (float) Setting::get('meal_min_hours', 14.5);

        $summary = [
            'employees' => $employees->count(),
            'imported' => 0,       // đổ giờ đầy đủ
            'leave' => 0,          // ngày nghỉ được duyệt
            'incomplete' => 0,     // thiếu check-in/out → để trống
            'skipped_manual' => 0, // giữ nguyên ô nhập tay
        ];
        $missing = []; // chi tiết ngày thiếu chấm để quản lý nhập tay

        // Gói 55: gom chấm công theo NV|ngày|chi nhánh (tách riêng từng CN)
        $attsByBranch = Attendance::whereBetween('date', [$from, $to])
            ->whereIn('employee_id', $empIds)
            ->when(!empty($v['branch_id']), fn ($q) => $q->where('branch_id', $v['branch_id']))
            ->get()
            ->groupBy(fn ($a) => $a->employee_id . '|' . $a->date->toDateString() . '|' . $a->branch_id);

        // Dòng lương hiện có (theo NV|ngày|CN mới)
        $existingByBranch = SalaryDay::whereIn('employee_id', $empIds)
            ->whereBetween('date', [$from, $to])->get()
            ->groupBy(fn ($s) => $s->employee_id . '|' . $s->date->toDateString() . '|' . ($s->branch_id ?? ''));

        DB::transaction(function () use (
            $employees, $daysInMonth, $month, $attsByBranch, $leaveMap, $existingByBranch,
            $mealThreshold, &$summary, &$missing
        ) {
            foreach ($employees as $emp) {
                for ($d = 1; $d <= $daysInMonth; $d++) {
                    $dateStr = sprintf('%s-%02d', $month, $d);
                    $leaveKey = $emp->id . '|' . $dateStr;

                    // Nghỉ được duyệt → 0 giờ (1 dòng cho CN chính)
                    if (isset($leaveMap[$leaveKey])) {
                        $exKey = $emp->id . '|' . $dateStr . '|' . $emp->branch_id;
                        $ex = $existingByBranch->get($exKey)?->first();
                        $isManual = $ex && ($ex->hours_source === 'manual'
                            || ($ex->hours_source === null
                                && ($ex->hours > 0 || $ex->check_in || $ex->check_out)));
                        if (!$isManual) {
                            SalaryDay::updateOrCreate(
                                ['employee_id' => $emp->id, 'date' => $dateStr, 'branch_id' => $emp->branch_id],
                                ['check_in' => null, 'check_out' => null, 'hours' => 0,
                                 'hours_source' => 'leave',
                                 'meal_count' => $ex && $ex->meal_manual ? (int) $ex->meal_count : 0,
                                 'meal_manual' => (bool) ($ex->meal_manual ?? false)]
                            );
                            $summary['leave']++;
                        } else {
                            $summary['skipped_manual']++;
                        }
                        continue;
                    }

                    // Duyệt từng chi nhánh có chấm công trong ngày
                    $hasAtt = false;
                    foreach ($attsByBranch as $groupKey => $dayAtts) {
                        [$eId, $dt, $brId] = explode('|', $groupKey);
                        if ((int) $eId !== (int) $emp->id || $dt !== $dateStr) continue;
                        $hasAtt = true;
                        $brId = $brId !== '' ? (int) $brId : $emp->branch_id;

                        $exKey = $emp->id . '|' . $dateStr . '|' . $brId;
                        $ex = $existingByBranch->get($exKey)?->first();

                        // Không ghi đè ô nhập tay
                        $isManual = $ex && ($ex->hours_source === 'manual'
                            || ($ex->hours_source === null
                                && ($ex->hours > 0 || $ex->check_in || $ex->check_out)));
                        if ($isManual) { $summary['skipped_manual']++; continue; }

                        // Vào sớm nhất + ra muộn nhất TRONG chi nhánh này
                        $in = $dayAtts->whereNotNull('check_in')
                            ->sortBy(fn ($a) => $a->check_in->timestamp)->first()?->check_in;
                        $out = $dayAtts->whereNotNull('check_out')
                            ->sortByDesc(fn ($a) => $a->check_out->timestamp)->first()?->check_out;
                        $inStr = $in ? Carbon::parse($in)->format('H:i') : null;
                        $outStr = $out ? Carbon::parse($out)->format('H:i') : null;

                        if ($in && $out) {
                            $hours = round(Carbon::parse($in)->diffInMinutes($out) / 60, 2);
                            $summary['imported']++;
                        } else {
                            $hours = null;
                            $summary['incomplete']++;
                            $missing[] = ['employee' => $emp->full_name, 'date' => $dateStr, 'branch_id' => $brId];
                        }

                        $mealManual = (bool) ($ex->meal_manual ?? false);
                        $mealCount = $mealManual
                            ? (int) ($ex->meal_count ?? 0)
                            : (($hours !== null && $hours >= $mealThreshold) ? 1 : 0);

                        SalaryDay::updateOrCreate(
                            ['employee_id' => $emp->id, 'date' => $dateStr, 'branch_id' => $brId],
                            ['check_in' => $inStr, 'check_out' => $outStr, 'hours' => $hours,
                             'hours_source' => 'attendance',
                             'meal_count' => $mealCount, 'meal_manual' => $mealManual]
                        );
                    }
                    // Không có chấm công ngày này → bỏ qua (giữ nguyên)
                }
            }
        });

        return response()->json(['success' => true, 'data' => $summary + ['missing' => $missing]]);
    }

    // ---------- BHXH ----------
    public function getInsurance(int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $ins = EmployeeInsurance::where('employee_id', $id)->first();
        return response()->json(['success' => true, 'data' => $ins]);
    }

    public function saveInsurance(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'base_amount' => 'required|numeric|min:0',
            'employer_pays_all' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
        ]);
        $ins = EmployeeInsurance::updateOrCreate(
            ['employee_id' => $id],
            ['base_amount' => $validated['base_amount'],
             'employer_pays_all' => $validated['employer_pays_all'] ?? false,
             'is_active' => $validated['is_active'] ?? true]
        );
        return response()->json(['success' => true, 'data' => $ins]);
    }

    public function deleteInsurance(int $id): JsonResponse
    {
        EmployeeInsurance::where('employee_id', $id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa cấu hình BHXH.']);
    }

    // ---------- Mức lương ----------
    public function history(int $id): JsonResponse
    {
        Employee::findOrFail($id);
        return response()->json(['success' => true, 'data' => [
            'wage_levels' => WageLevel::where('employee_id', $id)->orderBy('start_date', 'desc')->get(),
            'advances' => SalaryAdvance::where('employee_id', $id)->orderBy('date', 'desc')->get(),
            'bonuses' => Bonus::where('employee_id', $id)->orderBy('date', 'desc')->get(),
        ]]);
    }

    // Thêm mức mới -> tự set end_date mức cũ = start_date mới − 1 ngày
    public function addWageLevel(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'hourly_rate' => 'required|numeric|min:0',
            'responsibility_rate' => 'nullable|numeric|min:0',
            'start_date' => 'required|date',
            'note' => 'nullable|string|max:255',
        ]);

        $level = DB::transaction(function () use ($id, $validated) {
            WageLevel::where('employee_id', $id)
                ->where(function ($q) use ($validated) {
                    $q->whereNull('end_date')->orWhere('end_date', '>=', $validated['start_date']);
                })
                ->update(['end_date' => Carbon::parse($validated['start_date'])->subDay()->toDateString()]);

            return WageLevel::create([
                'employee_id' => $id,
                'hourly_rate' => $validated['hourly_rate'],
                'responsibility_rate' => $validated['responsibility_rate'] ?? 0,
                'start_date' => $validated['start_date'],
                'end_date' => null,
                'note' => $validated['note'] ?? null,
            ]);
        });

        return response()->json(['success' => true, 'data' => $level], 201);
    }

    public function deleteWageLevel(int $id): JsonResponse
    {
        WageLevel::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa mức lương.']);
    }

    // ---------- Ứng lương ----------
    public function addAdvance(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'amount' => 'required|numeric|min:0',
            'date' => 'required|date',
            'note' => 'nullable|string|max:255',
        ]);
        $adv = SalaryAdvance::create(['employee_id' => $id] + $validated);
        return response()->json(['success' => true, 'data' => $adv], 201);
    }

    public function deleteAdvance(int $id): JsonResponse
    {
        SalaryAdvance::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa khoản ứng lương.']);
    }

    // ---------- Thưởng ----------
    public function addBonus(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'type' => 'required|in:performance,birthday,other',
            'amount' => 'required|numeric|min:0',
            'date' => 'required|date',
            'note' => 'nullable|string|max:255',
        ]);
        $bonus = Bonus::create(['employee_id' => $id] + $validated);
        return response()->json(['success' => true, 'data' => $bonus], 201);
    }

    public function deleteBonus(int $id): JsonResponse
    {
        Bonus::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa khoản thưởng.']);
    }

    // ---------- Ngày lễ ----------
    public function holidays(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => Holiday::orderBy('date')->get()]);
    }

    public function addHoliday(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'date' => 'required|date|unique:holidays,date',
            'name' => 'required|string|max:150',
            'multiplier' => 'nullable|numeric|min:1|max:10',
        ]);
        $h = Holiday::create([
            'date' => $validated['date'],
            'name' => $validated['name'],
            'multiplier' => $validated['multiplier'] ?? 2.0,
        ]);
        return response()->json(['success' => true, 'data' => $h], 201);
    }

    public function deleteHoliday(int $id): JsonResponse
    {
        Holiday::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa ngày lễ.']);
    }

    // ---------- Gói 30: Sửa ngày lễ ----------
    // PATCH /api/holidays/{id}
    public function updateHoliday(Request $request, int $id): JsonResponse
    {
        $h = Holiday::findOrFail($id);
        $validated = $request->validate([
            'date' => 'sometimes|date|unique:holidays,date,' . $id,
            'name' => 'sometimes|string|max:150',
            'multiplier' => 'sometimes|numeric|min:1|max:10',
        ]);
        $h->update($validated);
        return response()->json(['success' => true, 'data' => $h]);
    }

    // ---------- Gói 30: Chính sách lương trách nhiệm (chung) ----------
    // GET /api/salary-policies
    public function getPolicies(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => [
            'resp_base_per_hour' => (float) Setting::get('resp_base_per_hour', 2000),
            'resp_deduction_per_violation' => (float) Setting::get('resp_deduction_per_violation', 500),
            'resp_max_violations' => (int) Setting::get('resp_max_violations', 4),
            'meal_price' => (float) Setting::get('meal_price', Setting::get('meal_allowance_amount', 25000)),
            'meal_min_hours' => (float) Setting::get('meal_min_hours', 14.5),
            // Gói 54: BHXH chuyển từ Thiết lập sang Cấu hình Lương
            'bhxh_emp_bhxh' => (float) Setting::get('bhxh_emp_bhxh', 8),
            'bhxh_emp_bhyt' => (float) Setting::get('bhxh_emp_bhyt', 1.5),
            'bhxh_emp_bhtn' => (float) Setting::get('bhxh_emp_bhtn', 1),
            'bhxh_employer_rate' => (float) Setting::get('bhxh_employer_rate', 21.5),
        ]]);
    }

    // PUT /api/salary-policies
    public function savePolicies(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'resp_base_per_hour' => 'required|numeric|min:0|max:1000000',
            'resp_deduction_per_violation' => 'required|numeric|min:0|max:1000000',
            'resp_max_violations' => 'required|integer|min:0|max:100',
            'meal_price' => 'required|numeric|min:0|max:10000000',
            'meal_min_hours' => 'required|numeric|min:0|max:24',
            'bhxh_emp_bhxh' => 'required|numeric|min:0|max:100',
            'bhxh_emp_bhyt' => 'required|numeric|min:0|max:100',
            'bhxh_emp_bhtn' => 'required|numeric|min:0|max:100',
            'bhxh_employer_rate' => 'required|numeric|min:0|max:100',
        ]);
        foreach ($validated as $k => $v) Setting::set($k, $v);
        return response()->json(['success' => true, 'data' => $validated]);
    }

    // ---------- Gói 30: Số lỗi vi phạm trong tháng ----------
    // PUT /api/salary/{employee}/violations  { month, violation_count (null = xóa đè → về tự động), violation_note }
    public function saveViolations(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'violation_count' => 'nullable|integer|min:0|max:100',
            'violation_note' => 'nullable|string|max:255',
        ]);
        $attrs = ['violation_note' => $validated['violation_note'] ?? null];
        if (array_key_exists('violation_count', $validated)) {
            $attrs['violation_count'] = $validated['violation_count']; // null = xóa đè
        }
        $rec = SalaryRecord::updateOrCreate(
            ['employee_id' => $id, 'month' => $validated['month']],
            $attrs
        );
        return response()->json(['success' => true, 'data' => $rec]);
    }

    // ---------- Gói 40: Khoản trừ khác (danh sách nhiều khoản) ----------
    // GET /api/salary/{employee}/deductions?month=YYYY-MM
    public function listDeductions(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $month = $request->query('month', Carbon::now()->format('Y-m'));
        if (!preg_match('/^\d{4}-\d{2}$/', (string) $month)) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (YYYY-MM).'], 422);
        }
        $items = SalaryDeduction::where('employee_id', $id)->where('month', $month)
            ->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($d) => [
                'id' => $d->id, 'name' => $d->name,
                'amount' => (float) $d->amount, 'note' => $d->note,
            ])->values();
        return response()->json(['success' => true, 'data' => $items]);
    }

    // POST /api/salary/{employee}/deductions
    public function storeDeduction(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $v = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'name' => 'required|string|max:255',
            'amount' => 'required|numeric|min:0|max:999999999',
            'note' => 'nullable|string|max:255',
        ]);
        $maxSort = (int) SalaryDeduction::where('employee_id', $id)->where('month', $v['month'])->max('sort_order');
        $d = SalaryDeduction::create([
            'employee_id' => $id, 'month' => $v['month'], 'name' => $v['name'],
            'amount' => $v['amount'], 'note' => $v['note'] ?? null, 'sort_order' => $maxSort + 1,
        ]);
        return response()->json(['success' => true, 'data' => $d], 201);
    }

    // PUT /api/salary/deductions/{id}
    public function updateDeduction(Request $request, int $id): JsonResponse
    {
        $d = SalaryDeduction::findOrFail($id);
        $v = $request->validate([
            'name' => 'nullable|string|max:255',
            'amount' => 'nullable|numeric|min:0|max:999999999',
            'note' => 'nullable|string|max:255',
        ]);
        $d->fill(array_filter($v, fn ($x) => $x !== null));
        $d->save();
        return response()->json(['success' => true, 'data' => $d]);
    }

    // DELETE /api/salary/deductions/{id}
    public function destroyDeduction(int $id): JsonResponse
    {
        SalaryDeduction::findOrFail($id)->delete();
        return response()->json(['success' => true]);
    }

    // Gói 55: GET /api/salary-summary?month=YYYY-MM&branch_id=?
    // Tổng hợp lương toàn NV dạng list (tên, chi nhánh, tổng giờ, tổng lương, thực nhận)
    public function summary(Request $request): JsonResponse
    {
        $month = $request->string('month', Carbon::now()->format('Y-m'))->toString();
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (YYYY-MM).'], 422);
        }
        $branchId = $request->query('branch_id');

        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        $end = $start->copy()->endOfMonth();

        $empQ = Employee::with(['role:id,name', 'branch:id,name'])
            ->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('start_date')->orWhere('start_date', '<=', $end->toDateString()));
        if ($branchId) $empQ->where('branch_id', $branchId);
        $employees = $empQ->orderBy('full_name')->get();

        // Tổng giờ từ salary_days
        $hoursMap = SalaryDay::whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->whereIn('employee_id', $employees->pluck('id'))
            ->selectRaw('employee_id, SUM(hours) as total_hours, SUM(meal_count) as total_meals')
            ->groupBy('employee_id')
            ->get()->keyBy('employee_id');

        // Lương cơ bản: dùng hourly_rate hiện tại của NV
        $rows = [];
        $grandTotal = 0;
        $grandHours = 0;
        foreach ($employees as $emp) {
            $h = $hoursMap->get($emp->id);
            $totalHours = (float) ($h->total_hours ?? 0);
            $hourlyRate = (float) ($emp->hourly_rate ?? 0);
            // Nếu không có hourly_rate trực tiếp, lấy từ wage level mới nhất
            if (!$hourlyRate) {
                $lv = WageLevel::where('employee_id', $emp->id)
                    ->where('start_date', '<=', $end->toDateString())
                    ->orderBy('start_date', 'desc')->first();
                $hourlyRate = $lv ? (float) $lv->hourly_rate : 0;
            }
            $gross = round($totalHours * $hourlyRate);
            $rows[] = [
                'employee_id' => $emp->id,
                'full_name' => $emp->full_name,
                'branch_id' => $emp->branch_id,
                'branch_name' => $emp->branch?->name ?? '',
                'role_name' => $emp->role?->name ?? '',
                'total_hours' => round($totalHours, 2),
                'hourly_rate' => $hourlyRate,
                'gross' => $gross,
            ];
            $grandTotal += $gross;
            $grandHours += $totalHours;
        }

        return response()->json(['success' => true, 'data' => [
            'month' => $month,
            'month_label' => 'THÁNG ' . $start->format('m/Y'),
            'rows' => $rows,
            'grand_total' => $grandTotal,
            'grand_hours' => round($grandHours, 2),
            'employee_count' => count($rows),
        ]]);
    }
}
