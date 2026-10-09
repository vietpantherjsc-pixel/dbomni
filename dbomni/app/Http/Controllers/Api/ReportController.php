<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Branch;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Recipe;
use App\Models\Setting;
use App\Models\ShiftExpense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// =====================================================================
// Gói 15 (2026-10-08): Trang Báo cáo cho Giám đốc — code từ demo v3 đã chốt.
// Một endpoint duy nhất GET /api/reports/overview trả đủ số liệu 4 tab:
//   Doanh thu / Thu–Chi–Lợi nhuận / Hao hụt nguyên liệu / Mặt hàng.
//
// Quy ước dữ liệu (ghi rõ để Đại Vương kiểm chứng):
// - Đơn tính doanh thu: payment_status = 'paid' VÀ status != 'cancelled'
//   (khớp tab "Đã thanh toán" ở trang Hóa đơn).
// - VAT: orders không lưu tax_amount nên tính theo từng dòng món:
//   vat = line_total * r/(1+r), với r = products.tax_rate ?? settings.default_tax_rate.
//   Toggle tax_included chỉ đổi cách HIỂN THỊ (gồm/chưa gồm thuế), số gốc không đổi.
// - Kênh bán: online_channel='zalo' -> Zalo Mini App; payment_method chứa
//   'grab' -> GrabFood; còn lại -> Tại quầy.
// - Chi phí gồm 2 phần: (1) vốn nguyên liệu ước tính từ BOM (recipes × SL bán
//   × giá vốn bình quân các lô active); (2) chi phí ca từ shift_expenses
//   (reason chứa "lương" -> Lương, còn lại -> Chi khác). Không có lương/mặt
//   bằng riêng trong DB nên chưa tách được như demo.
// - Hao hụt: "Xuất theo BOM" từ định mức; "Thực tế" = lượng NHẬP trong kỳ
//   (batches.created_at trong kỳ) theo giả định tồn đầu ≈ tồn cuối — chỉ là
//   ước tính, sẽ chính xác khi có lịch sử kiểm kho (Gói 16).
// - Múi giờ: Asia/Ho_Chi_Minh. Kỳ: day=từng ngày; week=T2–CN; month=tháng DL;
//   year=năm DL. So sánh: previous (kỳ liền trước), lastyear (cùng kỳ năm
//   trước), custom (compare_from/compare_to).
// =====================================================================
class ReportController extends Controller
{
    public function overview(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        $branchId = (int) $request->query('branch_id', 0);
        $period = $request->query('period', 'week');
        if (!in_array($period, ['day', 'week', 'month', 'year'], true)) {
            $period = 'week';
        }
        $dateStr = $request->query('date');
        try {
            $anchor = $dateStr
                ? Carbon::parse($dateStr, $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $anchor = Carbon::now($tz)->startOfDay();
        }
        $compare = $request->query('compare', 'previous');
        if (!in_array($compare, ['previous', 'lastyear', 'custom'], true)) {
            $compare = 'previous';
        }
        $taxIncluded = $request->query('tax_included', '1') !== '0';
        $vatRate = (float) Setting::get('default_tax_rate', 8);
        $page = max(1, (int) $request->query('page', 1));
        $productFilter = $request->query('product_filter', 'top');
        if (!in_array($productFilter, ['top', 'slow', 'all'], true)) {
            $productFilter = 'top';
        }

        [$from, $to] = $this->window($period, $anchor);
        [$cFrom, $cTo] = $this->compareWindow($period, $anchor, $compare, $request, $tz);

        $branchName = $branchId > 0
            ? (Branch::find($branchId)->name ?? ('Chi nhánh #' . $branchId))
            : 'Tất cả chi nhánh';

        $cur = $this->buildPeriod($branchId, $from, $to, $vatRate, $tz);
        $ref = $this->buildPeriod($branchId, $cFrom, $cTo, $vatRate, $tz);

        $disp = fn(float $gross, float $vat): float => $taxIncluded ? $gross : max(0, $gross - $vat);

        // Tỉ lệ hiển thị theo toggle thuế — dùng cho các số liệu không tách được VAT
        // riêng từng phần (kênh, giờ, cột biểu đồ): displayed/gross của toàn kỳ.
        $taxRatio = $cur['gross'] > 0 ? $disp($cur['gross'], $cur['vat']) / $cur['gross'] : 1.0;

        // ---------- Tab 1: Doanh thu ----------
        $revDisplayed = $disp($cur['gross'], $cur['vat']);
        $refDisplayed = $disp($ref['gross'], $ref['vat']);
        $revenue = [
            'gross' => $this->r2($cur['gross']),
            'vat' => $this->r2($cur['vat']),
            'net' => $this->r2(max(0, $cur['gross'] - $cur['vat'])),
            'displayed' => $this->r2($revDisplayed),
            'orders' => $cur['orders'],
            'avg' => $cur['orders'] > 0 ? $this->r2($revDisplayed / $cur['orders']) : 0,
            'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
            'delta_orders' => $this->pct($cur['orders'], $ref['orders']),
            'delta_avg' => $this->pct(
                $cur['orders'] > 0 ? $revDisplayed / $cur['orders'] : 0,
                $ref['orders'] > 0 ? $refDisplayed / $ref['orders'] : 0
            ),
            'delta_vat' => $this->pct($cur['vat'], $ref['vat']),
            'buckets' => $this->buckets($period, $branchId, $from, $to, $tz, $taxRatio),
            'top_products' => $this->topProducts($cur, $ref, 5, $disp),
            'channels' => $this->channels($cur, $ref, $taxRatio),
            'hourly' => $this->hourly($branchId, $from, $to, $taxRatio),
            // Gói 17: thêm 2 block chi tiết (cộng thêm, frontend cũ bỏ qua)
            'by_payment' => $this->byPayment($branchId, $from, $to, $cFrom, $cTo, $taxRatio),
            'by_category' => $this->byCategory($branchId, $from, $to, $cFrom, $cTo, $taxRatio),
        ];

        // ---------- Tab 2: Thu – Chi – Lợi nhuận ----------
        $costs = $this->costs($cur);
        $refCosts = $this->costs($ref);
        $costTotal = array_sum(array_column($costs, 'value'));
        $refCostTotal = array_sum(array_column($refCosts, 'value'));
        $profit = $revDisplayed - $costTotal;
        $refProfit = $refDisplayed - $refCostTotal;
        $profitData = [
            'revenue' => $this->r2($revDisplayed),
            'costs' => array_map(fn($c) => [
                'name' => $c['name'], 'value' => $this->r2($c['value']), 'color' => $c['color'],
            ], $costs),
            'cost_total' => $this->r2($costTotal),
            'profit' => $this->r2($profit),
            'margin' => $revDisplayed > 0 ? $this->r2($profit / $revDisplayed * 100) : 0,
            'delta_profit' => $this->pct($profit, $refProfit),
            'delta_cost' => $this->pct($costTotal, $refCostTotal),
            'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
            'groups' => $this->profitGroups($period, $branchId, $from, $to, $vatRate, $tz, $disp),
        ];

        // ---------- Tab 3: Hao hụt ----------
        $wasteData = [
            'items' => $this->waste($cur, $branchId),
            'note' => 'Thực tế tiêu hao = lượng nhập kho trong kỳ (giả định tồn đầu ≈ tồn cuối). '
                . 'Số liệu sẽ chính xác hơn khi có lịch sử kiểm kho (Gói 16).',
        ];

        // ---------- Tab 4: Mặt hàng ----------
        $productsData = $this->products($cur, $ref, $productFilter, $page, $disp);

        return response()->json([
            'success' => true,
            'data' => [
                'meta' => [
                    'branch_id' => $branchId,
                    'branch_name' => $branchName,
                    'period' => $period,
                    'date' => $anchor->toDateString(),
                    'from' => $from->toDateTimeString(),
                    'to' => $to->toDateTimeString(),
                    'compare' => $compare,
                    'compare_from' => $cFrom->toDateTimeString(),
                    'compare_to' => $cTo->toDateTimeString(),
                    'tax_included' => $taxIncluded,
                    'vat_rate' => $vatRate,
                ],
                'revenue' => $revenue,
                'profit' => $profitData,
                'waste' => $wasteData,
                'products' => $productsData,
            ],
        ]);
    }

    // ================= Kỳ báo cáo =================

    /** [start, end] của kỳ hiện tại (bao cả 2 đầu). */
    private function window(string $period, Carbon $anchor): array
    {
        switch ($period) {
            case 'day':
                return [$anchor->copy()->startOfDay(), $anchor->copy()->endOfDay()];
            case 'month':
                return [$anchor->copy()->startOfMonth()->startOfDay(), $anchor->copy()->endOfMonth()->endOfDay()];
            case 'year':
                return [$anchor->copy()->startOfYear()->startOfDay(), $anchor->copy()->endOfYear()->endOfDay()];
            case 'week':
            default:
                // Tuần T2–CN chứa ngày mốc
                return [$anchor->copy()->startOfWeek(Carbon::MONDAY)->startOfDay(),
                        $anchor->copy()->endOfWeek(Carbon::SUNDAY)->endOfDay()];
        }
    }

    /** [start, end] của kỳ so sánh. */
    private function compareWindow(string $period, Carbon $anchor, string $compare, Request $request, string $tz): array
    {
        [$from, $to] = $this->window($period, $anchor);
        if ($compare === 'lastyear') {
            return [$from->copy()->subYear(), $to->copy()->subYear()];
        }
        if ($compare === 'custom') {
            try {
                $cf = Carbon::parse($request->query('compare_from'), $tz)->startOfDay();
                $ct = Carbon::parse($request->query('compare_to'), $tz)->endOfDay();
            } catch (\Exception $e) {
                $days = $from->diffInDays($to);
                return [$from->copy()->subDays($days + 1), $to->copy()->subDays($days + 1)];
            }
            if ($cf->gt($ct)) {
                [$cf, $ct] = [$ct->copy()->startOfDay(), $cf->copy()->endOfDay()];
            }
            return [$cf, $ct];
        }
        // previous: kỳ liền trước, cùng độ dài
        $days = $from->diffInDays($to);
        return [$from->copy()->subDays($days + 1), $to->copy()->subDays($days + 1)];
    }

    // ================= Truy vấn gốc =================

    private function baseOrders(int $branchId, Carbon $from, Carbon $to)
    {
        $q = Order::query()
            ->where('payment_status', 'paid')
            ->where('status', '!=', 'cancelled')
            ->whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()]);
        if ($branchId > 0) {
            $q->where('branch_id', $branchId);
        }
        return $q;
    }

    /**
     * Gom toàn bộ dữ liệu thô của 1 kỳ: đơn, dòng món, VAT, kênh, tồn theo giờ.
     * Trả về mảng để các tab dùng chung, tránh truy vấn lặp.
     */
    private function buildPeriod(int $branchId, Carbon $from, Carbon $to, float $vatRate, string $tz): array
    {
        $orderIds = $this->baseOrders($branchId, $from, $to)->pluck('id');
        $gross = (float) $this->baseOrders($branchId, $from, $to)->sum('total_amount');
        $orderCount = $orderIds->count();

        $items = collect();
        $vat = 0.0;
        if ($orderCount > 0) {
            $items = DB::table('order_items')
                ->leftJoin('products', 'products.id', '=', 'order_items.product_id')
                ->whereIn('order_items.order_id', $orderIds)
                ->select(
                    'order_items.product_id',
                    'order_items.product_option_id',
                    'order_items.product_name',
                    'order_items.quantity',
                    DB::raw('COALESCE(order_items.total_price, order_items.subtotal, order_items.unit_price * order_items.quantity, 0) AS line_total'),
                    DB::raw('COALESCE(products.tax_rate, ' . $vatRate . ') AS tax_rate')
                )
                ->get();
            foreach ($items as $it) {
                $r = ((float) $it->tax_rate) / 100;
                $vat += ((float) $it->line_total) * $r / (1 + $r);
            }
        }

        // Kênh bán: gom theo đơn
        $orders = $this->baseOrders($branchId, $from, $to)
            ->select('id', 'online_channel', 'payment_method', 'total_amount', 'created_at')
            ->get();
        $channels = ['counter' => 0.0, 'zalo' => 0.0, 'grabfood' => 0.0];
        foreach ($orders as $o) {
            $channels[$this->channelKey($o)] += (float) $o->total_amount;
        }

        return [
            'branch_id' => $branchId,
            'from' => $from, 'to' => $to,
            'gross' => $gross, 'vat' => $vat, 'orders' => $orderCount,
            'items' => $items, 'channels' => $channels,
        ];
    }

    private function channelKey($order): string
    {
        if (($order->online_channel ?? '') === 'zalo') {
            return 'zalo';
        }
        if (stripos((string) ($order->payment_method ?? ''), 'grab') !== false) {
            return 'grabfood';
        }
        return 'counter';
    }

    // ================= Tab 1: Doanh thu =================

    private function topProducts(array $cur, array $ref, int $limit, callable $disp): array
    {
        $agg = $this->productAgg($cur['items']);
        $refAgg = $this->productAgg($ref['items']);
        $rows = [];
        // Gói 25: badge "đang ẩn ở CN X" — số liệu đơn cũ giữ nguyên
        $pids = array_keys(array_slice($agg, 0, $limit, true));
        $hiddenMap = [];
        if (!empty($pids)) {
            foreach (\App\Models\BranchProductHidden::with('branch:id,name')->whereIn('product_id', $pids)->get() as $h) {
                $hiddenMap[$h->product_id][] = $h->branch->name;
            }
        }
        foreach (array_slice($agg, 0, $limit, true) as $pid => $a) {
            $ra = $refAgg[$pid] ?? ['revenue' => 0, 'quantity' => 0];
            $rows[] = [
                'product_id' => $pid,
                'name' => $a['name'],
                'quantity' => $a['quantity'],
                'revenue' => $this->r2($disp($a['revenue'], $a['vat'])),
                'delta' => $this->pct($a['revenue'], $ra['revenue']),
                'hidden_branches' => array_values(array_unique($hiddenMap[$pid] ?? [])),
            ];
        }
        return $rows;
    }

    /** Gom dòng món theo product_id: quantity, revenue, vat, name. Sắp xếp revenue giảm dần. */
    private function productAgg($items): array
    {
        $agg = [];
        foreach ($items as $it) {
            $pid = $it->product_id ?? 0;
            if (!isset($agg[$pid])) {
                $agg[$pid] = ['name' => $it->product_name ?? ('Món #' . $pid), 'quantity' => 0, 'revenue' => 0.0, 'vat' => 0.0];
            }
            $agg[$pid]['quantity'] += (float) $it->quantity;
            $agg[$pid]['revenue'] += (float) $it->line_total;
            $r = ((float) $it->tax_rate) / 100;
            $agg[$pid]['vat'] += ((float) $it->line_total) * $r / (1 + $r);
        }
        uasort($agg, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
        return $agg;
    }

    private function channels(array $cur, array $ref, float $taxRatio): array
    {
        $labels = ['counter' => 'Tại quầy', 'zalo' => 'Zalo Mini App', 'grabfood' => 'GrabFood'];
        $colors = ['counter' => '#24305E', 'zalo' => '#F5A623', 'grabfood' => '#5B8DEF'];
        $out = [];
        foreach ($labels as $key => $name) {
            $v = $cur['channels'][$key] ?? 0.0;
            $rv = $ref['channels'][$key] ?? 0.0;
            $out[] = [
                'key' => $key,
                'name' => $name,
                'value' => $this->r2($v * $taxRatio),
                'share' => $cur['gross'] > 0 ? $this->r2($v / $cur['gross'] * 100) : 0,
                'delta' => $this->pct($v, $rv),
                'color' => $colors[$key],
            ];
        }
        return $out;
    }

    /** Doanh thu theo giờ 6h→22h (giờ có đơn đầu tiên → cuối cùng trong ngày). */
    private function hourly(int $branchId, Carbon $from, Carbon $to, float $taxRatio): array
    {
        $rows = $this->baseOrders($branchId, $from, $to)
            ->select(DB::raw('HOUR(created_at) AS h'), DB::raw('SUM(total_amount) AS v'))
            ->groupBy('h')
            ->pluck('v', 'h');
        $map = [];
        foreach ($rows as $k => $v) {
            $map[(int) $k] = (float) $v;
        }
        $out = [];
        for ($h = 6; $h <= 22; $h++) {
            $out[] = ['hour' => $h, 'value' => $this->r2(($map[$h] ?? 0.0) * $taxRatio)];
        }
        return $out;
    }

    /** Các cột cho biểu đồ doanh thu: day→giờ, week→ngày, month→tuần, year→tháng. */
    private function buckets(string $period, int $branchId, Carbon $from, Carbon $to, string $tz, float $taxRatio): array
    {
        $defs = $this->bucketDefs($period, $from, $to, $tz);
        $out = [];
        foreach ($defs as $d) {
            $gross = (float) $this->baseOrders($branchId, $d['from'], $d['to'])->sum('total_amount');
            $out[] = ['label' => $d['label'], 'value' => $this->r2($gross * $taxRatio)];
        }
        return $out;
    }

    private function bucketDefs(string $period, Carbon $from, Carbon $to, string $tz): array
    {
        $defs = [];
        if ($period === 'day') {
            for ($h = 6; $h <= 22; $h++) {
                $defs[] = [
                    'label' => $h . 'h',
                    'from' => $from->copy()->setTime($h, 0, 0),
                    'to' => $from->copy()->setTime($h, 59, 59),
                ];
            }
            return $defs;
        }
        if ($period === 'week') {
            $wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
            for ($i = 0; $i < 7; $i++) {
                $d = $from->copy()->addDays($i);
                $defs[] = [
                    'label' => $wd[$d->dayOfWeek] . ' ' . $d->format('d/m'),
                    'from' => $d->copy()->startOfDay(),
                    'to' => $d->copy()->endOfDay(),
                ];
            }
            return $defs;
        }
        if ($period === 'month') {
            $start = $from->copy();
            $n = 1;
            while ($start->lte($to)) {
                $end = $start->copy()->addDays(6);
                if ($end->gt($to)) {
                    $end = $to->copy();
                }
                $defs[] = [
                    'label' => 'Tuần ' . $n,
                    'from' => $start->copy()->startOfDay(),
                    'to' => $end->copy()->endOfDay(),
                ];
                $start = $end->copy()->addDay();
                $n++;
            }
            return $defs;
        }
        // year: 12 tháng
        for ($m = 1; $m <= 12; $m++) {
            $d = $from->copy()->month($m);
            $defs[] = [
                'label' => 'T' . $m,
                'from' => $d->copy()->startOfMonth()->startOfDay(),
                'to' => $d->copy()->endOfMonth()->endOfDay(),
            ];
        }
        return $defs;
    }

    // ================= Tab 2: Thu – Chi – Lợi nhuận =================

    /**
     * Chi phí của 1 kỳ: vốn nguyên liệu (BOM × giá vốn BQ lô active) +
     * chi phí ca (shift_expenses: reason chứa "lương" -> Lương).
     */
    private function costs(array $p): array
    {
        $bom = $this->bomCost($p);
        $exp = $this->shiftExpenses($p);
        return [
            ['name' => 'Nguyên liệu', 'value' => $bom, 'color' => '#F5A623'],
            ['name' => 'Lương', 'value' => $exp['salary'], 'color' => '#24305E'],
            ['name' => 'Chi khác', 'value' => $exp['other'], 'color' => '#7C8DB0'],
        ];
    }

    /** Vốn nguyên liệu ước tính: recipes × SL bán × giá vốn BQ (lô active). */
    private function bomCost(array $p): float
    {
        if ($p['items']->isEmpty()) {
            return 0.0;
        }
        $recipes = Recipe::query()->select('product_id', 'product_option_id', 'material_id', 'quantity')->get();
        if ($recipes->isEmpty()) {
            return 0.0;
        }
        // Giá vốn BQ theo nguyên liệu (lô active; có lọc chi nhánh khi xem 1 CN)
        $costQ = Batch::query()->where('status', 'active')->where('current_quantity', '>', 0);
        if ($p['branch_id'] > 0) {
            $costQ->where('branch_id', $p['branch_id']);
        }
        $avgCost = [];
        foreach ($costQ->select('material_id', 'current_quantity', 'unit_cost')->get() as $b) {
            $mid = $b->material_id;
            if (!isset($avgCost[$mid])) {
                $avgCost[$mid] = ['q' => 0.0, 'c' => 0.0];
            }
            $avgCost[$mid]['q'] += (float) $b->current_quantity;
            $avgCost[$mid]['c'] += (float) $b->current_quantity * (float) $b->unit_cost;
        }
        foreach ($avgCost as $mid => $a) {
            $avgCost[$mid] = $a['q'] > 0 ? $a['c'] / $a['q'] : 0.0;
        }

        $total = 0.0;
        foreach ($p['items'] as $it) {
            foreach ($recipes as $r) {
                if ((int) $r->product_id !== (int) $it->product_id) {
                    continue;
                }
                if ($r->product_option_id !== null && (int) $r->product_option_id !== (int) $it->product_option_id) {
                    continue;
                }
                $unitCost = $avgCost[$r->material_id] ?? 0.0;
                $total += (float) $r->quantity * (float) $it->quantity * $unitCost;
            }
        }
        return $total;
    }

    private function shiftExpenses(array $p): array
    {
        $rows = ShiftExpense::query()
            ->join('shifts', 'shifts.id', '=', 'shift_expenses.shift_id')
            ->whereBetween('shifts.opened_at', [$p['from']->toDateTimeString(), $p['to']->toDateTimeString()])
            ->when($p['branch_id'] > 0, fn($q) => $q->where('shifts.branch_id', $p['branch_id']))
            ->select('shift_expenses.amount', 'shift_expenses.reason')
            ->get();
        $salary = 0.0;
        $other = 0.0;
        foreach ($rows as $r) {
            $reason = mb_strtolower((string) ($r->reason ?? ''));
            if (str_contains($reason, 'lương') || str_contains($reason, 'luong')) {
                $salary += (float) $r->amount;
            } else {
                $other += (float) $r->amount;
            }
        }
        return ['salary' => $salary, 'other' => $other];
    }

    /** Cột kép Thu/Chi/Lợi nhuận theo từng bucket của kỳ. */
    private function profitGroups(string $period, int $branchId, Carbon $from, Carbon $to, float $vatRate, string $tz, callable $disp, bool $withCommission = false): array
    {
        $defs = $this->bucketDefs($period, $from, $to, $tz);
        $out = [];
        foreach ($defs as $d) {
            $p = $this->buildPeriod($branchId, $d['from'], $d['to'], $vatRate, $tz);
            $rev = $disp($p['gross'], $p['vat']);
            $costs = $this->costs($p);
            $cost = array_sum(array_column($costs, 'value'));
            if ($withCommission) {
                // Gói 17: cộng chiết khấu kênh vào chi phí từng cột (chỉ trang PNL mới)
                $cost += array_sum(array_column($this->commissions($p), 'cost'));
            }
            $out[] = [
                'label' => $d['label'],
                'thu' => $this->r2($rev),
                'chi' => $this->r2($cost),
                'loi_nhuan' => $this->r2($rev - $cost),
            ];
        }
        return $out;
    }

    // ================= Tab 3: Hao hụt =================

    private function waste(array $cur, int $branchId): array
    {
        $recipes = Recipe::query()->select('product_id', 'product_option_id', 'material_id', 'quantity')->get();
        if ($recipes->isEmpty() || $cur['items']->isEmpty()) {
            return [];
        }
        $bomCur = $this->bomQty($cur['items'], $recipes);
        if (empty($bomCur)) {
            return [];
        }

        // Thực tế tiêu hao ≈ lượng nhập trong kỳ (giả định tồn đầu ≈ tồn cuối)
        $actual = [];
        $bq = Batch::query()
            ->whereBetween('created_at', [$cur['from']->toDateTimeString(), $cur['to']->toDateTimeString()]);
        if ($branchId > 0) {
            $bq->where('branch_id', $branchId);
        }
        foreach ($bq->select('material_id', DB::raw('SUM(initial_quantity) AS q'))->groupBy('material_id')->get() as $row) {
            $actual[$row->material_id] = (float) $row->q;
        }

        $materials = DB::table('materials')->select('id', 'name', 'unit')->get()->keyBy('id');
        $out = [];
        foreach ($bomCur as $mid => $bom) {
            $act = $actual[$mid] ?? 0.0;
            $diff = $act - $bom;
            $pct = $bom > 0 ? $diff / $bom * 100 : null;
            $m = $materials[$mid] ?? null;
            $out[] = [
                'material_id' => $mid,
                'material' => $m->name ?? ('Nguyên liệu #' . $mid),
                'unit' => $m->unit ?? '',
                'bom_qty' => $this->r2($bom),
                'actual_qty' => $this->r2($act),
                'diff' => $this->r2($diff),
                'waste_pct' => $pct === null ? null : $this->r2($pct),
                'delta_pct' => null, // chưa có kỳ SS cho số nhập — ghi rõ
                '_sort' => $pct ?? -9999,
            ];
        }
        usort($out, fn($a, $b) => $b['_sort'] <=> $a['_sort']);
        return array_map(function ($r) {
            unset($r['_sort']);
            return $r;
        }, $out);
    }

    /** Lượng nguyên liệu phải xuất theo BOM từ các dòng món đã bán. */
    private function bomQty($items, $recipes): array
    {
        $out = [];
        foreach ($items as $it) {
            foreach ($recipes as $r) {
                if ((int) $r->product_id !== (int) $it->product_id) {
                    continue;
                }
                if ($r->product_option_id !== null && (int) $r->product_option_id !== (int) $it->product_option_id) {
                    continue;
                }
                $mid = $r->material_id;
                $out[$mid] = ($out[$mid] ?? 0.0) + (float) $r->quantity * (float) $it->quantity;
            }
        }
        return $out;
    }

    // ================= Tab 4: Mặt hàng =================

    private function products(array $cur, array $ref, string $filter, int $page, callable $disp): array
    {
        $agg = $this->productAgg($cur['items']);
        $refAgg = $this->productAgg($ref['items']);
        $perPage = 10;

        if ($filter === 'slow') {
            $list = array_reverse($agg, true);
            $list = array_slice($list, 0, 10, true);
            $total = count($list);
            $page = 1;
        } elseif ($filter === 'top') {
            $list = array_slice($agg, 0, 10, true);
            $total = count($list);
            $page = 1;
        } else {
            $total = count($agg);
            $list = array_slice($agg, ($page - 1) * $perPage, $perPage, true);
        }

        $items = [];
        $rank = ($filter === 'all') ? ($page - 1) * $perPage : 0;
        foreach ($list as $pid => $a) {
            $rank++;
            $ra = $refAgg[$pid] ?? ['revenue' => 0];
            $items[] = [
                'product_id' => $pid,
                'rank' => $rank,
                'name' => $a['name'],
                'quantity' => $a['quantity'],
                'revenue' => $this->r2($disp($a['revenue'], $a['vat'])),
                'share_pct' => $cur['gross'] > 0 ? $this->r2($a['revenue'] / $cur['gross'] * 100) : 0,
                'delta' => $this->pct($a['revenue'], $ra['revenue']),
            ];
        }
        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'has_more' => $filter === 'all' && $page * $perPage < $total,
        ];
    }

    // ================= Gói 17: Doanh thu theo PTTT & Danh mục =================

    private function paymentAgg(int $branchId, Carbon $from, Carbon $to): array
    {
        $rows = $this->baseOrders($branchId, $from, $to)
            ->select('payment_method', DB::raw('SUM(total_amount) AS v'), DB::raw('COUNT(*) AS c'))
            ->groupBy('payment_method')
            ->orderByDesc('v')
            ->get();
        $out = [];
        foreach ($rows as $r) {
            $key = (string) ($r->payment_method ?? '');
            $out[$key === '' ? 'unknown' : $key] = ['v' => (float) $r->v, 'c' => (int) $r->c];
        }
        return $out;
    }

    private function paymentLabel(string $key): string
    {
        $map = [
            'cash' => 'Tiền mặt', 'transfer' => 'Chuyển khoản', 'bank' => 'Chuyển khoản',
            'card' => 'Thẻ', 'momo' => 'MoMo', 'vnpay' => 'VNPay',
            'zalopay' => 'ZaloPay', 'shopeepay' => 'ShopeePay', 'unknown' => 'Không rõ',
        ];
        if (isset($map[$key])) {
            return $map[$key];
        }
        if (stripos($key, 'grab') !== false) {
            return 'GrabFood';
        }
        return ucwords(str_replace('_', ' ', $key));
    }

    /** Doanh thu theo phương thức thanh toán (kỳ hiện tại + delta kỳ SS). */
    private function byPayment(int $branchId, Carbon $from, Carbon $to, Carbon $cFrom, Carbon $cTo, float $taxRatio): array
    {
        $cur = $this->paymentAgg($branchId, $from, $to);
        $ref = $this->paymentAgg($branchId, $cFrom, $cTo);
        $total = array_sum(array_column($cur, 'v'));
        $out = [];
        foreach ($cur as $key => $a) {
            $rv = $ref[$key]['v'] ?? 0.0;
            $out[] = [
                'key' => $key,
                'name' => $this->paymentLabel($key),
                'value' => $this->r2($a['v'] * $taxRatio),
                'orders' => $a['c'],
                'share' => $total > 0 ? $this->r2($a['v'] / $total * 100) : 0,
                'delta' => $this->pct($a['v'], $rv),
            ];
        }
        return $out;
    }

    private function categoryAgg(int $branchId, Carbon $from, Carbon $to): array
    {
        $ids = $this->baseOrders($branchId, $from, $to)->pluck('id');
        if ($ids->isEmpty()) {
            return [];
        }
        $rows = DB::table('order_items')
            ->leftJoin('products', 'products.id', '=', 'order_items.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->whereIn('order_items.order_id', $ids)
            ->select(
                DB::raw('COALESCE(categories.id, 0) AS cid'),
                DB::raw("COALESCE(categories.name, 'Chưa phân loại') AS cname"),
                DB::raw('SUM(COALESCE(order_items.total_price, order_items.subtotal, order_items.unit_price * order_items.quantity, 0)) AS v')
            )
            ->groupBy('cid', 'cname')
            ->orderByDesc('v')
            ->get();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r->cid] = ['name' => $r->cname, 'v' => (float) $r->v];
        }
        return $out;
    }

    /** Doanh thu theo danh mục mặt hàng (kỳ hiện tại + delta kỳ SS). */
    private function byCategory(int $branchId, Carbon $from, Carbon $to, Carbon $cFrom, Carbon $cTo, float $taxRatio): array
    {
        $cur = $this->categoryAgg($branchId, $from, $to);
        $ref = $this->categoryAgg($branchId, $cFrom, $cTo);
        $total = array_sum(array_column($cur, 'v'));
        $out = [];
        foreach ($cur as $cid => $a) {
            $rv = $ref[$cid]['v'] ?? 0.0;
            $out[] = [
                'category_id' => $cid,
                'name' => $a['name'],
                'value' => $this->r2($a['v'] * $taxRatio),
                'share' => $total > 0 ? $this->r2($a['v'] / $total * 100) : 0,
                'delta' => $this->pct($a['v'], $rv),
            ];
        }
        return $out;
    }

    // ================= Gói 17: Chiết khấu kênh bán =================

    /**
     * Map kênh báo cáo -> mã price_lists (thứ tự ưu tiên khi tìm).
     * Quy tắc (ghi rõ cho Đại Vương kiểm chứng):
     * - counter (Tại quầy: online_channel='pos', PTTT không chứa 'grab') -> 'nha_hang'
     * - zalo (Zalo Mini App: online_channel='zalo') -> 'online', rồi 'zalo'
     * - grabfood (PTTT chứa 'grab') -> 'grabfood'
     */
    private function channelPriceListCodes(): array
    {
        return [
            'counter' => ['nha_hang'],
            'zalo' => ['online', 'zalo'],
            'grabfood' => ['grabfood'],
        ];
    }

    private function channelLabels(): array
    {
        return ['counter' => 'Tại quầy', 'zalo' => 'Zalo Mini App', 'grabfood' => 'GrabFood'];
    }

    /**
     * Chi phí chiết khấu từng kênh = doanh thu kênh (gross, gồm VAT) × %CK
     * (+ thuế nếu CK chưa gồm thuế). Trả [] nếu chưa chạy migration Gói 17.
     */
    private function commissions(array $p): array
    {
        if (!Schema::hasTable('price_lists') || !Schema::hasColumn('price_lists', 'commission_rate')) {
            return [];
        }
        $byCode = [];
        foreach (DB::table('price_lists')
            ->select('code', 'name', 'commission_rate', 'commission_tax_included', 'commission_tax_rate')
            ->get() as $pl) {
            $byCode[strtolower((string) $pl->code)] = $pl;
        }
        $labels = $this->channelLabels();
        $out = [];
        foreach ($this->channelPriceListCodes() as $chKey => $codes) {
            $pl = null;
            foreach ($codes as $c) {
                if (isset($byCode[strtolower($c)])) {
                    $pl = $byCode[strtolower($c)];
                    break;
                }
            }
            $rate = $pl ? (float) $pl->commission_rate : 0.0;
            if ($rate <= 0) {
                continue;
            }
            $rev = (float) ($p['channels'][$chKey] ?? 0.0);
            $cost = $rev * $rate / 100;
            $taxNote = 'đã gồm thuế';
            if (!$pl->commission_tax_included) {
                $tr = (float) ($pl->commission_tax_rate ?? 0);
                if ($tr > 0) {
                    $cost *= (1 + $tr / 100);
                    $taxNote = 'chưa gồm thuế (+' . $this->r2($tr) . '% thuế)';
                } else {
                    $taxNote = 'chưa gồm thuế (chưa nhập thuế suất)';
                }
            }
            $out[] = [
                'channel_key' => $chKey,
                'channel' => $labels[$chKey] ?? $chKey,
                'price_list' => $pl->name ?? $pl->code,
                'rate' => $this->r2($rate),
                'tax_note' => $taxNote,
                'revenue' => $this->r2($rev),
                'cost' => $this->r2($cost),
            ];
        }
        return $out;
    }

    // ================= Gói 17: Báo cáo kho =================

    /**
     * GET /api/reports/inventory?branch_id&period&date
     * - materials: xuất theo BOM / nhập trong kỳ / chênh lệch / % hao hụt
     *   (tái dụng logic waste() của Gói 15)
     * - expiry: lô còn tồn có hạn SD trong 30 ngày tới hoặc đã hết hạn
     */
    public function inventory(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        $branchId = (int) $request->query('branch_id', 0);
        $period = $request->query('period', 'week');
        if (!in_array($period, ['day', 'week', 'month', 'year'], true)) {
            $period = 'week';
        }
        try {
            $anchor = $request->query('date')
                ? Carbon::parse($request->query('date'), $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $anchor = Carbon::now($tz)->startOfDay();
        }
        [$from, $to] = $this->window($period, $anchor);
        $vatRate = (float) Setting::get('default_tax_rate', 8);

        $cur = $this->buildPeriod($branchId, $from, $to, $vatRate, $tz);
        $materials = array_map(fn($m) => [
            'material_id' => $m['material_id'],
            'material' => $m['material'],
            'unit' => $m['unit'],
            'imported_qty' => $m['actual_qty'],
            'exported_bom_qty' => $m['bom_qty'],
            'diff' => $m['diff'],
            'waste_pct' => $m['waste_pct'],
        ], $this->waste($cur, $branchId));

        $branchName = $branchId > 0
            ? (Branch::find($branchId)->name ?? ('Chi nhánh #' . $branchId))
            : 'Tất cả chi nhánh';

        return response()->json([
            'success' => true,
            'data' => [
                'meta' => [
                    'branch_id' => $branchId,
                    'branch_name' => $branchName,
                    'period' => $period,
                    'date' => $anchor->toDateString(),
                    'from' => $from->toDateTimeString(),
                    'to' => $to->toDateTimeString(),
                ],
                'materials' => $materials,
                'expiry' => $this->expiryBatches($branchId),
            ],
        ]);
    }

    /**
     * Các lô còn tồn (current_quantity > 0) có hạn SD trong 30 ngày tới
     * hoặc đã hết hạn. status: expired | expiring_7 | expiring_30.
     */
    private function expiryBatches(int $branchId): array
    {
        $tz = 'Asia/Ho_Chi_Minh';
        $today = Carbon::now($tz)->startOfDay();
        $limit = $today->copy()->addDays(30)->endOfDay();
        $q = Batch::query()
            ->join('materials', 'materials.id', '=', 'batches.material_id')
            ->where('batches.current_quantity', '>', 0)
            ->whereNotNull('batches.expired_at')
            ->where('batches.expired_at', '<=', $limit->toDateTimeString());
        if ($branchId > 0) {
            $q->where('batches.branch_id', $branchId);
        }
        $rows = $q->select(
                'batches.id', 'batches.batch_code', 'batches.current_quantity',
                'batches.expired_at', 'materials.name AS material_name', 'materials.unit'
            )
            ->orderBy('batches.expired_at')
            ->limit(200)
            ->get();
        $out = [];
        foreach ($rows as $b) {
            $exp = Carbon::parse($b->expired_at, $tz)->startOfDay();
            $days = (int) $today->diffInDays($exp, false);
            $status = $days < 0 ? 'expired' : ($days <= 7 ? 'expiring_7' : 'expiring_30');
            $out[] = [
                'batch_id' => $b->id,
                'batch_code' => $b->batch_code,
                'material' => $b->material_name,
                'unit' => $b->unit,
                'quantity' => $this->r2((float) $b->current_quantity),
                'expired_at' => $exp->toDateString(),
                'days_left' => $days,
                'status' => $status,
            ];
        }
        return $out;
    }

    // ================= Gói 17: Báo cáo thu chi / PNL =================

    /**
     * GET /api/reports/pnl?branch_id&period&date&compare&tax_included
     * - revenue: thu (hiển thị theo toggle thuế)
     * - income_channels: thu theo kênh
     * - costs: vốn NL + Lương + Chi khác + Chiết khấu kênh
     * - commissions: chi tiết chiết khấu từng kênh
     * - profit, margin, deltas, groups (thu/chi/LN theo kỳ)
     */
    public function pnl(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        $branchId = (int) $request->query('branch_id', 0);
        $period = $request->query('period', 'week');
        if (!in_array($period, ['day', 'week', 'month', 'year'], true)) {
            $period = 'week';
        }
        try {
            $anchor = $request->query('date')
                ? Carbon::parse($request->query('date'), $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $anchor = Carbon::now($tz)->startOfDay();
        }
        $compare = $request->query('compare', 'previous');
        if (!in_array($compare, ['previous', 'lastyear', 'custom'], true)) {
            $compare = 'previous';
        }
        $taxIncluded = $request->query('tax_included', '1') !== '0';
        $vatRate = (float) Setting::get('default_tax_rate', 8);

        [$from, $to] = $this->window($period, $anchor);
        [$cFrom, $cTo] = $this->compareWindow($period, $anchor, $compare, $request, $tz);
        $branchName = $branchId > 0
            ? (Branch::find($branchId)->name ?? ('Chi nhánh #' . $branchId))
            : 'Tất cả chi nhánh';

        $cur = $this->buildPeriod($branchId, $from, $to, $vatRate, $tz);
        $ref = $this->buildPeriod($branchId, $cFrom, $cTo, $vatRate, $tz);
        $disp = fn(float $gross, float $vat): float => $taxIncluded ? $gross : max(0, $gross - $vat);
        $taxRatio = $cur['gross'] > 0 ? $disp($cur['gross'], $cur['vat']) / $cur['gross'] : 1.0;

        $revDisplayed = $disp($cur['gross'], $cur['vat']);
        $refDisplayed = $disp($ref['gross'], $ref['vat']);

        $costs = $this->costs($cur);
        $commissions = $this->commissions($cur);
        $commTotal = array_sum(array_column($commissions, 'cost'));
        if ($commTotal > 0) {
            $costs[] = ['name' => 'Chiết khấu kênh', 'value' => $commTotal, 'color' => '#9B59B6'];
        }
        $costTotal = array_sum(array_column($costs, 'value'));

        $refCostTotal = array_sum(array_column($this->costs($ref), 'value'))
            + array_sum(array_column($this->commissions($ref), 'cost'));

        $profit = $revDisplayed - $costTotal;
        $refProfit = $refDisplayed - $refCostTotal;

        return response()->json([
            'success' => true,
            'data' => [
                'meta' => [
                    'branch_id' => $branchId,
                    'branch_name' => $branchName,
                    'period' => $period,
                    'date' => $anchor->toDateString(),
                    'from' => $from->toDateTimeString(),
                    'to' => $to->toDateTimeString(),
                    'compare' => $compare,
                    'compare_from' => $cFrom->toDateTimeString(),
                    'compare_to' => $cTo->toDateTimeString(),
                    'tax_included' => $taxIncluded,
                    'vat_rate' => $vatRate,
                ],
                'revenue' => [
                    'displayed' => $this->r2($revDisplayed),
                    'gross' => $this->r2($cur['gross']),
                    'vat' => $this->r2($cur['vat']),
                    'orders' => $cur['orders'],
                    'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
                    'delta_orders' => $this->pct($cur['orders'], $ref['orders']),
                ],
                'income_channels' => $this->channels($cur, $ref, $taxRatio),
                'costs' => array_map(fn($c) => [
                    'name' => $c['name'],
                    'value' => $this->r2($c['value']),
                    'color' => $c['color'],
                ], $costs),
                'commissions' => $commissions,
                'cost_total' => $this->r2($costTotal),
                'profit' => $this->r2($profit),
                'margin' => $revDisplayed > 0 ? $this->r2($profit / $revDisplayed * 100) : 0,
                'delta_profit' => $this->pct($profit, $refProfit),
                'delta_cost' => $this->pct($costTotal, $refCostTotal),
                'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
                'groups' => $this->profitGroups($period, $branchId, $from, $to, $vatRate, $tz, $disp, true),
            ],
        ]);
    }

    // ================= Helpers =================

    private function pct($cur, $ref): ?float
    {
        $cur = (float) $cur;
        $ref = (float) $ref;
        if ($ref == 0) {
            return null;
        }
        return $this->r2(($cur - $ref) / abs($ref) * 100);
    }

    private function r2($v): float
    {
        return round((float) $v, 2);
    }
}
