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
use App\Models\StockMovement;
use App\Models\Stocktake;
use App\Models\Transaction;
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
// - Kênh bán (Gói 56): động theo online_channel thực tế của đơn
//   (chuẩn hóa lowercase; rỗng -> 'pos'). Tên hiển thị: 'pos' -> Tại quầy,
//   'zalo' -> Zalo Mini App, còn lại lấy name từ price_lists theo code.
//   Lãi gộp/kênh = doanh thu - phí sàn (commission_rate của price_lists)
//   - giá vốn (SUM unit_cost × SL).
// - Chi phí gồm 2 phần: (1) vốn nguyên liệu ước tính từ BOM (recipes × SL bán
//   × giá vốn bình quân các lô active); (2) chi phí ca từ shift_expenses
//   (reason chứa "lương" -> Lương, còn lại -> Chi khác).
//   Gói 55 p11ad: kỳ = trọn tháng DL → dòng "Lương" lấy từ bảng chấm công
//   (salary_days × đơn giá giờ), chính xác hơn dò chuỗi; kỳ khác vẫn dùng shift_expenses.
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

        // Gói 55 p11af (P0-14): Food cost % = giá vốn nguyên liệu / doanh thu thuần (sau VAT).
        // Tính 1 lần ở đây để tái dùng cho cả Tab 1 (KPI) và Tab 2 (chi phí), tránh tính 2 lần.
        $foodCostValue = $this->bomCost($cur);
        $netRevenueForFoodCost = max(0, $cur['gross'] - $cur['vat']);
        $foodCostPct = $netRevenueForFoodCost > 0
            ? round($foodCostValue / $netRevenueForFoodCost * 100, 1)
            : 0;

        $disp = fn(float $gross, float $vat): float => $taxIncluded ? $gross : max(0, $gross - $vat);

        // Tỉ lệ hiển thị theo toggle thuế — dùng cho các số liệu không tách được VAT
        // riêng từng phần (kênh, giờ, cột biểu đồ): displayed/gross của toàn kỳ.
        $taxRatio = $cur['gross'] > 0 ? $disp($cur['gross'], $cur['vat']) / $cur['gross'] : 1.0;

        // ---------- Tab 1: Doanh thu ----------
        $revDisplayed = $disp($cur['gross'], $cur['vat']);
        $refDisplayed = $disp($ref['gross'], $ref['vat']);
        // Gói 57: AOV = Net Revenue / số bill thành công (net = doanh thu sau VAT, đã trừ giảm giá)
        $netRevenue = max(0, $cur['gross'] - $cur['vat']);
        $refNetRevenue = max(0, $ref['gross'] - $ref['vat']);
        $revenue = [
            'gross' => $this->r2($cur['gross']),
            'vat' => $this->r2($cur['vat']),
            'net' => $this->r2($netRevenue),
            'displayed' => $this->r2($revDisplayed),
            'orders' => $cur['orders'],
            'avg' => $cur['orders'] > 0 ? $this->r2($netRevenue / $cur['orders']) : 0,
            'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
            'delta_orders' => $this->pct($cur['orders'], $ref['orders']),
            'delta_avg' => $this->pct(
                $cur['orders'] > 0 ? $netRevenue / $cur['orders'] : 0,
                $ref['orders'] > 0 ? $refNetRevenue / $ref['orders'] : 0
            ),
            'delta_vat' => $this->pct($cur['vat'], $ref['vat']),
            'buckets' => $this->buckets($period, $branchId, $from, $to, $tz, $taxRatio),
            'top_products' => $this->topProducts($cur, $ref, 5, $disp),
            'channels' => $this->channels($cur, $ref, $taxRatio),
            'hourly' => $this->hourly($branchId, $from, $to, $taxRatio),
            // Gói 17: thêm 2 block chi tiết (cộng thêm, frontend cũ bỏ qua)
            'by_payment' => $this->byPayment($branchId, $from, $to, $cFrom, $cTo, $taxRatio),
            'by_category' => $this->byCategory($branchId, $from, $to, $cFrom, $cTo, $taxRatio),
            // Gói 55 p11af (P0-14): KPI Food cost % = giá vốn NL / doanh thu thuần
            'food_cost_pct' => $foodCostPct,
            'food_cost_value' => $this->r2($foodCostValue),
        ];

        // ---------- Tab 2: Thu – Chi – Lợi nhuận ----------
        // Gói 55 p11af: tái dùng $foodCostValue đã tính ở trên (tránh tính giá vốn 2 lần)
        $costs = $this->costs($cur, $foodCostValue);
        $refCosts = $this->costs($ref);
        $costTotal = array_sum(array_column($costs, 'value'));
        $refCostTotal = array_sum(array_column($refCosts, 'value'));
        $profit = $revDisplayed - $costTotal;
        $refProfit = $refDisplayed - $refCostTotal;
        // Gói 57: Prime Cost = Giá vốn NL + Lương; cảnh báo đỏ khi > 55% Net Revenue
        $laborCost = 0.0;
        foreach ($costs as $c) {
            if (($c['name'] ?? '') === 'Lương') { $laborCost = (float) $c['value']; break; }
        }
        $primeCost = $foodCostValue + $laborCost;
        $primeCostPct = $netRevenue > 0 ? round($primeCost / $netRevenue * 100, 1) : 0;
        $profitData = [
            'revenue' => $this->r2($revDisplayed),
            'costs' => array_map(fn($c) => [
                'name' => $c['name'], 'value' => $this->r2($c['value']), 'color' => $c['color'],
            ], $costs),
            'cost_total' => $this->r2($costTotal),
            'profit' => $this->r2($profit),
            'margin' => $revDisplayed > 0 ? $this->r2($profit / $revDisplayed * 100) : 0,
            'prime_cost' => $this->r2($primeCost),
            'prime_cost_pct' => $primeCostPct,
            'prime_cost_alert' => $primeCostPct > 55,
            'delta_profit' => $this->pct($profit, $refProfit),
            'delta_cost' => $this->pct($costTotal, $refCostTotal),
            'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
            'groups' => $this->profitGroups($period, $branchId, $from, $to, $vatRate, $tz, $disp),
        ];

        // ---------- Tab 3: Hao hụt ----------
        $wasteData = [
            'items' => $this->waste($cur, $branchId),
            // Gói 55 p11ag: hao hụt từ số kiểm kê thực tế (phát hiện bán chui).
            // Công thức: (tồn đầu kỳ + nhập trong kỳ − tồn thực tế kiểm kê) − tiêu thụ BOM.
            // Không có phiếu kiểm kê → fallback ước tính (nhập − BOM).
            'note' => 'Hao hụt = (Tồn đầu kỳ + Nhập trong kỳ − Tồn thực tế kiểm kê) − Tiêu thụ theo BOM. '
                . 'Dòng không có số kiểm kê là ước tính (Nhập − BOM).',
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
            // Gói 55 p11ac: lấy CK cấp đơn để phân bổ về từng dòng
            // Gói 55 p11ae: discount_amount đã GỒM promotion_discount (OrderController và
            // OnlineOrderController đều cộng $promotionDiscount vào $discountAmount trước khi lưu;
            // cột promotion_discount chỉ để breakdown hiển thị) → dùng discount_amount, KHÔNG
            // cộng thêm promotion_discount, tránh trừ KM 2 lần trong báo cáo.
            $orderDiscounts = $this->baseOrders($branchId, $from, $to)
                ->select('id', 'subtotal_amount', 'discount_amount')
                ->get()
                ->keyBy('id')
                ->map(fn ($o) => [
                    'subtotal' => (float) ($o->subtotal_amount ?: 0),
                    'discount' => (float) ($o->discount_amount ?: 0),
                ]);
            $items = DB::table('order_items')
                ->leftJoin('products', 'products.id', '=', 'order_items.product_id')
                ->whereIn('order_items.order_id', $orderIds)
                ->select(
                    'order_items.order_id',
                    'order_items.product_id',
                    'order_items.product_option_id',
                    'order_items.product_name',
                    'order_items.quantity',
                    'order_items.unit_cost', // Gói 55 p11ac: giá vốn đã chốt lúc trừ kho
                    DB::raw('COALESCE(order_items.total_price, order_items.subtotal, order_items.unit_price * order_items.quantity, 0) AS line_total'),
                    DB::raw('COALESCE(products.tax_rate, ' . $vatRate . ') AS tax_rate')
                )
                ->get();
            foreach ($items as $it) {
                // Phân bổ CK cấp đơn theo tỷ lệ dòng
                $od = $orderDiscounts[$it->order_id] ?? ['subtotal' => 0, 'discount' => 0];
                $allocDiscount = 0;
                if ($od['subtotal'] > 0 && $od['discount'] > 0) {
                    $allocDiscount = $od['discount'] * ((float) $it->line_total / $od['subtotal']);
                }
                $it->net_line_total = (float) $it->line_total - $allocDiscount;
                $r = ((float) $it->tax_rate) / 100;
                $vat += $it->net_line_total * $r / (1 + $r);
            }
        }

        // Kênh bán: gom theo đơn — Gói 56 (2026-10-14): kênh ĐỘNG từ price_lists
        // (tất cả code active) + 'pos' + 'zalo', không gộp cứng 3 nhóm như trước.
        $orders = $this->baseOrders($branchId, $from, $to)
            ->select('id', 'online_channel', 'payment_method', 'total_amount', 'created_at')
            ->get();
        $channelCodes = ['pos', 'zalo'];
        if (Schema::hasTable('price_lists')) {
            $plQuery = DB::table('price_lists')->select('code');
            if (Schema::hasColumn('price_lists', 'is_active')) {
                $plQuery->where('is_active', true);
            }
            foreach ($plQuery->pluck('code') as $c) {
                $channelCodes[] = strtolower(trim((string) $c));
            }
        }
        $channelCodes = array_values(array_unique(array_filter($channelCodes)));
        $channels = array_fill_keys($channelCodes, 0.0);
        $orderChannels = [];
        foreach ($orders as $o) {
            $key = $this->channelKey($o);
            if (!array_key_exists($key, $channels)) {
                // Kênh phát sinh từ đơn nhưng price_lists chưa có — vẫn ghi nhận
                $channels[$key] = 0.0;
            }
            $channels[$key] += (float) $o->total_amount;
            $orderChannels[$o->id] = $key;
        }

        return [
            'branch_id' => $branchId,
            'from' => $from, 'to' => $to,
            'gross' => $gross, 'vat' => $vat, 'orders' => $orderCount,
            'items' => $items, 'channels' => $channels,
            'order_channels' => $orderChannels, // Gói 56: map order_id -> kênh (tính COGS/kênh)
        ];
    }

    private function channelKey($order): string
    {
        // Gói 56 (2026-10-14): kênh động — trả về online_channel thực tế của đơn
        // (chuẩn hóa lowercase + trim), không gộp cứng nhóm như trước.
        // Fallback 'pos' khi đơn không có kênh.
        $ch = strtolower(trim((string) ($order->online_channel ?? '')));
        return $ch !== '' ? $ch : 'pos';
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
            // Gói 55 p11ac: dùng net_line_total (đã trừ CK cấp đơn phân bổ)
            $netTotal = (float) ($it->net_line_total ?? $it->line_total);
            $agg[$pid]['quantity'] += (float) $it->quantity;
            $agg[$pid]['revenue'] += $netTotal;
            $r = ((float) $it->tax_rate) / 100;
            $agg[$pid]['vat'] += $netTotal * $r / (1 + $r);
        }
        uasort($agg, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
        return $agg;
    }

    /**
     * Gói 56 (2026-10-14): kênh động + lãi gộp theo kênh.
     * - cogs: SUM(order_items.unit_cost * quantity) của các đơn thuộc kênh
     * - commission: doanh thu kênh × commission_rate/100 (từ price_lists)
     * - gross_profit = value - commission - cogs ; margin_pct = gross_profit/value*100
     * Giữ nguyên các field cũ: key, name, value, share, delta, color.
     */
    private function channels(array $cur, array $ref, float $taxRatio): array
    {
        $labels = $this->channelLabelMap();
        $rates = $this->commissionRates();
        $orderChannels = $cur['order_channels'] ?? [];

        // Giá vốn theo kênh từ snapshot unit_cost lúc trừ kho
        $cogsByChannel = [];
        foreach ($cur['items'] as $it) {
            $ck = $orderChannels[$it->order_id] ?? 'pos';
            $cogsByChannel[$ck] = ($cogsByChannel[$ck] ?? 0.0)
                + (float) ($it->unit_cost ?? 0) * (float) ($it->quantity ?? 0);
        }

        // Màu: giữ 3 màu cũ cho 3 kênh cũ, kênh mới xoay vòng palette
        $baseColors = ['pos' => '#24305E', 'zalo' => '#F5A623', 'grabfood' => '#5B8DEF'];
        $palette = ['#34C77B', '#E5646E', '#9B5DE5', '#00BBF9', '#F15BB5', '#FF8C42', '#2EC4B6', '#E71D36'];
        $pi = 0;
        $out = [];
        foreach (array_keys($cur['channels'] ?? []) as $key) {
            $v = (float) ($cur['channels'][$key] ?? 0.0);
            $rv = (float) ($ref['channels'][$key] ?? 0.0);
            $cogs = (float) ($cogsByChannel[$key] ?? 0.0);
            $rate = (float) ($rates[$key] ?? 0.0);
            $commission = $v * $rate / 100;
            $grossProfit = $v - $commission - $cogs;
            $marginPct = $v > 0 ? $grossProfit / $v * 100 : 0;
            if (isset($baseColors[$key])) {
                $color = $baseColors[$key];
            } else {
                $color = $palette[$pi % count($palette)];
                $pi++;
            }
            $out[] = [
                'key' => $key,
                'name' => $labels[$key] ?? ucfirst($key),
                'value' => $this->r2($v * $taxRatio),
                'share' => $cur['gross'] > 0 ? $this->r2($v / $cur['gross'] * 100) : 0,
                'delta' => $this->pct($v, $rv),
                'color' => $color,
                'cogs' => $this->r2($cogs * $taxRatio),
                'commission' => $this->r2($commission * $taxRatio),
                'gross_profit' => $this->r2($grossProfit * $taxRatio),
                'margin_pct' => $this->r2($marginPct),
            ];
        }
        return $out;
    }

    /** % phí sàn theo code price_list (lowercase) — 0 nếu kênh không có bảng giá. */
    private function commissionRates(): array
    {
        $rates = [];
        if (Schema::hasTable('price_lists') && Schema::hasColumn('price_lists', 'commission_rate')) {
            foreach (DB::table('price_lists')->select('code', 'commission_rate')->get() as $pl) {
                $code = strtolower(trim((string) $pl->code));
                if ($code !== '') {
                    $rates[$code] = (float) $pl->commission_rate;
                }
            }
        }
        return $rates;
    }

    /**
     * Tên hiển thị kênh: 'pos' => "Tại quầy", 'zalo' => "Zalo Mini App",
     * các kênh khác lấy name từ price_lists (không đè 2 tên cố định trên).
     */
    private function channelLabelMap(): array
    {
        $map = ['pos' => 'Tại quầy', 'zalo' => 'Zalo Mini App'];
        if (Schema::hasTable('price_lists')) {
            foreach (DB::table('price_lists')->select('code', 'name')->get() as $pl) {
                $code = strtolower(trim((string) $pl->code));
                if ($code !== '' && !isset($map[$code])) {
                    $map[$code] = $pl->name ?: $code;
                }
            }
        }
        return $map;
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
     * Chi phí của 1 kỳ: vốn nguyên liệu (BOM × giá vốn đã chốt lúc trừ kho) +
     * chi phí ca (shift_expenses: reason chứa "lương" -> Lương).
     * Gói 55 p11ac: GHI CHÚ — dòng "Nguyên liệu" là giá vốn ước tính theo BOM,
     * CHƯA gồm tiền nhập hàng thực tế đã chi (xem Sổ thu-chi). Không cộng 2 số này lại.
     */
    private function costs(array $p, ?float $bomOverride = null): array
    {
        $bom = $bomOverride ?? $this->bomCost($p);
        $exp = $this->shiftExpenses($p);
        return [
            ['name' => 'Nguyên liệu', 'value' => $bom, 'color' => '#F5A623',
             'note' => 'Giá vốn ước tính theo định mức, chưa gồm tiền nhập hàng thực tế đã chi'],
            ['name' => 'Lương', 'value' => $exp['salary'], 'color' => '#24305E'],
            ['name' => 'Chi khác', 'value' => $exp['other'], 'color' => '#7C8DB0'],
        ];
    }

    /**
     * Gói 55 p11ac: giá vốn = Σ (order_items.unit_cost × quantity) — giá đã "chốt" lúc trừ kho.
     * Fallback về ước tính BOM cho đơn cũ (chưa có unit_cost).
     */
    private function bomCost(array $p): float
    {
        if ($p['items']->isEmpty()) {
            return 0.0;
        }
        // Ưu tiên dùng unit_cost đã lưu lúc trừ kho
        $lockedCost = 0.0;
        $hasLocked = false;
        foreach ($p['items'] as $it) {
            if ($it->unit_cost !== null) {
                $hasLocked = true;
                $lockedCost += (float) $it->unit_cost * (float) $it->quantity;
            }
        }
        if ($hasLocked) {
            return $lockedCost;
        }
        // Fallback: ước tính BOM cho đơn cũ
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
            // Gói SEC2: gộp product_option_id (size) + options JSON (topping nhóm)
            // để khớp định mức tùy chọn — giống calculateNeeds trong InventoryService
            $itemOptionIds = [];
            if (!empty($it->product_option_id)) {
                $itemOptionIds[] = (int) $it->product_option_id;
            }
            $opts = $it->options ? (array) $it->options : [];
            foreach (array_keys($opts) as $oid) {
                $itemOptionIds[] = (int) $oid;
            }
            $itemOptionIds = array_values(array_unique($itemOptionIds));

            foreach ($recipes as $r) {
                if ((int) $r->product_id !== (int) $it->product_id) {
                    continue;
                }
                if ($r->product_option_id !== null && !in_array((int) $r->product_option_id, $itemOptionIds, true)) {
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
        // Gói 55 p11ad: kỳ = trọn 1 tháng DL → lấy lương từ bảng chấm công (chính xác hơn dò chuỗi)
        $payroll = $this->payrollSalaryForMonth($p);
        if ($payroll !== null) {
            $salary = $payroll;
        }
        return ['salary' => $salary, 'other' => $other];
    }

    /**
     * Gói 55 p11ad: tổng lương gross của 1 tháng = SUM(giờ công × đơn giá giờ).
     * Trả về null nếu kỳ báo cáo không phải trọn 1 tháng DL → dùng fallback dò chuỗi cũ.
     */
    private function payrollSalaryForMonth(array $p): ?float
    {
        $from = $p['from'] ?? null;
        $to = $p['to'] ?? null;
        if (!$from instanceof Carbon || !$to instanceof Carbon) return null;
        if ((int) $from->format('d') !== 1 || $from->format('H:i') !== '00:00') return null;
        $monthEnd = $from->copy()->endOfMonth();
        $toDate = $to->format('Y-m-d');
        $isFullMonth = $toDate === $monthEnd->format('Y-m-d')
            || $toDate === $monthEnd->copy()->addDay()->format('Y-m-d');
        if (!$isFullMonth) return null;

        $start = $from->format('Y-m-d');
        $end = $monthEnd->format('Y-m-d');
        $branchId = (int) ($p['branch_id'] ?? 0);

        $hoursMap = DB::table('salary_days')
            ->whereBetween('date', [$start, $end])
            ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
            ->selectRaw('employee_id, SUM(hours) as total_hours')
            ->groupBy('employee_id')
            ->get()->keyBy('employee_id');
        if ($hoursMap->isEmpty()) return null; // chưa có dữ liệu chấm công → fallback

        $employees = \App\Models\Employee::whereIn('id', $hoursMap->keys()->all())->get()->keyBy('id');
        $total = 0.0;
        foreach ($hoursMap as $empId => $h) {
            $emp = $employees->get($empId);
            if (!$emp) continue;
            $rate = (float) ($emp->hourly_rate ?? 0);
            if (!$rate) {
                $lv = \App\Models\WageLevel::where('employee_id', $empId)
                    ->where('start_date', '<=', $end)
                    ->orderBy('start_date', 'desc')->first();
                $rate = $lv ? (float) $lv->hourly_rate : 0;
            }
            $total += (float) $h->total_hours * $rate;
        }
        return round($total);
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

    /**
     * Gói 55 p11ag (2026-10-14): hao hụt từ SỐ KIỂM KÊ THỰC TẾ — phát hiện bán chui.
     * Công thức: hao_hụt = (tồn_đầu_kỳ + nhập_trong_kỳ − tồn_cuối_thực_tế) − tiêu_thụ_BOM
     * - tồn_cuối_thực_tế: số đếm từ phiếu kiểm kê đã chốt gần nhất (mỗi NL lấy lần
     *   kiểm mới nhất có checked_at <= cuối kỳ).
     * - tồn_đầu_kỳ: tồn hệ thống hiện tại + net biến động từ đầu kỳ (nhật ký
     *   stock_movements: xuất = dương, nhập = âm). Nếu chưa có nhật ký → dùng tồn
     *   hiện tại làm ước tính và đánh dấu is_estimate.
     * - Không có phiếu kiểm kê nào → fallback công thức cũ (nhập − BOM) và gắn
     *   cờ is_estimate + frontend hiện cảnh báo "Chưa có số kiểm kê".
     * - Đỏ khi waste_pct > waste_threshold_pct của NL (mặc định 5%).
     */
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
        $from = $cur['from'];
        $to = $cur['to'];

        // Nhập trong kỳ (lô batches tạo trong kỳ)
        $inbound = [];
        $bq = Batch::query()
            ->whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()]);
        if ($branchId > 0) {
            $bq->where('branch_id', $branchId);
        }
        foreach ($bq->select('material_id', DB::raw('SUM(initial_quantity) AS q'))->groupBy('material_id')->get() as $row) {
            $inbound[$row->material_id] = (float) $row->q;
        }

        // Tồn hệ thống hiện tại (tổng current_quantity các lô còn tồn)
        $sysNow = [];
        $sq = Batch::query()->where('current_quantity', '>', 0.0009);
        if ($branchId > 0) {
            $sq->where('branch_id', $branchId);
        }
        foreach ($sq->select('material_id', DB::raw('SUM(current_quantity) AS q'))->groupBy('material_id')->get() as $row) {
            $sysNow[$row->material_id] = (float) $row->q;
        }

        // Net biến động từ đầu kỳ (stock_movements: xuất = dương, nhập = âm)
        // → tồn_đầu_kỳ = tồn_hiện_tại + net_biến_động_từ_đầu_kỳ
        $netMove = [];
        $hasMovements = false;
        if (Schema::hasTable('stock_movements')) {
            $mq = StockMovement::query()->where('created_at', '>=', $from->toDateTimeString());
            if ($branchId > 0) {
                $mq->where('branch_id', $branchId);
            }
            foreach ($mq->select('material_id', DB::raw('SUM(quantity) AS q'))->groupBy('material_id')->get() as $row) {
                $netMove[$row->material_id] = (float) $row->q;
                $hasMovements = true;
            }
        }

        // Số kiểm kê thực tế: mỗi NL lấy lần đếm mới nhất
        // (phiếu đã chốt, checked_at <= cuối kỳ)
        $counted = []; // material_id => ['qty' => float, 'date' => string]
        if (Schema::hasTable('stocktakes') && Schema::hasTable('stocktake_items')) {
            $stQ = DB::table('stocktake_items')
                ->join('stocktakes', 'stocktakes.id', '=', 'stocktake_items.stocktake_id')
                ->where('stocktakes.status', 'confirmed')
                ->where('stocktakes.checked_at', '<=', $to->toDateTimeString());
            if ($branchId > 0) {
                $stQ->where('stocktakes.branch_id', $branchId);
            }
            $seen = []; // "mid:bid" => true (chỉ lấy lần mới nhất mỗi NL/CN)
            foreach (
                $stQ->select('stocktake_items.material_id', 'stocktakes.branch_id', 'stocktake_items.counted_qty', 'stocktakes.checked_at')
                    ->orderByDesc('stocktakes.checked_at')->get() as $r
            ) {
                if ($r->counted_qty === null) {
                    continue;
                }
                $k = $r->material_id . ':' . $r->branch_id;
                if (isset($seen[$k])) {
                    continue;
                }
                $seen[$k] = true;
                $mid = (int) $r->material_id;
                if (!isset($counted[$mid])) {
                    $counted[$mid] = ['qty' => 0.0, 'date' => null];
                }
                $counted[$mid]['qty'] += (float) $r->counted_qty;
                if ($counted[$mid]['date'] === null || $r->checked_at > $counted[$mid]['date']) {
                    $counted[$mid]['date'] = $r->checked_at;
                }
            }
        }

        $materials = DB::table('materials')->select('id', 'name', 'unit', 'waste_threshold_pct')->get()->keyBy('id');
        $out = [];
        foreach ($bomCur as $mid => $bom) {
            $inb = $inbound[$mid] ?? 0.0;
            $m = $materials[$mid] ?? null;
            $threshold = $m && $m->waste_threshold_pct !== null ? (float) $m->waste_threshold_pct : 5.0;
            if (isset($counted[$mid])) {
                // Công thức mới: có số kiểm kê thực tế
                $opening = ($sysNow[$mid] ?? 0.0) + ($netMove[$mid] ?? 0.0);
                $actual = $counted[$mid]['qty'];
                $waste = ($opening + $inb - $actual) - $bom;
                $isEstimate = !$hasMovements; // không có nhật ký → tồn đầu kỳ chỉ là ước tính
                $stocktakeDate = $counted[$mid]['date'];
            } else {
                // Fallback công thức cũ khi chưa có kiểm kê
                $opening = null;
                $actual = null;
                $waste = $inb - $bom;
                $isEstimate = true;
                $stocktakeDate = null;
            }
            $pct = $bom > 0 ? $waste / $bom * 100 : null;
            $out[] = [
                'material_id' => $mid,
                'material' => $m->name ?? ('Nguyên liệu #' . $mid),
                'unit' => $m->unit ?? '',
                'opening_qty' => $opening === null ? null : $this->r2($opening),
                'inbound_qty' => $this->r2($inb),
                'bom_qty' => $this->r2($bom),
                'actual_qty' => $actual === null ? null : $this->r2($actual),
                'stocktake_date' => $stocktakeDate,
                'diff' => $this->r2($waste),
                'waste_pct' => $pct === null ? null : $this->r2($pct),
                'threshold_pct' => $threshold,
                'over_threshold' => $pct !== null && $pct > $threshold,
                'is_estimate' => $isEstimate,
                'delta_pct' => null,
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
    // Gói 56 (2026-10-14): viết lại ĐỘNG theo kênh thực tế trong dữ liệu
    // (duyệt keys của $p['channels'], không hardcode danh sách kênh).
    // Alias tương thích: 'pos' (tại quầy) -> price_lists 'nha_hang' rồi 'pos';
    // 'zalo' -> 'online' rồi 'zalo'. Kênh mới: khớp đúng code.

    /**
     * Gói 57 (2026-10-14): chi phí phân bổ từ prepaid_expenses.
     * Mỗi khoản chia đều total_amount/months; tính số ngày giao nhau giữa
     * kỳ báo cáo và [start_date, start_date + months] rồi quy ra tiền.
     * Trả về ['items' => [{name, category, amount}], 'total' => float].
     */
    private function allocatedExpenses(int $branchId, Carbon $from, Carbon $to): array
    {
        $out = ['items' => [], 'total' => 0.0];
        if (!Schema::hasTable('prepaid_expenses')) {
            return $out;
        }
        $q = DB::table('prepaid_expenses')->where('is_active', true);
        if ($branchId > 0) {
            $q->where(function ($w) use ($branchId) {
                $w->whereNull('branch_id')->orWhere('branch_id', $branchId);
            });
        }
        foreach ($q->get() as $e) {
            $months = max(1, (int) $e->months);
            $monthly = (float) $e->total_amount / $months;
            try {
                $start = Carbon::parse($e->start_date)->startOfDay();
            } catch (\Exception $ex) {
                continue;
            }
            $end = $start->copy()->addMonths($months)->subDay()->endOfDay();
            // Giao nhau giữa kỳ báo cáo và kỳ phân bổ
            $overlapStart = $from->copy()->max($start);
            $overlapEnd = $to->copy()->min($end);
            if ($overlapEnd->lt($overlapStart)) {
                continue;
            }
            $overlapDays = $overlapStart->diffInDays($overlapEnd) + 1;
            $amount = round($monthly * $overlapDays / 30, 0);
            if ($amount <= 0) {
                continue;
            }
            $out['items'][] = [
                'name' => $e->name,
                'category' => $e->category,
                'amount' => $this->r2($amount),
            ];
            $out['total'] += $amount;
        }
        $out['total'] = $this->r2($out['total']);
        return $out;
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
        $labels = $this->channelLabelMap();
        $aliases = ['pos' => ['nha_hang', 'pos'], 'zalo' => ['online', 'zalo']];
        $out = [];
        foreach (($p['channels'] ?? []) as $chKey => $rev) {
            $rev = (float) $rev;
            $pl = null;
            foreach (($aliases[$chKey] ?? [$chKey]) as $c) {
                if (isset($byCode[strtolower($c)])) {
                    $pl = $byCode[strtolower($c)];
                    break;
                }
            }
            $rate = $pl ? (float) $pl->commission_rate : 0.0;
            if ($rate <= 0) {
                continue;
            }
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
                'channel' => $labels[$chKey] ?? ucfirst($chKey),
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
        $wasteRows = $this->waste($cur, $branchId);
        // Gói 55 p11ag: hao hụt từ số kiểm kê thực tế (phát hiện bán chui).
        // actual_qty giờ là TỒN THỰC TẾ từ phiếu kiểm kê (null nếu chưa kiểm).
        $materials = array_map(fn($m) => [
            'material_id' => $m['material_id'],
            'material' => $m['material'],
            'unit' => $m['unit'],
            'opening_qty' => $m['opening_qty'],
            'imported_qty' => $m['inbound_qty'],
            'exported_bom_qty' => $m['bom_qty'],
            'actual_qty' => $m['actual_qty'],
            'stocktake_date' => $m['stocktake_date'],
            'diff' => $m['diff'],
            'waste_pct' => $m['waste_pct'],
            'threshold_pct' => $m['threshold_pct'],
            'over_threshold' => $m['over_threshold'],
            'is_estimate' => $m['is_estimate'],
        ], $wasteRows);
        // Cảnh báo chung nếu chưa có số kiểm kê nào trong kỳ
        $hasAnyStocktake = count(array_filter($wasteRows, fn($m) => !$m['is_estimate'])) > 0;

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
                // Gói 55 p11ag: false = chưa có số kiểm kê nào → số liệu chỉ là ước tính
                'has_stocktake' => $hasAnyStocktake,
            ],
        ]);
    }

    /**
     * Gói 55 p11ag (2026-10-14): Báo cáo đơn hủy theo nhân viên — chống gian lận
     * hủy đơn đã thanh toán rồi bỏ tiền túi.
     * GET /api/reports/cancelled-by-staff?branch_id=&period=&date=
     * - Gom theo ngày + người hủy: số đơn hủy, tổng tiền hủy.
     * - Cảnh báo đỏ: NV hủy > 5 đơn/ngày HOẶC tổng tiền hủy > 500k/ngày.
     */
    public function cancelledByStaff(Request $request): JsonResponse
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

        $q = Order::query()
            ->where('status', 'cancelled')
            ->whereBetween('cancelled_at', [$from->toDateTimeString(), $to->toDateTimeString()]);
        if ($branchId > 0) {
            $q->where('branch_id', $branchId);
        }
        $orders = $q->select(
            'id', 'code', 'branch_id', 'total_amount', 'payment_status',
            'cancel_reason', 'cancelled_at', 'cancelled_by', 'cancelled_by_type', 'created_at'
        )->orderByDesc('cancelled_at')->get();

        // Gom theo ngày + người hủy
        $groups = [];
        foreach ($orders as $o) {
            $day = $o->cancelled_at ? Carbon::parse($o->cancelled_at)->setTimezone($tz)->toDateString() : '—';
            $by = $o->cancelled_by ?: '(không rõ)';
            $type = $o->cancelled_by_type ?: 'unknown';
            $key = $day . '|' . $type . '|' . $by;
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'date' => $day,
                    'cancelled_by' => $by,
                    'cancelled_by_type' => $type,
                    'count' => 0,
                    'total_amount' => 0.0,
                    'paid_count' => 0, // số đơn đã thu tiền rồi mới hủy (đáng ngờ nhất)
                ];
            }
            $groups[$key]['count']++;
            $groups[$key]['total_amount'] += (float) $o->total_amount;
            if (in_array($o->payment_status, ['paid', 'refunded'], true)) {
                $groups[$key]['paid_count']++;
            }
        }
        $rows = array_values($groups);
        foreach ($rows as &$r) {
            // Cảnh báo đỏ: > 5 đơn/ngày hoặc tổng tiền hủy > 500k/ngày
            $r['flagged'] = $r['count'] > 5 || $r['total_amount'] > 500000;
            $r['total_amount'] = $this->r2($r['total_amount']);
        }
        unset($r);
        usort($rows, fn($a, $b) => [$b['flagged'], $b['total_amount']] <=> [$a['flagged'], $a['total_amount']]);

        $detail = $orders->map(fn($o) => [
            'code' => $o->code,
            'cancelled_at' => $o->cancelled_at ? Carbon::parse($o->cancelled_at)->setTimezone($tz)->format('d/m/Y H:i') : '—',
            'total_amount' => (float) $o->total_amount,
            'payment_status' => $o->payment_status,
            'cancelled_by' => $o->cancelled_by ?: '(không rõ)',
            'cancelled_by_type' => $o->cancelled_by_type ?: 'unknown',
            'cancel_reason' => $o->cancel_reason,
        ])->values()->all();

        // Gói 57: gom đơn hủy theo lý do
        $byReason = [];
        if (Schema::hasColumn('orders', 'cancel_reason')) {
            foreach ($orders as $o) {
                $reason = trim((string) ($o->cancel_reason ?? ''));
                if ($reason === '') $reason = '(không ghi lý do)';
                if (!isset($byReason[$reason])) $byReason[$reason] = 0;
                $byReason[$reason]++;
            }
        }
        $byReasonOut = [];
        foreach ($byReason as $reason => $count) {
            $byReasonOut[] = ['reason' => $reason, 'count' => $count];
        }
        usort($byReasonOut, fn($a, $b) => $b['count'] <=> $a['count']);

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
                'summary' => [
                    'total_cancelled' => $orders->count(),
                    'total_amount' => $this->r2($orders->sum(fn($o) => (float) $o->total_amount)),
                    'flagged_groups' => count(array_filter($rows, fn($r) => $r['flagged'])),
                ],
                'groups' => $rows,
                'by_reason' => $byReasonOut,
                'detail' => $detail,
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

        // Gói 55 p11ac: "Thu khác" (phiếu thu tay trong Sổ thu-chi) cộng vào tổng thu PNL
        $otherIncomeOf = function (Carbon $f, Carbon $t) use ($branchId): float {
            return (float) Transaction::query()
                ->where('type', 'income')
                ->where('status', 'paid')
                ->whereBetween('paid_at', [$f->toDateTimeString(), $t->toDateTimeString()])
                ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
                ->sum('amount');
        };
        $otherIncome = $otherIncomeOf($from, $to);
        $refOtherIncome = $otherIncomeOf($cFrom, $cTo);
        $revDisplayed += $otherIncome;
        $refDisplayed += $refOtherIncome;

        $costs = $this->costs($cur);
        $commissions = $this->commissions($cur);
        $commTotal = array_sum(array_column($commissions, 'cost'));
        if ($commTotal > 0) {
            $costs[] = ['name' => 'Chiết khấu kênh', 'value' => $commTotal, 'color' => '#9B59B6'];
        }
        // Gói 57: chi phí phân bổ từ prepaid_expenses (thuê trả trước, CAPEX...)
        $allocated = $this->allocatedExpenses($branchId, $from, $to);
        if ($allocated['total'] > 0) {
            $costs[] = ['name' => 'Chi phí phân bổ', 'value' => $allocated['total'], 'color' => '#8E44AD',
                'note' => 'Tiền thuê trả trước / CAPEX chia đều theo tháng'];
        }
        $costTotal = array_sum(array_column($costs, 'value'));

        $refCostTotal = array_sum(array_column($this->costs($ref), 'value'))
            + array_sum(array_column($this->commissions($ref), 'cost'))
            + $this->allocatedExpenses($branchId, $cFrom, $cTo)['total'];

        $profit = $revDisplayed - $costTotal;
        $refProfit = $refDisplayed - $refCostTotal;

        // Gói 57: Net Revenue làm mốc 100% cho % các dòng chi phí
        $netRevenuePnl = max(0, $cur['gross'] - $cur['vat']) + $otherIncome;
        $costsOut = array_map(fn($c) => [
            'name' => $c['name'],
            'value' => $this->r2($c['value']),
            'color' => $c['color'],
            'pct' => $netRevenuePnl > 0 ? $this->r2($c['value'] / $netRevenuePnl * 100) : 0,
        ], $costs);

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
                    'net' => $this->r2($netRevenuePnl),
                    'other_income' => $this->r2($otherIncome),
                    'orders' => $cur['orders'],
                    'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
                    'delta_orders' => $this->pct($cur['orders'], $ref['orders']),
                ],
                'income_channels' => $this->channels($cur, $ref, $taxRatio),
                'costs' => $costsOut,
                'commissions' => $commissions,
                'allocated_expenses' => $allocated['items'],
                'allocated_total' => $this->r2($allocated['total']),
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

    /**
     * Gói 56 (2026-10-14): KPI vận hành trong ngày.
     * GET /api/reports/operations?date=Y-m-d&branch_id=
     * - avg_prep_minutes: TB phút từ tạo đơn -> bếp bấm sẵn sàng (ready_at)
     * - cancel_rate: % đơn hủy; cancel_by_reason: gom theo lý do hủy
     * - orders_per_hour_per_staff: đơn hoàn thành / tổng giờ công (chấm công;
     *   fallback số ca đã xếp ở work_schedules)
     * - hourly: 24 giờ, mỗi giờ có orders/staff/understaffed
     *   (understaffed = orders > staff * 15)
     * - alerts: cảnh báo thiếu người / hủy vượt ngưỡng / pha chế chậm
     */
    public function operations(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        $branchId = (int) $request->query('branch_id', 0);
        $dateStr = $request->query('date');
        try {
            $day = $dateStr
                ? Carbon::parse($dateStr, $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $day = Carbon::now($tz)->startOfDay();
        }
        $from = $day->copy()->startOfDay();
        $to = $day->copy()->endOfDay();
        $dayStr = $day->toDateString();

        $dayOrders = Order::query()
            ->whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()]);
        if ($branchId > 0) {
            $dayOrders->where('branch_id', $branchId);
        }

        $totalOrders = (int) (clone $dayOrders)->count();
        $cancelledOrders = (int) (clone $dayOrders)->where('status', 'cancelled')->count();
        $completedOrders = (int) (clone $dayOrders)->where('status', 'completed')->count();
        $cancelRate = $totalOrders > 0 ? round($cancelledOrders / $totalOrders * 100, 1) : 0.0;

        // 1. Thời gian pha chế trung bình (phút) — cần cột ready_at (migration 000055)
        $avgPrepMinutes = null;
        if (Schema::hasColumn('orders', 'ready_at')) {
            $avg = (clone $dayOrders)
                ->where('status', 'completed')
                ->whereNotNull('ready_at')
                ->avg(DB::raw('TIMESTAMPDIFF(MINUTE, created_at, ready_at)'));
            $avgPrepMinutes = $avg !== null ? round((float) $avg, 1) : null;
        }

        // 2. Đơn hủy gom theo lý do
        $cancelByReason = [];
        if (Schema::hasColumn('orders', 'cancel_reason')) {
            $cancelByReason = (clone $dayOrders)
                ->where('status', 'cancelled')
                ->select('cancel_reason', DB::raw('COUNT(*) AS c'))
                ->groupBy('cancel_reason')
                ->pluck('c', 'cancel_reason')
                ->mapWithKeys(fn($c, $r) => [
                    ($r === null || $r === '') ? 'Không rõ lý do' : (string) $r => (int) $c,
                ])
                ->toArray();
        }

        // 3. Tổng giờ công từ chấm công; fallback: số ca đã xếp
        $attBase = DB::table('attendances')
            ->where('date', $dayStr)
            ->whereNotNull('check_in')
            ->whereNotNull('check_out');
        if ($branchId > 0) {
            $attBase->where('branch_id', $branchId);
        }
        $staffHours = (float) (clone $attBase)->sum(DB::raw('TIMESTAMPDIFF(HOUR, check_in, check_out)'));
        if ($staffHours <= 0 && Schema::hasTable('work_schedules')) {
            $wsQuery = DB::table('work_schedules')->where('date', $dayStr);
            if ($branchId > 0) {
                $wsQuery->where('branch_id', $branchId);
            }
            $staffHours = (float) $wsQuery->count();
        }
        $ordersPerHourPerStaff = $staffHours > 0 ? round($completedOrders / $staffHours, 1) : 0.0;

        // 4. Chi tiết từng giờ
        $attRows = DB::table('attendances')
            ->where('date', $dayStr)
            ->whereNotNull('check_in')
            ->select('check_in', 'check_out');
        if ($branchId > 0) {
            $attRows->where('branch_id', $branchId);
        }
        $attRows = $attRows->get();
        $orderHours = (clone $dayOrders)
            ->where('status', '!=', 'cancelled')
            ->select(DB::raw('HOUR(created_at) AS h'), DB::raw('COUNT(*) AS c'))
            ->groupBy('h')
            ->pluck('c', 'h');

        $hourly = [];
        $alerts = [];
        for ($h = 0; $h < 24; $h++) {
            $hStart = $day->copy()->setTime($h, 0, 0);
            $hEnd = $day->copy()->setTime($h, 59, 59);
            $staff = 0;
            foreach ($attRows as $a) {
                $in = Carbon::parse($a->check_in, $tz);
                $out = $a->check_out ? Carbon::parse($a->check_out, $tz) : null;
                if ($in->lte($hEnd) && ($out === null || $out->gte($hStart))) {
                    $staff++;
                }
            }
            $orders = (int) ($orderHours[$h] ?? 0);
            $understaffed = $orders > $staff * 15;
            $hourly[] = [
                'hour' => $h,
                'orders' => $orders,
                'staff' => $staff,
                'understaffed' => $understaffed,
            ];
            if ($understaffed) {
                $alerts[] = "Giờ {$h}h: {$orders} đơn/{$staff} NV - thiếu người";
            }
        }

        // 5. Cảnh báo ngưỡng
        if ($cancelRate > 5) {
            $alerts[] = "Tỷ lệ hủy {$cancelRate}% vượt ngưỡng 5%";
        }
        if ($avgPrepMinutes !== null && $avgPrepMinutes > 15) {
            $alerts[] = "Thời gian pha chế TB {$avgPrepMinutes} phút vượt ngưỡng 15 phút";
        }

        return response()->json([
            'success' => true,
            'data' => [
                'date' => $dayStr,
                'branch_id' => $branchId,
                'avg_prep_minutes' => $avgPrepMinutes,
                'cancel_rate' => $cancelRate,
                'cancelled_orders' => $cancelledOrders,
                'total_orders' => $totalOrders,
                'cancel_by_reason' => $cancelByReason,
                'orders_per_hour_per_staff' => $ordersPerHourPerStaff,
                'staff_hours' => $staffHours,
                'hourly' => $hourly,
                'alerts' => $alerts,
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

    /**
     * Gói 57: Menu Engineering — ma trận 4 ô (Stars/Plowhorses/Puzzles/Dogs).
     * GET /api/reports/menu-engineering?from=Y-m-d&to=Y-m-d&branch_id=
     */
    public function menuEngineering(Request $request): JsonResponse
    {
        $from = $request->query('from', now()->startOfMonth()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $branchId = $request->query('branch_id');

        $rows = DB::table('order_items as oi')
            ->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->join('products as p', 'p.id', '=', 'oi.product_id')
            ->where('o.status', '!=', 'cancelled')
            ->where('o.payment_status', 'paid')
            ->whereDate('o.created_at', '>=', $from)
            ->whereDate('o.created_at', '<=', $to)
            ->when($branchId, fn($q) => $q->where('o.branch_id', $branchId))
            ->groupBy('oi.product_id', 'p.name')
            ->selectRaw('oi.product_id, p.name as product_name')
            ->selectRaw('SUM(oi.quantity) as qty_sold')
            ->selectRaw('SUM(oi.quantity * oi.price) as revenue')
            ->selectRaw('SUM(oi.quantity * COALESCE(oi.unit_cost, 0)) as cogs')
            ->get();

        $items = [];
        $maxQty = 0;
        foreach ($rows as $r) {
            $qty = (float) $r->qty_sold;
            if ($qty > $maxQty) $maxQty = $qty;
            $revenue = (float) $r->revenue;
            $cogs = (float) $r->cogs;
            $gp = $revenue - $cogs;
            $items[] = [
                'product_id' => $r->product_id,
                'product_name' => $r->product_name,
                'qty_sold' => $qty,
                'revenue' => $this->r2($revenue),
                'cogs' => $this->r2($cogs),
                'gross_profit' => $this->r2($gp),
                'margin_pct' => $revenue > 0 ? $this->r2($gp / $revenue * 100) : 0,
            ];
        }

        $avgMargin = 0;
        if (count($items) > 0) {
            $avgMargin = $this->r2(array_sum(array_column($items, 'margin_pct')) / count($items));
        }

        $summary = ['star' => 0, 'plowhorse' => 0, 'puzzle' => 0, 'dog' => 0];
        foreach ($items as &$it) {
            $popularity = $maxQty > 0 ? $it['qty_sold'] / $maxQty : 0;
            $it['popularity'] = $this->r2($popularity);
            $highMargin = $it['margin_pct'] >= $avgMargin;
            $highPop = $popularity >= 0.7;
            if ($highMargin && $highPop) $q = 'star';
            elseif ($highMargin && !$highPop) $q = 'puzzle';
            elseif (!$highMargin && $highPop) $q = 'plowhorse';
            else $q = 'dog';
            $it['quadrant'] = $q;
            $summary[$q]++;
        }
        unset($it);

        usort($items, fn($a, $b) => $b['gross_profit'] <=> $a['gross_profit']);

        return response()->json(['success' => true, 'data' => [
            'items' => $items,
            'summary' => $summary,
            'avg_margin' => $avgMargin,
            'meta' => ['from' => $from, 'to' => $to, 'branch_id' => $branchId],
        ]]);
    }

    /**
     * Gói 57: Xuất Excel chi tiết từng bill trong kỳ.
     * GET /api/reports/revenue/export?from=&to=&branch_id=
     */
    public function exportRevenue(Request $request)
    {
        $from = $request->query('from', now()->startOfMonth()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $branchId = $request->query('branch_id');

        $orders = Order::with(['items.product:id,name'])
            ->where('payment_status', 'paid')
            ->where('status', '!=', 'cancelled')
            ->whereDate('created_at', '>=', $from)
            ->whereDate('created_at', '<=', $to)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->orderBy('created_at')
            ->get();

        $ss = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
        $sheet = $ss->getActiveSheet();
        $sheet->setTitle('Chi tiet bill');
        $headers = ['Mã đơn', 'Ngày', 'Kênh', 'PTTT', 'Món (gộp)', 'Số lượng', 'Doanh thu', 'Giảm giá', 'Phí sàn', 'Tổng thu'];
        $sheet->fromArray($headers, null, 'A1');
        $sheet->getStyle('A1:J1')->getFont()->setBold(true);

        $row = 2;
        foreach ($orders as $o) {
            $itemNames = $o->items->map(fn($i) => ($i->product->name ?? $i->product_name ?? 'Món') . ' x' . $i->quantity)->implode('; ');
            $qty = $o->items->sum('quantity');
            $sheet->fromArray([
                $o->code ?? $o->order_number,
                $o->created_at ? $o->created_at->format('d/m/Y H:i') : '',
                $o->online_channel ?? 'pos',
                $o->payment_method ?? '',
                $itemNames,
                $qty,
                (float) $o->subtotal_amount,
                (float) $o->discount_amount,
                (float) ($o->commission_amount ?? 0),
                (float) $o->total_amount,
            ], null, 'A' . $row);
            $row++;
        }
        foreach (range('A', 'J') as $col) {
            $sheet->getColumnDimension($col)->setAutoSize(true);
        }

        $fname = 'chi-tiet-bill_' . str_replace('-', '', $from) . '_' . str_replace('-', '', $to) . '.xlsx';
        $tmp = tempnam(sys_get_temp_dir(), 'rev_exp_') . '.xlsx';
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($ss))->save($tmp);

        return response()->download($tmp, $fname, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend(true);
    }
}
