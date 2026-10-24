<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Bonus;
use App\Models\Employee;
use App\Models\EmployeeInsurance;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\RankWageLevel;
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
        // Audit 2026-10-23 A4-4: kỳ đã chốt -> trả SNAPSHOT đã lưu lúc chốt,
        // không tính lại theo chính sách/dữ liệu hiện tại
        $lock = \App\Models\PayrollLock::get($month);
        if ($lock && \Illuminate\Support\Facades\Schema::hasTable('payroll_lock_snapshots')) {
            $snap = \App\Models\PayrollLockSnapshot::where('lock_id', $lock->id)
                ->where('employee_id', $id)->where('kind', 'detail')->first();
            if ($snap) {
                return response()->json(['success' => true, 'data' => $snap->data]);
            }
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
                'hours' => $hasHours ? round($totalH, 3) : null, // A4-12a: 3 số lẻ
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
        $dayHoursTotal = round(array_sum(array_column($dayRows, 'hours')), 3); // A4-12a
        $useDaily = $dayHoursTotal > 0;
        $totalHours = $useDaily ? $dayHoursTotal : (($record ? (float) $record->hours : 0));

        // Mức lương: đơn giá giờ/ngày = hourly_rate (mức tại ngày đó) + rank (cấp bậc tại ngày đó) + resp_effective (chính sách chung).
        // (Gói 30: wage_levels.responsibility_rate theo NV không còn dùng trong tính lương.)
        $levels = WageLevel::where('employee_id', $id)
            ->where('start_date', '<=', $end->toDateString())
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $start->toDateString()))
            ->orderBy('start_date')
            ->get();
        // Gói 67: lương cấp bậc — mức tại ngày đó (pattern giống wage_levels)
        $rankLevels = RankWageLevel::where('employee_id', $id)
            ->where('start_date', '<=', $end->toDateString())
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $start->toDateString()))
            ->orderBy('start_date')
            ->get();
        $rankForDate = function (string $dateStr) use ($rankLevels) {
            foreach ($rankLevels as $l) {
                $s = $l->start_date->toDateString();
                $e = $l->end_date ? $l->end_date->toDateString() : '9999-12-31';
                if ($dateStr >= $s && $dateStr <= $e) return (float) $l->amount;
            }
            return 0.0;
        };
        $rateForDate = function (string $dateStr) use ($levels, $respEffective, $rankForDate) {
            $hourly = 0.0; $lv = null;
            foreach ($levels as $l) {
                $s = $l->start_date->toDateString();
                $e = $l->end_date ? $l->end_date->toDateString() : '9999-12-31';
                if ($dateStr >= $s && $dateStr <= $e) { $hourly = (float) $l->hourly_rate; $lv = $l; break; }
            }
            $rank = $rankForDate($dateStr);
            return ['level' => $lv, 'hourly' => $hourly, 'rank' => $rank, 'rate' => $hourly + $rank + $respEffective];
        };

        $base = 0.0; $w3weighted = 0.0; $wRankWeighted = 0.0;
        $holidayExtra = 0.0; $holidayHours = 0.0; $holidayDays = [];
        $baseLines = [];
        $wageMissingDates = []; // Audit 2026-10-23 A4-10
        if ($useDaily) {
            $agg = [];
            foreach ($dayRows as $r) {
                $h = $r['hours'];
                if ($h <= 0) continue;
                $rr = $rateForDate($r['key']);
                if ($rr['level'] === null) $wageMissingDates[] = $r['key'];
                $rate = $rr['rate'];
                $base += $h * $rate;
                $w3weighted += $h * $rr['hourly'];
                $wRankWeighted += $h * $rr['rank'];
                $lid = $rr['level']?->id ?? 0;
                if (!isset($agg[$lid])) $agg[$lid] = ['level' => $rr['level'], 'hourly' => $rr['hourly'], 'rankWeighted' => 0, 'hours' => 0];
                $agg[$lid]['hours'] += $h;
                $agg[$lid]['rankWeighted'] += $h * $rr['rank'];
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
                $rankAvg = $a['hours'] > 0 ? $a['rankWeighted'] / $a['hours'] : 0;
                $rt = $a['hourly'] + $rankAvg + $respEffective;
                $baseLines[] = [
                    'hourly_rate' => $a['hourly'],
                    'rank_rate' => round($rankAvg),
                    'responsibility_rate' => $respEffective,
                    'rate_total' => $rt,
                    'from' => $a['level']?->start_date?->toDateString(),
                    'to' => $a['level']?->end_date?->toDateString(),
                    'days' => null,
                    'hours' => round($a['hours'], 3), // A4-12a
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
                $rankAvg = $rankForDate($lvStart);
                $rate = (float) $lv->hourly_rate + $rankAvg + $respEffective;
                $base += $portion * $rate;
                $w3weighted += $portion * (float) $lv->hourly_rate;
                $wRankWeighted += $portion * $rankAvg;
                $baseLines[] = [
                    'hourly_rate' => (float) $lv->hourly_rate,
                    'rank_rate' => round($rankAvg),
                    'responsibility_rate' => $respEffective,
                    'rate_total' => $rate,
                    'from' => $lvStart, 'to' => $lvEnd, 'days' => $overlapDays,
                    'hours' => round($portion, 3), 'amount' => round($portion * $rate), // A4-12a
                ];
            }
            // Audit 2026-10-23 A4-10 (đường fallback): giờ nhập tay không gắn
            // theo ngày nên chỉ liệt kê được các NGÀY không có mức bao phủ
            if ($totalHours > 0) {
                for ($dd = 1; $dd <= $daysInMonth; $dd++) {
                    $ds = sprintf('%s-%02d', $month, $dd);
                    $covered = false;
                    foreach ($levels as $l) {
                        $ls = $l->start_date->toDateString();
                        $le = $l->end_date ? $l->end_date->toDateString() : '9999-12-31';
                        if ($ds >= $ls && $ds <= $le) { $covered = true; break; }
                    }
                    if (!$covered) $wageMissingDates[] = $ds;
                }
            }
            // Lễ fallback: dùng giờ lễ nhập tay cũ
            // Bổ sung A4-12b: giờ lễ nhập tay là TỔNG cả tháng, không gắn theo
            // ngày nên không thể tính đúng theo từng ngày lễ; khi tháng có
            // nhiều ngày lễ với hệ số KHÁC nhau, hệ số trung bình chỉ là ước
            // tính -> gắn cờ holiday_extra_approx để giao diện cảnh báo.
            // (1 hệ số duy nhất thì trung bình = chính xác, không gắn cờ.)
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
        // 2. trách nhiệm/h (chính sách chung) ; 3. cơ bản/h (bình quân gia quyền) ; 3b. cấp bậc/h ; 4. = 2+3+3b
        $w2 = $respEffective;
        $w3 = $totalHours > 0 ? $w3weighted / $totalHours : 0;
        $wRank = $totalHours > 0 ? $wRankWeighted / $totalHours : 0;
        $w4 = $w2 + $w3 + $wRank;

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
            $employerPart = $baseAmt * $rEmployer / 100;
            // Bổ sung A4-12d: tổng phần NLĐ = TỔNG 3 dòng thành phần đã làm tròn
            // (trước đây tròn từ tổng chưa tròn -> tổng hiển thị lệch 1đ so với
            // cộng tay 3 dòng). Số trừ vào thực nhận cũng dùng đúng tổng này.
            $empParts = [
                ['label' => '8. BHXH (' . $rBhxh . '%)', 'amount' => round($baseAmt * $rBhxh / 100)],
                ['label' => '9. BHYT (' . $rBhyt . '%)', 'amount' => round($baseAmt * $rBhyt / 100)],
                ['label' => '10. BHTN (' . $rBhtn . '%)', 'amount' => round($baseAmt * $rBhtn / 100)],
            ];
            $empTotalRounded = array_sum(array_column($empParts, 'amount'));
            $deduct = $ins->employer_pays_all ? 0 : $empTotalRounded;
            $insuranceDeduct = $deduct;
            $insurance = [
                'base_amount' => $baseAmt,
                'employer_pays_all' => (bool) $ins->employer_pays_all,
                'employee_rate' => $empRate,
                'employer_rate' => $rEmployer,
                'details' => $empParts,
                'employee_total' => $empTotalRounded,
                'employer_total' => round($employerPart),
                'deducted' => round($deduct),
            ];
        }

        // Spec P4-B6: phụ cấp nhiều loại
        $allowances = [];
        $allowanceTotal = 0;
        try {
            $allowances = \App\Models\EmployeeAllowance::with('type:id,name')
                ->where('employee_id', $id)->where('is_active', true)
                ->where(fn ($q) => $q->where('month', $month)->orWhereNull('month'))
                ->get()->map(fn ($a) => ['id' => $a->id, 'name' => $a->type?->name ?? '', 'amount' => (float) $a->amount])->values()->all();
            $allowanceTotal = array_sum(array_column($allowances, 'amount'));
        } catch (\Throwable $e) { /* bảng chưa migrate */ }

        // B. LƯƠNG = A × 4  ;  C. THỰC NHẬN
        $gross = round($base);
        $net = $gross + round($mealTotal) + round($holidayExtra) + round($bonusTotal) + round($allowanceTotal)
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
                'line_rank_rate' => round($wRank),
                'line4_rate' => round($w4),
                'gross' => $gross,
                'meal_total' => round($mealTotal),
                'meal_count_total' => array_sum(array_column($dayRows, 'meal_count')),
                'meal_price' => $mealAmount,
                'meal_amount' => $mealAmount,
                'holiday_extra' => round($holidayExtra),
                // A4-12b: true = tiền lễ đang là ƯỚC TÍNH (fallback giờ nhập tay + nhiều hệ số lễ khác nhau)
                'holiday_extra_approx' => !$useDaily && $holidayHours > 0
                    && $holidays->pluck('multiplier')->unique()->count() > 1,
                'holiday_hours' => $holidayHours,
                'holiday_days' => $holidayDays,
                'bonus_total' => round($bonusTotal),
                'advance_total' => round($advanceTotal),
                'allowance_total' => round($allowanceTotal),
                'net' => $net,
                // Audit 2026-10-23 A4-10: ngày có giờ công nhưng không mức
                // lương nào bao phủ (đang tính 0đ/giờ) — giao diện phải cảnh báo
                'wage_missing_days' => count($wageMissingDates),
                'wage_missing_dates' => $wageMissingDates,
            ],
            'base_lines' => $baseLines,
            'bonuses' => $bonuses,
            'advances' => $advances,
            'allowances' => $allowances,
            'deductions' => $deductions->map(fn ($d) => [ // Gói 40
                'id' => $d->id, 'name' => $d->name,
                'amount' => (float) $d->amount, 'note' => $d->note,
                'kind' => $d->kind ?? 'other', // Spec P4-B3: fine = phạt tiền
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
        // Spec P4-B1: chặn sửa bản ghi lương của kỳ đã chốt
        \App\Models\PayrollLock::assertUnlocked($validated['month']);
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
        // Spec P4-B1: chặn sửa ngày công của kỳ đã chốt
        foreach (array_unique(array_map(fn ($d) => substr((string) ($d['date'] ?? ''), 0, 7), $validated['days'])) as $m) {
            if (preg_match('/^\d{4}-\d{2}$/', $m)) \App\Models\PayrollLock::assertUnlocked($m);
        }
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
                        $hours = round($in->diffInMinutes($out) / 60, 3); // A4-12a
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
        // Spec P4-B1: chặn đổ giờ công vào kỳ đã chốt
        \App\Models\PayrollLock::assertUnlocked($month);
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        $end = $start->copy()->endOfMonth();
        $daysInMonth = $start->daysInMonth;
        $from = $start->toDateString();
        $to = $end->toDateString();

        // NV đang làm trong kỳ: kích hoạt + ngày vào làm không sau cuối tháng
        // Audit 2026-10-23 A4-5: NV đã nghỉ việc nhưng CÓ chấm công trong kỳ vẫn
        // được đổ giờ (trước đây lọc is_active làm mất trắng công của họ)
        $attEmpIds = Attendance::whereBetween('date', [$from, $to])
            ->when(!empty($v['branch_id']), fn ($q) => $q->where('branch_id', $v['branch_id']))
            ->pluck('employee_id')->unique();
        $empQ = Employee::where(function ($q) use ($to, $attEmpIds) {
            $q->where(fn ($qq) => $qq->where('is_active', true)
                    ->where(fn ($s) => $s->whereNull('start_date')->orWhere('start_date', '<=', $to)))
                ->orWhereIn('id', $attEmpIds);
        });
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

                        // Vào sớm nhất + ra muộn nhất TRONG chi nhánh này (để hiển thị)
                        $in = $dayAtts->whereNotNull('check_in')
                            ->sortBy(fn ($a) => $a->check_in->timestamp)->first()?->check_in;
                        $out = $dayAtts->whereNotNull('check_out')
                            ->sortByDesc(fn ($a) => $a->check_out->timestamp)->first()?->check_out;
                        $inStr = $in ? Carbon::parse($in)->format('H:i') : null;
                        $outStr = $out ? Carbon::parse($out)->format('H:i') : null;

                        if ($dayAtts->count() > 1) {
                            // Audit 2026-10-23 A4-13: ngày có 2 cặp vào/ra (ca gãy) —
                            // giờ công = TỔNG từng cặp, không bắc cầu từ vào-sớm-nhất
                            // tới ra-muộn-nhất (trước đây tính cả giờ nghỉ giữa 2 ca)
                            $pairs = $dayAtts->filter(fn ($a) => $a->check_in && $a->check_out);
                            if ($pairs->count() === $dayAtts->count()) {
                                $hours = round($pairs->sum(fn ($a) => Carbon::parse($a->check_in)->diffInMinutes($a->check_out)) / 60, 3); // A4-12a
                                $summary['imported']++;
                            } else {
                                $hours = null;
                                $summary['incomplete']++;
                                $missing[] = ['employee' => $emp->full_name, 'date' => $dateStr, 'branch_id' => $brId];
                            }
                        } elseif ($in && $out) {
                            $hours = round(Carbon::parse($in)->diffInMinutes($out) / 60, 3); // A4-12a
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
        \App\Models\PayrollLock::assertUnlocked(now()->format('Y-m'));
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
        \App\Models\PayrollLock::assertUnlocked(now()->format('Y-m'));
        EmployeeInsurance::where('employee_id', $id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa cấu hình BHXH.']);
    }

    // ---------- Spec P4-B6: Phụ cấp nhiều loại ----------
    public function allowanceTypes(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => \App\Models\AllowanceType::orderBy('sort_order')->get()]);
    }

    public function storeAllowanceType(Request $request): JsonResponse
    {
        $v = $request->validate([
            'code' => 'required|string|max:50|unique:allowance_types,code',
            'name' => 'required|string|max:150',
            'is_active' => 'nullable|boolean',
        ]);
        $t = \App\Models\AllowanceType::create($v + ['sort_order' => 99]);
        return response()->json(['success' => true, 'data' => $t], 201);
    }

    public function updateAllowanceType(Request $request, int $id): JsonResponse
    {
        $t = \App\Models\AllowanceType::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:150',
            'is_active' => 'sometimes|boolean',
            'sort_order' => 'sometimes|integer',
        ]);
        $t->update($v);
        return response()->json(['success' => true, 'data' => $t]);
    }

    // Danh sách phụ cấp của 1 NV
    public function employeeAllowances(int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $rows = \App\Models\EmployeeAllowance::with('type:id,name')->where('employee_id', $id)
            ->orderBy('month')->orderBy('id')->get();
        return response()->json(['success' => true, 'data' => $rows]);
    }

    public function storeEmployeeAllowance(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $v = $request->validate([
            'allowance_type_id' => 'required|exists:allowance_types,id',
            'amount' => 'required|numeric|min:0',
            'month' => 'nullable|regex:/^\\d{4}-\\d{2}$/',
            'is_active' => 'nullable|boolean',
        ]);
        if (!empty($v['month'])) \App\Models\PayrollLock::assertUnlocked($v['month']);
        $a = \App\Models\EmployeeAllowance::create(['employee_id' => $id] + $v);
        return response()->json(['success' => true, 'data' => $a->load('type:id,name')], 201);
    }

    public function destroyEmployeeAllowance(int $id): JsonResponse
    {
        $a = \App\Models\EmployeeAllowance::findOrFail($id);
        if ($a->month) \App\Models\PayrollLock::assertUnlocked($a->month);
        $a->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa phụ cấp.']);
    }

    // ---------- Mức lương ----------
    public function history(int $id): JsonResponse
    {
        Employee::findOrFail($id);
        return response()->json(['success' => true, 'data' => [
            'wage_levels' => WageLevel::where('employee_id', $id)->orderBy('start_date', 'desc')->get(),
            'rank_wage_levels' => RankWageLevel::where('employee_id', $id)->orderBy('start_date', 'desc')->get(),
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
        // Spec P4-B1: mức mới ảnh hưởng từ start_date về sau → chặn nếu giao kỳ đã chốt
        \App\Models\PayrollLock::assertLevelUnlocked($validated['start_date'], null);

        $level = DB::transaction(function () use ($id, $validated) {
            // Audit 2026-10-23 A4-3: chèn mức ở BẤT KỲ vị trí thời gian nào cũng
            // phải giữ dãy mức là 1 phân hoạch không chồng lấn:
            // - mức đang chứa ngày bắt đầu mới -> đóng tại ngày trước đó
            //   (nếu bắt đầu đúng ngày đó thì thay thế hẳn mức cũ);
            // - mức mới kết thúc ngay trước mức tiếp theo (nếu có), không mặc
            //   định kéo dài vô hạn như trước (chèn ngược thời gian từng làm
            //   mức cũ bị cắt cụt oan và mức mới nuốt chửng các mức sau).
            $start = Carbon::parse($validated['start_date'])->toDateString();
            $dayBefore = Carbon::parse($start)->subDay()->toDateString();
            $containing = WageLevel::where('employee_id', $id)
                ->where('start_date', '<=', $start)
                ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $start))
                ->first();
            $next = WageLevel::where('employee_id', $id)
                ->where('start_date', '>', $start)->orderBy('start_date')->first();
            $newEnd = $next ? Carbon::parse($next->start_date->toDateString())->subDay()->toDateString() : null;
            if ($containing) {
                if ($containing->start_date->toDateString() === $start) {
                    $containing->delete();
                } else {
                    $containing->update(['end_date' => $dayBefore]);
                }
            }
            return WageLevel::create([
                'employee_id' => $id,
                'hourly_rate' => $validated['hourly_rate'],
                'responsibility_rate' => $validated['responsibility_rate'] ?? 0,
                'start_date' => $start,
                'end_date' => $newEnd,
                'note' => $validated['note'] ?? null,
            ]);
        });

        return response()->json(['success' => true, 'data' => $level], 201);
    }

    public function deleteWageLevel(int $id): JsonResponse
    {
        $lv = WageLevel::findOrFail($id);
        \App\Models\PayrollLock::assertLevelUnlocked($lv->start_date->toDateString(), $lv->end_date?->toDateString());
        DB::transaction(function () use ($lv) {
            // Audit 2026-10-23 A4-3: xóa mức -> mức LIỀN TRƯỚC (kết thúc đúng
            // ngày trước ngày bắt đầu của mức bị xóa) tự kéo dài phủ khoảng
            // trống tới hết khoảng của mức bị xóa — không để hổng ngày không
            // mức nào bao phủ (trước đây xóa mức hiện hành tạo khoảng mù lương 0).
            $prev = WageLevel::where('employee_id', $lv->employee_id)
                ->where('end_date', Carbon::parse($lv->start_date->toDateString())->subDay()->toDateString())
                ->first();
            if ($prev) {
                $prev->update(['end_date' => $lv->end_date?->toDateString()]);
            }
            $lv->delete();
        });
        return response()->json(['success' => true, 'message' => 'Đã xóa mức lương.']);
    }

    // ---------- Lương cấp bậc (Gói 67) ----------
    // Pattern giống hệt wage_levels: thêm mức mới -> tự set end_date mức cũ = start_date mới − 1 ngày
    public function addRankWageLevel(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'amount' => 'required|numeric|min:0',
            'start_date' => 'required|date',
            'note' => 'nullable|string|max:255',
        ]);
        // Spec P4-B1: mức mới ảnh hưởng từ start_date về sau → chặn nếu giao kỳ đã chốt
        \App\Models\PayrollLock::assertLevelUnlocked($validated['start_date'], null);

        $level = DB::transaction(function () use ($id, $validated) {
            // Audit 2026-10-23 A4-3: cùng cơ chế phân hoạch như addWageLevel
            $start = Carbon::parse($validated['start_date'])->toDateString();
            $dayBefore = Carbon::parse($start)->subDay()->toDateString();
            $containing = RankWageLevel::where('employee_id', $id)
                ->where('start_date', '<=', $start)
                ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $start))
                ->first();
            $next = RankWageLevel::where('employee_id', $id)
                ->where('start_date', '>', $start)->orderBy('start_date')->first();
            $newEnd = $next ? Carbon::parse($next->start_date->toDateString())->subDay()->toDateString() : null;
            if ($containing) {
                if ($containing->start_date->toDateString() === $start) {
                    $containing->delete();
                } else {
                    $containing->update(['end_date' => $dayBefore]);
                }
            }
            return RankWageLevel::create([
                'employee_id' => $id,
                'amount' => $validated['amount'],
                'start_date' => $start,
                'end_date' => $newEnd,
                'note' => $validated['note'] ?? null,
            ]);
        });

        return response()->json(['success' => true, 'data' => $level], 201);
    }

    public function deleteRankWageLevel(int $id): JsonResponse
    {
        $lv = RankWageLevel::findOrFail($id);
        \App\Models\PayrollLock::assertLevelUnlocked($lv->start_date->toDateString(), $lv->end_date?->toDateString());
        DB::transaction(function () use ($lv) {
            // Audit 2026-10-23 A4-3: mức liền trước kéo dài phủ khoảng trống
            $prev = RankWageLevel::where('employee_id', $lv->employee_id)
                ->where('end_date', Carbon::parse($lv->start_date->toDateString())->subDay()->toDateString())
                ->first();
            if ($prev) {
                $prev->update(['end_date' => $lv->end_date?->toDateString()]);
            }
            $lv->delete();
        });
        return response()->json(['success' => true, 'message' => 'Đã xóa mức lương cấp bậc.']);
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
        $advMonth = substr($validated['date'], 0, 7);
        \App\Models\PayrollLock::assertUnlocked($advMonth);
        // Audit 2026-10-23 A4-6: chặn tổng ứng vượt DỰ KIẾN THỰC NHẬN của tháng
        // ứng (dự kiến = tổng lương tính theo dữ liệu hiện có TRƯỚC khi trừ ứng;
        // số này đã gồm các khoản ứng trước đó nên cộng lại phần đã ứng).
        [$advRows] = $this->buildPayrollData($advMonth, null);
        $empNet = 0;
        $found = false;
        foreach ($advRows as $r) {
            if ((int) $r['employee_id'] === (int) $id) { $empNet = (int) $r['grand_total']; $found = true; break; }
        }
        $existingAdvance = (float) SalaryAdvance::where('employee_id', $id)
            ->where('date', 'like', $advMonth . '%')->sum('amount');
        $projected = $found ? $empNet + (int) round($existingAdvance) : 0;
        if ($existingAdvance + (float) $validated['amount'] > $projected) {
            return response()->json(['success' => false, 'message' => 'Tổng ứng (' . number_format($existingAdvance + (float) $validated['amount'], 0, ',', '.') . 'đ) vượt dự kiến thực nhận tháng ' . substr($advMonth, 5, 2) . '/' . substr($advMonth, 0, 4) . ' (' . number_format($projected, 0, ',', '.') . 'đ theo dữ liệu lương hiện có). Hãy giảm khoản ứng hoặc bổ sung giờ công trước.'], 422);
        }
        $adv = SalaryAdvance::create(['employee_id' => $id] + $validated);
        return response()->json(['success' => true, 'data' => $adv], 201);
    }

    public function deleteAdvance(int $id): JsonResponse
    {
        $a = SalaryAdvance::findOrFail($id);
        \App\Models\PayrollLock::assertUnlocked($a->date->format('Y-m'));
        $a->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa khoản ứng lương.']);
    }

    // ---------- Thưởng ----------
    public function addBonus(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'type' => ['required', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('bonus_types'))], // Spec danh mục dùng chung
            'amount' => 'required|numeric|min:0',
            'date' => 'required|date',
            'note' => 'nullable|string|max:255',
        ]);
        \App\Models\PayrollLock::assertUnlocked(substr($validated['date'], 0, 7));
        $bonus = Bonus::create(['employee_id' => $id] + $validated);
        return response()->json(['success' => true, 'data' => $bonus], 201);
    }

    public function deleteBonus(int $id): JsonResponse
    {
        $b = Bonus::findOrFail($id);
        \App\Models\PayrollLock::assertUnlocked($b->date->format('Y-m'));
        $b->delete();
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
        \App\Models\PayrollLock::assertUnlocked(substr($validated['date'], 0, 7));
        $h = Holiday::create([
            'date' => $validated['date'],
            'name' => $validated['name'],
            'multiplier' => $validated['multiplier'] ?? 2.0,
        ]);
        return response()->json(['success' => true, 'data' => $h], 201);
    }

    public function deleteHoliday(int $id): JsonResponse
    {
        $h = Holiday::findOrFail($id);
        \App\Models\PayrollLock::assertUnlocked($h->date->format('Y-m'));
        $h->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa ngày lễ.']);
    }

    // ---------- Gói 30: Sửa ngày lễ ----------
    // PATCH /api/holidays/{id}
    public function updateHoliday(Request $request, int $id): JsonResponse
    {
        $h = Holiday::findOrFail($id);
        \App\Models\PayrollLock::assertUnlocked($h->date->format('Y-m'));
        $validated = $request->validate([
            'date' => 'sometimes|date|unique:holidays,date,' . $id,
            'name' => 'sometimes|string|max:150',
            'multiplier' => 'sometimes|numeric|min:1|max:10',
        ]);
        // Audit 2026-10-23 A4-12: dời ngày lễ sang tháng khác phải kiểm khóa
        // THÁNG ĐÍCH nữa (trước đây dời vào tháng đã chốt vẫn lọt)
        if (!empty($validated['date'])) {
            \App\Models\PayrollLock::assertUnlocked(substr($validated['date'], 0, 7));
        }
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
        \App\Models\PayrollLock::assertUnlocked($validated['month']);
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
                'kind' => $d->kind ?? 'other',
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
            'kind' => 'nullable|in:other,fine',
        ]);
        \App\Models\PayrollLock::assertUnlocked($v['month']);
        $maxSort = (int) SalaryDeduction::where('employee_id', $id)->where('month', $v['month'])->max('sort_order');
        $d = SalaryDeduction::create([
            'employee_id' => $id, 'month' => $v['month'], 'name' => $v['name'],
            'amount' => $v['amount'], 'note' => $v['note'] ?? null, 'sort_order' => $maxSort + 1,
            'kind' => $v['kind'] ?? 'other',
        ]);
        return response()->json(['success' => true, 'data' => $d], 201);
    }

    // PUT /api/salary/deductions/{id}
    public function updateDeduction(Request $request, int $id): JsonResponse
    {
        $d = SalaryDeduction::findOrFail($id);
        \App\Models\PayrollLock::assertUnlocked($d->month);
        $v = $request->validate([
            'name' => 'nullable|string|max:255',
            'amount' => 'nullable|numeric|min:0|max:999999999',
            'note' => 'nullable|string|max:255',
            'kind' => 'nullable|in:other,fine',
        ]);
        $d->fill(array_filter($v, fn ($x) => $x !== null));
        $d->save();
        return response()->json(['success' => true, 'data' => $d]);
    }

    // DELETE /api/salary/deductions/{id}
    public function destroyDeduction(int $id): JsonResponse
    {
        $d = SalaryDeduction::findOrFail($id);
        \App\Models\PayrollLock::assertUnlocked($d->month);
        $d->delete();
        return response()->json(['success' => true]);
    }

    // Audit UX 2026-10-21 (hạng 8): lưu TOÀN BỘ khoản trừ khác trong 1 request/1 transaction
    // (trước đây frontend POST/PUT/DELETE tuần tự từng khoản — chậm, lỗi giữa chừng lưu dở dang).
    // POST /api/salary/{employee}/deductions/bulk {month, items[], deleted_ids[]}
    public function bulkSaveDeductions(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $v = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'items' => 'present|array',
            'items.*.id' => 'nullable|integer',
            'items.*.name' => 'required|string|max:255',
            'items.*.amount' => 'required|numeric|min:0|max:999999999',
            'items.*.note' => 'nullable|string|max:255',
            'items.*.kind' => 'nullable|in:other,fine',
            'deleted_ids' => 'nullable|array',
            'deleted_ids.*' => 'integer',
        ]);
        \App\Models\PayrollLock::assertUnlocked($v['month']);
        DB::transaction(function () use ($v, $id) {
            if (!empty($v['deleted_ids'])) {
                SalaryDeduction::where('employee_id', $id)->where('month', $v['month'])
                    ->whereIn('id', $v['deleted_ids'])->delete();
            }
            foreach (array_values($v['items']) as $i => $it) {
                $attrs = [
                    'name' => $it['name'], 'amount' => $it['amount'],
                    'note' => $it['note'] ?? null, 'kind' => $it['kind'] ?? 'other',
                    'sort_order' => $i + 1,
                ];
                $done = false;
                if (!empty($it['id'])) {
                    $d = SalaryDeduction::where('employee_id', $id)->where('month', $v['month'])
                        ->find($it['id']);
                    if ($d) {
                        $d->fill($attrs);
                        $d->save();
                        $done = true;
                    }
                }
                if (!$done) {
                    SalaryDeduction::create(['employee_id' => $id, 'month' => $v['month']] + $attrs);
                }
            }
        });
        return response()->json(['success' => true]);
    }

    // Spec tổng lương (Đại Vương chốt 2026-10-19): redesign tab Tổng lương — 16 cột
    // (15 cột spec + 10b Lương ngày lễ tách riêng). 1 dòng/(NV, chi nhánh).
    // GET /api/salary-summary?month=YYYY-MM&branch_id=?
    public function summary(Request $request): JsonResponse
    {
        $month = $request->string('month', Carbon::now()->format('Y-m'))->toString();
        if (!preg_match('/^\\d{4}-\\d{2}$/', $month)) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (YYYY-MM).'], 422);
        }
        $branchId = $request->query('branch_id');
        $branchId = $branchId ? (int) $branchId : null;
        // Audit 2026-10-23 A4-4: kỳ đã chốt -> bảng tổng đọc từ SNAPSHOT
        $lock = \App\Models\PayrollLock::get($month);
        if ($lock && \Illuminate\Support\Facades\Schema::hasTable('payroll_lock_snapshots')) {
            $snaps = \App\Models\PayrollLockSnapshot::where('lock_id', $lock->id)
                ->where('kind', 'row')->orderBy('id')->get();
            if ($snaps->isNotEmpty()) {
                $rows = $snaps->map(fn ($sn) => $sn->data)
                    ->when($branchId, fn ($c) => $c->filter(fn ($r) => (int) ($r['branch_id'] ?? 0) === $branchId)->values())
                    ->all();
                // Lọc theo CN thì tổng/giờ tính trên dòng đã lọc như đường live
                $grandTotal = $branchId ? array_sum(array_column($rows, 'net')) : (float) $lock->net_total;
                $grandHours = array_sum(array_column($rows, 'total_hours'));
                $employees = Employee::whereIn('id', $snaps->pluck('employee_id')->unique())->get();
                $start = Carbon::createFromFormat('Y-m-d', $month . '-01');
                return response()->json(['success' => true, 'data' => [
                    'month' => $month,
                    'month_label' => 'THÁNG ' . $start->format('m/Y'),
                    'rows' => $rows,
                    'grand_total' => $grandTotal,
                    'grand_hours' => round($grandHours, 2),
                    'employee_count' => $branchId ? count(array_unique(array_column($rows, 'employee_id'))) : $employees->count(),
                    'single_branch' => (bool) $branchId,
                    'from_snapshot' => true,
                ]]);
            }
        }
        [$rows, $grandTotal, $grandHours, $employees] = $this->buildPayrollData($month, $branchId);
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01');
        return response()->json(['success' => true, 'data' => [
            'month' => $month,
            'month_label' => 'THÁNG ' . $start->format('m/Y'),
            'rows' => $rows,
            'grand_total' => $grandTotal,
            'grand_hours' => round($grandHours, 2),
            'employee_count' => count($employees),
            'single_branch' => (bool) $branchId,
        ]]);
    }

    // Tính toán payroll 1 tháng — dùng chung cho tab Tổng lương và Chốt lương (B1/B2)
    public function buildPayrollData(string $month, ?int $branchId): array
    {

        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        $end = $start->copy()->endOfMonth();
        $startStr = $start->toDateString();
        $endStr = $end->toDateString();

        // Ngày lễ trong tháng (hệ số riêng từng ngày)
        $holidays = Holiday::whereBetween('date', [$startStr, $endStr])->get()
            ->keyBy(fn ($h) => $h->date->format('Y-m-d'));

        // Chi tiết ngày công trong tháng (theo NV + CN)
        $days = SalaryDay::whereBetween('date', [$startStr, $endStr])
            ->get(['employee_id', 'branch_id', 'date', 'hours', 'meal_count']);

        $dayEmpIds = $days->pluck('employee_id')->unique()->values();

        // Audit 2026-10-23 A4-5: NV đã nghỉ việc nhưng CÓ ngày công trong kỳ
        // vẫn vào bảng tổng + chốt (trước đây lọc is_active làm họ biến mất,
        // tổng kỳ thiếu hẳn phần lương của họ)
        $empQ = Employee::with(['role:id,name', 'branch:id,name', 'insurance'])
            ->where(function ($q) use ($endStr, $dayEmpIds) {
                $q->where(fn ($qq) => $qq->where('is_active', true)
                        ->where(fn ($st) => $st->whereNull('start_date')->orWhere('start_date', '<=', $endStr)))
                    ->orWhereIn('id', $dayEmpIds);
            });
        if ($branchId) {
            // Xem 1 CN: NV có giờ công tại CN đó HOẶC hồ sơ thuộc CN đó
            $empQ->where(fn ($q) => $q->where('branch_id', $branchId)->orWhereIn('id', $dayEmpIds));
        }
        $employees = $empQ->orderBy('full_name')->get();
        $empIds = $employees->pluck('id');

        // Gom ngày công theo (NV, CN)
        $daysByEmpBranch = [];
        $daysByEmp = [];
        foreach ($days as $d) {
            if (!$empIds->contains($d->employee_id)) continue;
            $k = $d->employee_id . '|' . $d->branch_id;
            $daysByEmpBranch[$k]['hours'] = ($daysByEmpBranch[$k]['hours'] ?? 0) + (float) ($d->hours ?? 0);
            $daysByEmpBranch[$k]['meals'] = ($daysByEmpBranch[$k]['meals'] ?? 0) + (int) ($d->meal_count ?? 0);
            $daysByEmp[$d->employee_id][] = $d;
        }

        // Mức lương theo NV (để tính bình quân gia quyền)
        $wageLevels = WageLevel::whereIn('employee_id', $empIds)
            ->where('start_date', '<=', $endStr)
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $startStr))
            ->orderBy('start_date')->get()->groupBy('employee_id');
        $rankLevels = RankWageLevel::whereIn('employee_id', $empIds)
            ->where('start_date', '<=', $endStr)
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $startStr))
            ->orderBy('start_date')->get()->groupBy('employee_id');

        // Chính sách lương trách nhiệm (chung)
        $respBase = (float) Setting::get('resp_base_per_hour', 2000);
        $respDed = (float) Setting::get('resp_deduction_per_violation', 500);
        $respMax = (int) Setting::get('resp_max_violations', 4);
        $violAuto = Violation::whereIn('employee_id', $empIds)
            ->whereBetween('date', [$startStr, $endStr])
            ->selectRaw('employee_id, SUM(points) as pts')->groupBy('employee_id')
            ->pluck('pts', 'employee_id');
        $violOverride = SalaryRecord::whereIn('employee_id', $empIds)->where('month', $month)
            ->whereNotNull('violation_count')->pluck('violation_count', 'employee_id');

        // Các khoản theo tháng (không chia theo CN — chỉ hiện ở dòng CN chính)
        $bonusMap = Bonus::whereIn('employee_id', $empIds)
            ->whereBetween('date', [$startStr, $endStr])
            ->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        $advMap = SalaryAdvance::whereIn('employee_id', $empIds)
            ->whereBetween('date', [$startStr, $endStr])
            ->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        $dedMap = SalaryDeduction::whereIn('employee_id', $empIds)->where('month', $month)
            ->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        // Spec P4-B6: phụ cấp nhiều loại (dòng theo tháng + dòng áp dụng mọi tháng)
        $allowMap = [];
        try {
            $allowRows = \App\Models\EmployeeAllowance::whereIn('employee_id', $empIds)->where('is_active', true)
                ->where(fn ($q) => $q->where('month', $month)->orWhereNull('month'))
                ->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
            foreach ($allowRows as $k => $v) $allowMap[$k] = (float) $v;
        } catch (\Throwable $e) { /* bảng chưa migrate */ }

        $mealPrice = (float) Setting::get('meal_price', Setting::get('meal_allowance_amount', 25000));
        // A4-12d: BHXH đường tổng tính như đường chi tiết — tổng 3 phần đã tròn
        $rB1 = (float) Setting::get('bhxh_emp_bhxh', 8);
        $rB2 = (float) Setting::get('bhxh_emp_bhyt', 1.5);
        $rB3 = (float) Setting::get('bhxh_emp_bhtn', 1);

        $dateStr = function ($v) {
            if ($v instanceof Carbon) return $v->toDateString();
            if ($v instanceof \DateTimeInterface) return $v->format('Y-m-d');
            return (string) $v;
        };
        $levelAt = function ($levels, string $ds, string $col) use ($dateStr) {
            foreach ($levels as $l) {
                $s = $dateStr($l->start_date);
                $e = $l->end_date ? $dateStr($l->end_date) : '9999-12-31';
                if ($ds >= $s && $ds <= $e) return (float) $l->{$col};
            }
            return 0.0;
        };
        // Audit 2026-10-23 A4-10: bản phân biệt null = ngày KHÔNG có mức bao phủ
        $levelValAt = function ($levels, string $ds, string $col) use ($dateStr) {
            foreach ($levels as $l) {
                $s = $dateStr($l->start_date);
                $e = $l->end_date ? $dateStr($l->end_date) : '9999-12-31';
                if ($ds >= $s && $ds <= $e) return (float) $l->{$col};
            }
            return null;
        };

        $branches = \App\Models\Branch::where('is_active', true)->pluck('name', 'id');

        $rows = [];
        $grandTotal = 0;
        $grandHours = 0;
        foreach ($employees as $emp) {
            $eid = $emp->id;
            $empDays = $daysByEmp[$eid] ?? [];
            $totalHours = 0;
            foreach ($empDays as $d) $totalHours += (float) ($d->hours ?? 0);
            $totalHours = round($totalHours, 3); // A4-12a

            $lvls = $wageLevels->get($eid, collect());
            $rlvls = $rankLevels->get($eid, collect());

            // (5) Lương trách nhiệm
            $violations = isset($violOverride[$eid]) ? (int) $violOverride[$eid] : (int) ($violAuto[$eid] ?? 0);
            $applyResp = (bool) ($emp->apply_responsibility ?? true);
            $w2 = $applyResp ? max(0.0, $respBase - min($violations, max(0, $respMax)) * $respDed) : 0.0;

            // (4)(6) bình quân gia quyền theo giờ + (10b) lương ngày lễ
            // Audit 2026-10-23 A4-10: bỏ fallback $emp->hourly_rate (cột không
            // tồn tại); ngày có giờ công mà KHÔNG mức lương nào bao phủ được
            // đếm vào wage_missing_days để giao diện cảnh báo thay vì tính 0 lặng lẽ
            $w3w = 0; $wRw = 0; $holidayExtra = 0;
            $missingWageDays = 0;
            foreach ($empDays as $d) {
                $h = (float) ($d->hours ?? 0);
                if ($h <= 0) continue;
                $ds = $dateStr($d->date);
                $hv = $levelValAt($lvls, $ds, 'hourly_rate');
                if ($hv === null) { $missingWageDays++; $hourly = 0.0; } else { $hourly = $hv; }
                $rank = $levelAt($rlvls, $ds, 'amount');
                $w3w += $h * $hourly;
                $wRw += $h * $rank;
                $hol = $holidays->get($ds);
                if ($hol) {
                    $holidayExtra += $h * max(0, (float) $hol->multiplier - 1) * ($hourly + $rank + $w2);
                }
            }
            $w3 = $totalHours > 0 ? $w3w / $totalHours : 0;
            $wRank = $totalHours > 0 ? $wRw / $totalHours : 0;

            $rW3 = (int) round($w3); $rW2 = (int) round($w2); $rWRank = (int) round($wRank);
            // Spec: (7) = (4) + (5) + (6) — cộng các mức đã làm tròn về đồng trước khi nhân
            $rW4 = $rW3 + $rW2 + $rWRank;

            // Các khoản tháng (chỉ dòng CN chính)
            $bonus = (int) round((float) ($bonusMap[$eid] ?? 0));
            $holiday = (int) round($holidayExtra);
            $deduct = (int) round((float) ($dedMap[$eid] ?? 0));
            $advance = (int) round((float) ($advMap[$eid] ?? 0));
            $allow = (int) round((float) ($allowMap[$eid] ?? 0));
            $ins = ($emp->insurance && $emp->insurance->is_active) ? $emp->insurance : null;
            $bhxh = ($ins && !$ins->employer_pays_all)
                ? (int) (round((float) $ins->base_amount * $rB1 / 100) + round((float) $ins->base_amount * $rB2 / 100) + round((float) $ins->base_amount * $rB3 / 100))
                : 0;

            // Các CN NV làm trong tháng (không có ngày công → 1 dòng ở CN chính)
            $empBranchIds = [];
            foreach ($empDays as $d) $empBranchIds[$d->branch_id] = true;
            $empBranchIds = array_keys($empBranchIds);
            if (empty($empBranchIds)) $empBranchIds = [$emp->branch_id];
            if ($branchId) $empBranchIds = array_values(array_intersect($empBranchIds, [$branchId]));
            sort($empBranchIds);

            // Audit 2026-10-23 A4-9: thống nhất làm tròn với đường chi tiết
            // (show) — tiền lương tính bằng đơn giá CHƯA làm tròn; tổng lương
            // của NV khớp đúng gross của phiếu chi tiết, phần dư làm tròn theo
            // CN dồn về dòng CN chính để TỔNG KỲ = TỔNG CÁC PHIẾU.
            $w4exact = $w3 + $w2 + $wRank;
            $empWageTotal = (int) round($w3w + $wRw + $w2 * $totalHours);
            $branchWages = [];
            foreach ($empBranchIds as $bid) {
                $k = $eid . '|' . $bid;
                $branchWages[$bid] = (int) round($w4exact * round((float) ($daysByEmpBranch[$k]['hours'] ?? 0), 3)); // A4-12a
            }
            $mainBid = (int) $emp->branch_id;
            $adjustBid = in_array($mainBid, $empBranchIds, true) ? $mainBid : ($empBranchIds[0] ?? $mainBid);
            if (isset($branchWages[$adjustBid])) {
                $branchWages[$adjustBid] += $empWageTotal - array_sum($branchWages);
            }

            $empRows = [];
            foreach ($empBranchIds as $bid) {
                $k = $eid . '|' . $bid;
                $h = round((float) ($daysByEmpBranch[$k]['hours'] ?? 0), 3); // A4-12a
                $meals = (int) ($daysByEmpBranch[$k]['meals'] ?? 0);
                $mealAmt = (int) round($meals * $mealPrice);
                $isMain = ((int) $bid === (int) $emp->branch_id);
                // (14) = (7)x(8) + (9) + (10) + (10b) + phụ cấp - (11) - (12) - (13); CN phụ: "—" các khoản (10)->(13),(10b)
                $net = ($branchWages[$bid] ?? 0) + $mealAmt;
                if ($isMain) $net += $bonus + $holiday + $allow - $deduct - $advance - $bhxh;
                $empRows[] = [
                    'employee_id' => $eid,
                    'full_name' => $emp->full_name,
                    'role_name' => $emp->role?->name ?? '',
                    'branch_id' => (int) $bid,
                    'branch_name' => $branches[$bid] ?? '',
                    'is_main_branch' => $isMain,
                    'base_rate' => $rW3,          // (4) Lương cơ bản đ/giờ
                    'resp_rate' => $rW2,          // (5) Lương trách nhiệm đ/giờ
                    'rank_rate' => $rWRank,       // (6) Lương cấp bậc đ/giờ
                    'hourly_rate' => $rW4,        // (7) Tổng lương/giờ
                    'total_hours' => $h,          // (8) Tổng giờ công
                    'meal_count' => $meals,
                    'meal_total' => $mealAmt,     // (9) Tiền ăn
                    'bonus_total' => $isMain ? $bonus : null,       // (10) Thưởng
                    'holiday_extra' => $isMain ? $holiday : null,    // (10b) Lương ngày lễ
                    'allowance_total' => $isMain ? $allow : null,    // (B6) Phụ cấp
                    'deduction_total' => $isMain ? $deduct : null,   // (11) Trừ khác
                    'advance_total' => $isMain ? $advance : null,    // (12) Trừ ứng lương
                    'bhxh_deduct' => $isMain ? $bhxh : null,         // (13) Trừ BHXH
                    'net' => $net,                // (14) Tổng lương
                    'wage_missing_days' => $missingWageDays, // Audit 23/10 A4-10: số ngày có công không mức lương bao phủ
                ];
                $grandHours += $h;
            }
            // (15) Tổng cộng = tổng (14) các dòng của NV
            $empTotal = array_sum(array_column($empRows, 'net'));
            foreach ($empRows as &$r) $r['grand_total'] = $empTotal;
            unset($r);
            $grandTotal += $empTotal;

            // Sắp xếp dòng theo tên CN
            usort($empRows, fn ($a, $b) => strcmp($a['branch_name'], $b['branch_name']));
            array_push($rows, ...$empRows);
        }

        return [$rows, $grandTotal, $grandHours, $employees];
    }

    // Audit 2026-10-23 A4-4: ghi snapshot cho 1 kỳ chốt — dòng bảng tổng theo CN
    // (kind=row) + payload chi tiết từng NV (kind=detail, gọi show() nội bộ).
    // Dùng chung cho lock() và lệnh artisan payroll:backfill-lock-snapshots.
    // LƯU Ý: phải gọi TRƯỚC khi snapshot tồn tại, vì show() ưu tiên đọc
    // snapshot khi kỳ đã chốt (chưa có snapshot thì tự rơi về tính live).
    public function persistLockSnapshots(\App\Models\PayrollLock $lock, string $month, array $rows, $actor = null): void
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('payroll_lock_snapshots')) return;
        foreach ($rows as $r) {
            \App\Models\PayrollLockSnapshot::create([
                'lock_id' => $lock->id,
                'employee_id' => $r['employee_id'],
                'branch_id' => $r['branch_id'] ?? null,
                'kind' => 'row',
                'data' => $r,
            ]);
        }
        $empIds = array_values(array_unique(array_column($rows, 'employee_id')));
        foreach ($empIds as $eid) {
            $detailReq = Request::create('/api/salary/' . $eid, 'GET', ['month' => $month]);
            $detailReq->setUserResolver(fn () => $actor);
            $detail = $this->show($detailReq, (int) $eid)->getData(true)['data'] ?? null;
            if ($detail) {
                \App\Models\PayrollLockSnapshot::create([
                    'lock_id' => $lock->id,
                    'employee_id' => $eid,
                    'branch_id' => null,
                    'kind' => 'detail',
                    'data' => $detail,
                ]);
            }
        }
    }

    // Spec P4-B1: trạng thái chốt của kỳ lương
    public function lockStatus(Request $request): JsonResponse
    {
        $month = $request->string('month', Carbon::now()->format('Y-m'))->toString();
        $lock = \App\Models\PayrollLock::get($month);
        $logs = \App\Models\PayrollLockLog::where('month', $month)->orderBy('id', 'desc')->limit(20)->get();
        return response()->json(['success' => true, 'data' => [
            'month' => $month,
            'locked' => (bool) $lock,
            'locked_at' => $lock?->locked_at?->format('d/m/Y H:i'),
            'locked_by' => $lock?->locked_by,
            'net_total' => $lock ? (float) $lock->net_total : null,
            'voucher_id' => $lock?->voucher_id,
            'logs' => $logs,
        ]]);
    }

    // Spec P4-B1+B2: chốt lương tháng → khóa kỳ + tự sinh 1 phiếu chi
    public function lock(Request $request): JsonResponse
    {
        $month = $request->string('month', Carbon::now()->format('Y-m'))->toString();
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (YYYY-MM).'], 422);
        }
        if (\App\Models\PayrollLock::isLocked($month)) {
            return response()->json(['success' => false, 'message' => "Kỳ lương {$month} đã chốt rồi."], 422);
        }

        return DB::transaction(function () use ($request, $month) {
            [$rows, $grandTotal] = $this->buildPayrollData($month, null);
            if (empty($rows)) {
                return response()->json(['success' => false, 'message' => 'Tháng này chưa có dữ liệu lương để chốt.'], 422);
            }
            $userId = $request->user()?->id;

            $lock = \App\Models\PayrollLock::create([
                'month' => $month,
                'locked_at' => now(),
                'locked_by' => $userId,
                'net_total' => $grandTotal,
            ]);

            // B2: tự sinh 1 phiếu chi "Lương tháng MM/YYYY" (định dạng theo spec, không phải YYYY-MM)
            $monthLabel = Carbon::createFromFormat('Y-m-d', $month . '-01')->format('m/Y');
            $cat = \App\Models\TransactionCategory::where('type', 'expense')->where('name', 'Lương')->first();
            if (!$cat) {
                // TESTER P4: DB chưa có danh mục chi "Lương" -> tự tạo, không bỏ qua lặng lẽ
                $cat = \App\Models\TransactionCategory::create([
                    'name' => 'Lương',
                    'type' => 'expense',
                    'is_active' => true,
                ]);
            }
            $voucher = null;
            if ($cat) {
                $status = \App\Models\Setting::get('payroll_voucher_status', 'paid');
                if (!in_array($status, ['paid', 'pending'], true)) $status = 'paid';
                $voucher = \App\Models\Transaction::create([
                    'code' => \App\Models\Transaction::nextCode('expense'),
                    'type' => 'expense',
                    'category_id' => $cat->id,
                    'amount' => $grandTotal,
                    'paid_amount' => $status === 'paid' ? $grandTotal : 0,
                    'paid_at' => now()->toDateString(),
                    'occurred_at' => Carbon::createFromFormat('Y-m-d', $month . '-01')->endOfMonth()->toDateString(),
                    'status' => $status,
                    'approved_by' => $userId,
                    'approved_at' => now(),
                    'related_type' => 'payroll',
                    'related_id' => $lock->id,
                    'note' => "Lương tháng {$monthLabel} (tự sinh khi chốt lương)",
                    'created_by' => $userId,
                ]);
                $lock->update(['voucher_id' => $voucher->id]);
            }

            // Audit 2026-10-23 A4-4: lưu SNAPSHOT theo NV tại thời điểm chốt
            $this->persistLockSnapshots($lock, $month, $rows, $request->user());

            \App\Models\PayrollLock::log($month, 'lock', $userId, "Chốt lương tháng {$month}, tổng thực nhận " . number_format($grandTotal, 0, ',', '.') . 'đ');

            return response()->json(['success' => true, 'data' => [
                'month' => $month,
                'net_total' => $grandTotal,
                'voucher_id' => $voucher?->id,
                'voucher_code' => $voucher?->code,
            ]]);
        });
    }

    // Spec P4-B1+B2: mở khóa kỳ lương (ghi log người + lý do) → phiếu chi tự sinh chuyển sang hủy
    public function unlock(Request $request): JsonResponse
    {
        $v = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'reason' => 'required|string|max:500',
        ]);
        $month = $v['month'];
        $lock = \App\Models\PayrollLock::get($month);
        if (!$lock) {
            return response()->json(['success' => false, 'message' => "Kỳ lương {$month} chưa chốt."], 422);
        }

        return DB::transaction(function () use ($request, $lock, $month, $v) {
            if ($lock->voucher_id) {
                $tx = \App\Models\Transaction::find($lock->voucher_id);
                if ($tx && $tx->status !== 'cancelled') {
                    $tx->update(['status' => 'cancelled', 'paid_amount' => 0]);
                }
            }
            \App\Models\PayrollLock::log($month, 'unlock', $request->user()?->id, $v['reason']);
            $lock->delete();
            return response()->json(['success' => true, 'message' => "Đã mở khóa kỳ lương {$month}."], 200);
        });
    }
}
