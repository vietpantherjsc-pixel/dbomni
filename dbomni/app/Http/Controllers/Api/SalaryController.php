<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Bonus;
use App\Models\Employee;
use App\Models\EmployeeInsurance;
use App\Models\Holiday;
use App\Models\SalaryAdvance;
use App\Models\SalaryDay;
use App\Models\SalaryRecord;
use App\Models\Setting;
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

        // Chi tiết từng ngày
        $days = SalaryDay::where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->orderBy('date')->get()->keyBy(fn ($d) => $d->date->format('Y-m-d'));
        $dayRows = [];
        for ($d = 1; $d <= $daysInMonth; $d++) {
            $key = sprintf('%s-%02d', $month, $d);
            $row = $days->get($key);
            $hol = $holidays->get($key);
            $dayRows[] = [
                'key' => $key,
                'date' => $d . '/' . $start->format('m/Y'),
                'check_in' => $row?->check_in,
                'check_out' => $row?->check_out,
                'hours' => (float) ($row?->hours ?? 0),
                'meal_count' => (int) ($row?->meal_count ?? 0),
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
        $violations = (int) ($record->violation_count ?? 0);
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

        // 1. Các khoản trừ khác
        $otherDeduction = (float) ($record->other_deduction ?? 0);
        $otherDeductionNote = $record->other_deduction_note ?? '';

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
        $days = SalaryDay::where('employee_id', $id)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->get()->keyBy(fn ($d) => $d->date->format('Y-m-d'));
        $out = [];
        for ($d = 1; $d <= $start->daysInMonth; $d++) {
            $key = sprintf('%s-%02d', $month, $d);
            $r = $days->get($key);
            $out[] = [
                'date' => $key,
                'check_in' => $r?->check_in, 'check_out' => $r?->check_out,
                'hours' => (float) ($r?->hours ?? 0),
                'meal_count' => (int) ($r?->meal_count ?? 0),
                'meal_manual' => (bool) ($r?->meal_manual ?? false),
            ];
        }
        // Gói 30d: trả kèm cấu hình suất ăn để frontend tự tính live
        return response()->json(['success' => true, 'data' => $out, 'meta' => [
            'meal_min_hours' => (float) Setting::get('meal_min_hours', 14.5),
            'meal_price' => (float) Setting::get('meal_price', Setting::get('meal_allowance_amount', 25000)),
        ]]);
    }

    // POST /api/salary/{employee}/days  { month, days: [{date, check_in, check_out, hours, meal_count}] }
    public function saveDays(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'days' => 'required|array',
            'days.*.date' => 'required|date',
            'days.*.check_in' => 'nullable|string|max:5',
            'days.*.check_out' => 'nullable|string|max:5',
            'days.*.hours' => 'nullable|numeric|min:0|max:24',
            'days.*.meal_count' => 'nullable|integer|min:0|max:10',
            'days.*.meal_manual' => 'nullable|boolean',
        ]);
        // Gói 30d: ngưỡng giờ tự tính suất ăn
        $mealThreshold = (float) Setting::get('meal_min_hours', 14.5);
        DB::transaction(function () use ($id, $validated, $mealThreshold) {
            foreach ($validated['days'] as $d) {
                $hours = $d['hours'] ?? 0;
                // Tự tính giờ từ giờ vào/ra nếu không nhập tay
                if (empty($d['hours']) && !empty($d['check_in']) && !empty($d['check_out'])) {
                    try {
                        $in = Carbon::createFromFormat('H:i', substr($d['check_in'], 0, 5));
                        $out = Carbon::createFromFormat('H:i', substr($d['check_out'], 0, 5));
                        if ($out->lessThan($in)) $out->addDay(); // ca qua đêm
                        $hours = round($in->diffInMinutes($out) / 60, 2);
                    } catch (\Exception $e) { /* giữ 0 */ }
                }
                // Gói 30d: suất ăn — chỉnh tay thì giữ nguyên, không thì tự tính (>= ngưỡng giờ = 1 suất)
                $mealManual = !empty($d['meal_manual']);
                $mealCount = $mealManual ? (int) ($d['meal_count'] ?? 0) : ($hours >= $mealThreshold ? 1 : 0);
                // Chỉ lưu ngày có dữ liệu; ngày trắng thì xóa
                if (empty($d['check_in']) && empty($d['check_out']) && !$hours && !$mealCount) {
                    SalaryDay::where('employee_id', $id)->where('date', $d['date'])->delete();
                    continue;
                }
                SalaryDay::updateOrCreate(
                    ['employee_id' => $id, 'date' => $d['date']],
                    ['check_in' => $d['check_in'] ?: null, 'check_out' => $d['check_out'] ?: null,
                     'hours' => $hours, 'meal_count' => $mealCount, 'meal_manual' => $mealManual]
                );
            }
        });
        return response()->json(['success' => true, 'message' => 'Đã lưu chi tiết ngày công.']);
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
        ]);
        foreach ($validated as $k => $v) Setting::set($k, $v);
        return response()->json(['success' => true, 'data' => $validated]);
    }

    // ---------- Gói 30: Số lỗi vi phạm trong tháng ----------
    // PUT /api/salary/{employee}/violations  { month, violation_count, violation_note }
    public function saveViolations(Request $request, int $id): JsonResponse
    {
        Employee::findOrFail($id);
        $validated = $request->validate([
            'month' => 'required|regex:/^\d{4}-\d{2}$/',
            'violation_count' => 'required|integer|min:0|max:100',
            'violation_note' => 'nullable|string|max:255',
        ]);
        $rec = SalaryRecord::updateOrCreate(
            ['employee_id' => $id, 'month' => $validated['month']],
            ['violation_count' => $validated['violation_count'],
             'violation_note' => $validated['violation_note'] ?? null]
        );
        return response()->json(['success' => true, 'data' => $rec]);
    }
}
