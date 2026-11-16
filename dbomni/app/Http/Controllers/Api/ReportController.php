<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Branch;
use App\Models\ChannelMonthlyAdjustment;
use App\Models\InboundReceiptItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\PurchaseOrder;
use App\Models\Recipe;
use App\Models\RevenueTarget;
use App\Models\Setting;
use App\Models\ShiftExpense;
use App\Models\StockMovement;
use App\Models\Stocktake;
use App\Models\Transaction;
use App\Support\CancelReasonCodes;
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
// - Kênh bán (Gói 56, chuẩn hóa Spec kênh 2026-10-19): động theo online_channel thực tế của đơn
//   (chuẩn hóa lowercase; rỗng -> 'pos'). Mã chuẩn: 'nha_hang' (tại quán), 'online' (Zalo Mini App);
//   đơn cũ import trước đây có thể còn mã 'pos'/'zalo' — giữ map tương thích.
//   Tên hiển thị: 'pos' -> Tại quầy, 'zalo' -> Zalo Mini App, còn lại lấy name từ price_lists theo code.
//   Phân loại kênh (store/online/partner) lấy từ price_lists.category.
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
    use \App\Traits\ValidatesEmployeeBranch;
    // Audit 2026-10-23 B-5: NV có lá reports.*.view chỉ xem báo cáo trong phạm vi CN
    // phân công — chọn CN ngoài phạm vi -> 403; không chọn CN -> ép về CN chính.
    protected function guardReportBranch(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor instanceof \App\Models\Employee) return null;
        $allowed = $this->effectiveBranchScope($actor);
        $bid = (int) $request->query('branch_id', 0);
        if ($bid > 0) {
            if (!in_array($bid, $allowed, true)) {
                return response()->json(['success' => false, 'message' => 'Chi nhánh không thuộc phạm vi của bạn.'], 403);
            }
            return null;
        }
        $request->query->set('branch_id', (int) ($allowed[0] ?? $actor->branch_id));
        return null;
    }
    public function overview(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        if ($deny = $this->guardReportBranch($request)) return $deny;
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
        // Gói PNL kênh sàn (2026-10-31): phí marketing sàn của các tháng trọn trong kỳ
        $mkt = $this->marketingAdjustments($from, $to, $branchId);

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
            'channels' => $this->channels($cur, $ref, $taxRatio, $mkt),
            'hourly' => $this->hourly($branchId, $from, $to, $taxRatio),
            // Chỉ số 360 đợt 1: BH-2 (IPO + attach rate, loại đơn nhóm +
            // dòng quà tặng) và BH-3 (ma trận doanh thu Thứ × Giờ).
            'ipo' => $this->ipoMetrics($cur),
            'daypart' => $this->daypart($branchId, $from, $to, $taxRatio),
            // Gói 17: thêm 2 block chi tiết (cộng thêm, frontend cũ bỏ qua)
            'by_payment' => $this->byPayment($branchId, $from, $to, $cFrom, $cTo, $taxRatio),
            'by_category' => $this->byCategory($branchId, $from, $to, $cFrom, $cTo, $taxRatio),
            // Spec P4-C1/C2: doanh thu theo ca / theo nhân viên (đơn, doanh thu, AOV)
            'by_shift' => $this->byShift($branchId, $from, $to, $taxRatio),
            'by_staff' => $this->byStaff($branchId, $from, $to, $taxRatio),
            // Gói 55 p11af (P0-14): KPI Food cost % = giá vốn NL / doanh thu thuần
            'food_cost_pct' => $foodCostPct,
            'food_cost_value' => $this->r2($foodCostValue),
        ];

        // ---------- Tab 2: Thu – Chi – Lợi nhuận ----------
        // Gói 55 p11af: tái dùng $foodCostValue đã tính ở trên (tránh tính giá vốn 2 lần)
        $costs = $this->costs($cur, $foodCostValue);
        $refCosts = $this->costs($ref);
        // Lát 1d (2026-11-04): THỐNG NHẤT cơ số lợi nhuận với trang P&L chi
        // tiết (pnl()) — trước đây khối này THIẾU "thu khác" ở vế thu và thiếu
        // chiết khấu kênh + phí marketing sàn + chi phí phân bổ ở vế chi, nên
        // hai bề mặt lệch đúng bằng các khoản đó (sống: lệch 105.000đ = phiếu
        // thu tay của kỳ). Nay dùng đúng cùng một chồng thu/chi như pnl().
        $otherIncomeOf = function (Carbon $f, Carbon $t) use ($branchId): float {
            return (float) Transaction::query()
                ->where('type', 'income')
                ->where('status', 'paid')
                ->whereNull('rejected_at')
                ->whereBetween('paid_at', [$f->toDateTimeString(), $t->toDateTimeString()])
                ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
                ->sum('amount');
        };
        $otherIncome = $otherIncomeOf($from, $to);
        $refOtherIncome = $otherIncomeOf($cFrom, $cTo);
        $commCur = array_sum(array_column($this->commissions($cur), 'cost'));
        $commRef = array_sum(array_column($this->commissions($ref), 'cost'));
        if ($commCur > 0) {
            $costs[] = ['name' => 'Chiết khấu kênh', 'value' => $commCur, 'color' => '#9B59B6'];
        }
        if ($commRef > 0) {
            $refCosts[] = ['name' => 'Chiết khấu kênh', 'value' => $commRef, 'color' => '#9B59B6'];
        }
        if ($mkt['total'] > 0) {
            $costs[] = ['name' => 'Phí marketing kênh sàn', 'value' => $mkt['total'], 'color' => '#E5646E'];
        }
        $refMkt = $this->marketingAdjustments($cFrom, $cTo, $branchId);
        if ($refMkt['total'] > 0) {
            $refCosts[] = ['name' => 'Phí marketing kênh sàn', 'value' => $refMkt['total'], 'color' => '#E5646E'];
        }
        $allocCur = $this->allocatedExpenses($branchId, $from, $to);
        if ($allocCur['total'] > 0) {
            $costs[] = ['name' => 'Chi phí phân bổ', 'value' => $allocCur['total'], 'color' => '#8E44AD',
                'note' => 'Tiền thuê trả trước / CAPEX chia đều theo tháng'];
        }
        $allocRef = $this->allocatedExpenses($branchId, $cFrom, $cTo);
        if ($allocRef['total'] > 0) {
            $refCosts[] = ['name' => 'Chi phí phân bổ', 'value' => $allocRef['total'], 'color' => '#8E44AD'];
        }
        $costTotal = array_sum(array_column($costs, 'value'));
        $refCostTotal = array_sum(array_column($refCosts, 'value'));
        $profitRevenue = $revDisplayed + $otherIncome;
        $refProfitRevenue = $refDisplayed + $refOtherIncome;
        $profit = $profitRevenue - $costTotal;
        $refProfit = $refProfitRevenue - $refCostTotal;
        // Gói 57: Prime Cost = Giá vốn NL + Lương; cảnh báo đỏ khi > 55% Net Revenue
        $laborCost = 0.0;
        foreach ($costs as $c) {
            if (($c['name'] ?? '') === 'Lương') { $laborCost = (float) $c['value']; break; }
        }
        $primeCost = $foodCostValue + $laborCost;
        $primeCostPct = $netRevenue > 0 ? round($primeCost / $netRevenue * 100, 1) : 0;
        $profitData = [
            'revenue' => $this->r2($profitRevenue), // Lát 1d: đã gồm thu khác — khớp pnl()
            'other_income' => $this->r2($otherIncome),
            'costs' => array_map(fn($c) => [
                'name' => $c['name'], 'value' => $this->r2($c['value']), 'color' => $c['color'],
                // B3 + C2 (rà soát chỉ số 2026-11-15): giữ ghi chú dòng chi phí
                // (banner "lương ƯỚC TÍNH" ở tab Thu-chi đọc note của dòng
                // Lương) + trả sẵn % theo cơ số Doanh thu thuần để FE không
                // tự tính lại theo tổng chi phí.
                'note' => $c['note'] ?? null,
                'pct' => $netRevenue > 0 ? $this->r2($c['value'] / $netRevenue * 100) : 0,
            ], $costs),
            'cost_total' => $this->r2($costTotal),
            'profit' => $this->r2($profit),
            // Thống nhất biên toàn hệ (ngài phán 2026-11-15): mẫu số = Doanh thu
            // thuần (KHÔNG gồm thu khác) — cùng cơ số với margin của pnl().
            // Tử số (profit) giữ nguyên: vẫn gồm thu khác, như PNL.
            'margin' => $netRevenue > 0 ? $this->r2($profit / $netRevenue * 100) : 0,
            'prime_cost' => $this->r2($primeCost),
            'prime_cost_pct' => $primeCostPct,
            'prime_cost_alert' => $primeCostPct > 55,
            'delta_profit' => $this->pct($profit, $refProfit),
            'delta_cost' => $this->pct($costTotal, $refCostTotal),
            'delta_revenue' => $this->pct($profitRevenue, $refProfitRevenue),
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
                // Gói PNL kênh sàn (2026-10-31): tóm tắt đối soát marketing của kỳ
                // cho giao diện gắn chú thích (tháng bị cắt / chưa nhập)
                'marketing' => [
                    'total' => $this->r2($mkt['total']),
                    'full_months' => $mkt['full_months'],
                    'partial_months' => $mkt['partial_months'],
                    'missing_months' => $mkt['missing_months'],
                ],
                // Chỉ số 360 đợt 1 — TC-1: hòa vốn tháng chứa ngày neo;
                // tab Tổng quan (kỳ Ngày) đọc mục tiêu đơn/ngày cạnh số đơn
                // thực tế hôm nay. Chưa phân loại danh mục → status riêng.
                'breakeven' => $this->breakeven($branchId, $anchor),
                // Chỉ số 360 đợt 2 (N-3) — TC-3: dự báo doanh thu cuối tháng
                // + lệch mục tiêu (chỉ kỳ Tháng; kỳ khác null).
                'forecast' => $period === 'month' ? $this->revenueForecast($branchId, $anchor, $vatRate, $tz) : null,
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
        // Fix runtime zip tổng: tiền tố orders. cho mọi cột — tránh ambiguous khi các
        // truy vấn breakdown join thêm shifts/users (cùng có status/created_at/branch_id).
        $q = Order::query()
            ->where('orders.payment_status', 'paid')
            ->where('orders.status', '!=', 'cancelled')
            ->whereBetween('orders.created_at', [$from->toDateTimeString(), $to->toDateTimeString()]);
        if ($branchId > 0) {
            $q->where('orders.branch_id', $branchId);
        }
        return $q;
    }

    /**
     * Biểu thức SQL doanh thu ghi nhận (TIỀN HÀNG) — vá phí ship THU HỘ
     * 2026-11-04, cùng quy tắc Order::revenueAmount(): đơn Mini App (zalo)
     * trừ shipping_fee (tiền thu hộ hãng giao), kênh khác giữ total_amount.
     */
    private function revSql(string $prefix = ''): string
    {
        return "({$prefix}total_amount - CASE WHEN {$prefix}online_channel = 'zalo' THEN {$prefix}shipping_fee ELSE 0 END)";
    }

    /**
     * Gom toàn bộ dữ liệu thô của 1 kỳ: đơn, dòng món, VAT, kênh, tồn theo giờ.
     * Trả về mảng để các tab dùng chung, tránh truy vấn lặp.
     */
    private function buildPeriod(int $branchId, Carbon $from, Carbon $to, float $vatRate, string $tz): array
    {
        $orderIds = $this->baseOrders($branchId, $from, $to)->pluck('id');
        $gross = (float) $this->baseOrders($branchId, $from, $to)->sum(DB::raw($this->revSql())); // Vá phí ship thu hộ 2026-11-04
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
                    'order_items.options', // F-360-3: nguồn tùy chọn thật cho BH-2 attach
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
            ->select('id', 'online_channel', 'payment_method', 'total_amount', 'shipping_fee', 'created_at')
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
        // F1 (phân xử chiến dịch 4 vai, 2026-11-05): 'online' là MÃ BẢNG GIÁ của
        // kênh Zalo Mini App, không phải một kênh riêng — đơn thật luôn mang
        // online_channel 'zalo'. Trước đây vũ trụ kênh nạp cả hai khóa nên báo
        // cáo lãi lỗ theo kênh hiện 2 dòng cùng tên "Zalo Mini App" (dòng
        // 'online' 0đ vĩnh viễn). Chuẩn hóa alias -> khóa chuẩn 'zalo' ngay tại
        // đây (cùng bảng alias commissionFor đã dùng: zalo -> [online, zalo]):
        // một kênh một dòng, dữ kiện lịch sử giữ nguyên (không sửa DB), tổng
        // không đổi. Cấu hình tích điểm theo kênh KHÔNG qua đường này
        // (LoyaltyService đọc online_channel thô) nên không bị ảnh hưởng.
        // Bổ sung 2026-11-15 (pháp y PNL): cặp 'nha_hang'/'pos' cùng là kênh
        // Tại quầy — đơn native (online_channel rỗng) rơi vào 'pos', đơn tại
        // quán qua cầu Sapo mang 'nha_hang'; vũ trụ kênh nạp cả hai khóa mà
        // không chuẩn hóa nên báo cáo hiện 2 dòng cùng tên "Tại quầy", tiền
        // tách đôi theo nguồn đơn. Chuẩn hóa về 'pos' (khóa mà commissionFor
        // đã dùng làm alias chính: pos -> [nha_hang, pos]).
        $canonChannel = ['online' => 'zalo', 'nha_hang' => 'pos'];
        $channelCodes = array_values(array_unique(array_map(
            fn($c) => $canonChannel[$c] ?? $c, $channelCodes)));
        $channels = array_fill_keys($channelCodes, 0.0);
        $orderChannels = [];
        foreach ($orders as $o) {
            $key = $this->channelKey($o);
            $key = $canonChannel[$key] ?? $key;
            if (!array_key_exists($key, $channels)) {
                // Kênh phát sinh từ đơn nhưng price_lists chưa có — vẫn ghi nhận
                $channels[$key] = 0.0;
            }
            $channels[$key] += $o->revenueAmount(); // Vá phí ship thu hộ 2026-11-04: kênh zalo chỉ tính tiền hàng (chiết khấu sàn tính trên số này — xem map gói)
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
     * Gói PNL kênh sàn (2026-10-31): chiết khấu đi qua commissionFor() — CÙNG
     * phép tính + xử lý cờ thuế với PNL (Khối 3 hợp nhất); khi $mkt có tháng
     * trọn và kênh đã nhập đối soát: cộng marketing_fee + gross_profit_after_marketing
     * (phí marketing hiển thị cùng thang thuế với các số khác của thẻ cho khớp
     * phép trừ trên thẻ; PNL dùng số gốc đã nhập, không nhân hệ số).
     */
    private function channels(array $cur, array $ref, float $taxRatio, ?array $mkt = null): array
    {
        $labels = $this->channelLabelMap();
        $byCode = $this->priceListByCode();
        $categories = $this->channelCategoryMap();
        $orderChannels = $cur['order_channels'] ?? [];

        // Giá vốn theo kênh từ snapshot unit_cost lúc trừ kho
        $cogsByChannel = [];
        foreach ($cur['items'] as $it) {
            $ck = $orderChannels[$it->order_id] ?? 'pos';
            $cogsByChannel[$ck] = ($cogsByChannel[$ck] ?? 0.0)
                + (float) ($it->unit_cost ?? 0) * (float) ($it->quantity ?? 0);
        }

        // BH-1 (chỉ số 360 đợt 1): giảm giá quán chịu theo kênh — lấy từ
        // discount_amount cấp đơn (đã gồm cả 3 nguồn KM/coupon/voucher ở
        // tầng đơn; phần sàn tài trợ không nằm trong cột này). Tính tại
        // đây để CÙNG một nơi phục vụ tab Doanh thu + trang PNL (T-02).
        $discountByChannel = [];
        if (isset($cur['from'], $cur['to'])) {
            $discRows = $this->baseOrders((int) ($cur['branch_id'] ?? 0), $cur['from'], $cur['to'])
                ->select('id', 'discount_amount')->get();
            foreach ($discRows as $o) {
                $ck = $orderChannels[$o->id] ?? 'pos';
                $discountByChannel[$ck] = ($discountByChannel[$ck] ?? 0.0) + (float) ($o->discount_amount ?? 0);
            }
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
            // Khối 3 (2026-10-31): chiết khấu dùng commissionFor() chung với PNL
            // — trước đây thẻ kênh bỏ qua cờ thuế nên lệch PNL ở kênh "chưa gồm thuế".
            $comm = $this->commissionFor((string) $key, $v, $byCode);
            $commission = $comm['cost'];
            $grossProfit = $v - $commission - $cogs;
            $marginPct = $v > 0 ? $grossProfit / $v * 100 : 0;
            if (isset($baseColors[$key])) {
                $color = $baseColors[$key];
            } else {
                $color = $palette[$pi % count($palette)];
                $pi++;
            }
            $row = [
                'key' => $key,
                'name' => $labels[$key] ?? ucfirst($key),
                // Spec kênh bán hàng (2026-10-19): phân loại kênh lấy từ price_lists
                'category' => $categories[$key] ?? 'partner',
                'value' => $this->r2($v * $taxRatio),
                'share' => $cur['gross'] > 0 ? $this->r2($v / $cur['gross'] * 100) : 0,
                'delta' => $this->pct($v, $rv),
                'color' => $color,
                'cogs' => $this->r2($cogs * $taxRatio),
                'commission' => $this->r2($commission * $taxRatio),
                'gross_profit' => $this->r2($grossProfit * $taxRatio),
                'margin_pct' => $this->r2($marginPct),
            ];
            // Khối 2.2 (2026-10-31): lãi gộp SAU marketing, chỉ khi kỳ có tháng
            // trọn và kênh này đã có số đối soát nhập — không có thì ẩn hẳn
            // (không hiện 0 gây hiểu lầm "đã đối soát").
            $mktFee = null;
            if ($mkt !== null && ($mkt['full_months'] ?? []) !== [] && $comm['code'] !== null
                && array_key_exists($comm['code'], $mkt['by_channel'] ?? [])) {
                $mktFee = (float) $mkt['by_channel'][$comm['code']];
                $after = $grossProfit - $mktFee;
                $row['marketing_fee'] = $this->r2($mktFee * $taxRatio);
                $row['gross_profit_after_marketing'] = $this->r2($after * $taxRatio);
                $row['margin_after_pct'] = $this->r2($v > 0 ? $after / $v * 100 : 0);
            }
            // BH-1 (chỉ số 360 đợt 1): tổng gánh nặng kênh + biên đóng góp
            // sau TOÀN BỘ chi phí kênh trực tiếp. Luật C5 giữ nguyên: không
            // phân bổ chi phí chung xuống kênh. Khi phí marketing của kênh
            // chưa có (kỳ chưa đối soát trọn tháng — §0.4) thì burden/
            // contribution để NULL kèm cờ, tuyệt đối không hiện số thiếu
            // như thể đã đủ.
            $disc = (float) ($discountByChannel[$key] ?? 0.0);
            $row['discount'] = $this->r2($disc * $taxRatio);
            if ($mktFee !== null) {
                $burden = $commission + $mktFee + $disc;
                $contribution = $v - $cogs - $burden;
                $row['burden_pct'] = $v > 0 ? $this->r2($burden / $v * 100) : 0;
                $row['contribution'] = $this->r2($contribution * $taxRatio);
                $row['contribution_pct'] = $v > 0 ? $this->r2($contribution / $v * 100) : 0;
                $row['burden_incomplete'] = false;
            } else {
                $row['burden_pct'] = null;
                $row['contribution'] = null;
                $row['contribution_pct'] = null;
                $row['burden_incomplete'] = true;
            }
            $out[] = $row;
        }
        // N-5: mốc đổi cấu hình chiết khấu/phí marketing trong kỳ, gắn theo
        // kênh — price_list theo mã bảng giá, đối soát tháng theo channel_code.
        $byKey = [];
        if (isset($cur['from'], $cur['to'])) {
            $logs = $this->configMarkers('channel_pricing', $cur['from'], $cur['to']);
            if ($logs !== []) {
                $plCodes = \App\Models\PriceList::query()
                    ->whereIn('id', collect($logs)->where('entity_type', 'price_list')->pluck('entity_id')->filter()->unique()->all())
                    ->pluck('code', 'id');
                $adjCodes = \App\Models\ChannelMonthlyAdjustment::query()
                    ->whereIn('id', collect($logs)->where('entity_type', 'channel_monthly_adjustment')->pluck('entity_id')->filter()->unique()->all())
                    ->pluck('channel_code', 'id');
                foreach ($logs as $m) {
                    $key = $m['entity_type'] === 'price_list'
                        ? ($plCodes[$m['entity_id']] ?? null)
                        : ($m['entity_type'] === 'channel_monthly_adjustment' ? ($adjCodes[$m['entity_id']] ?? null) : null);
                    if ($key !== null) $byKey[$key][] = $m;
                }
            }
        }
        foreach ($out as &$row) {
            $row['config_markers'] = $byKey[$row['key']] ?? [];
        }
        unset($row);
        return $out;
    }

    /**
     * Tên hiển thị kênh: 'pos' => "Tại quầy", 'zalo' => "Zalo Mini App",
     * các kênh khác lấy name từ price_lists (không đè 2 tên cố định trên).
     */
    private function channelLabelMap(): array
    {
        // F1b-2 (2026-11-05): 'nha_hang' là cùng kênh tại quầy với 'pos' —
        // ghim nhãn KÊNH ở đây để tên BẢNG GIÁ ("Giá tại nhà hàng") không
        // lọt làm tên kênh như trước; khóa + số liệu của dòng giữ nguyên.
        // Mở rộng 2026-11-15 (pháp y PNL): ghim luôn nhãn 4 kênh sàn —
        // trước đây chúng rơi vào nhánh dự phòng lấy name của bảng giá nên
        // hiện "Giá GrabFood / Giá ShopeeFood / Giá Green Food".
        $map = ['pos' => 'Tại quầy', 'zalo' => 'Zalo Mini App', 'nha_hang' => 'Tại quầy',
            'grabfood' => 'GrabFood', 'shopeefood' => 'ShopeeFood',
            'greenfood' => 'Green Food', 'befood' => 'BeFood'];
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

    /**
     * Spec kênh bán hàng (2026-10-19): phân loại kênh theo price_lists.category.
     * Mã cũ 'pos'/'zalo' (đơn import trước đây) map tương thích: pos -> store, zalo -> online.
     */
    private function channelCategoryMap(): array
    {
        $map = ['pos' => 'store', 'zalo' => 'online'];
        if (Schema::hasTable('price_lists') && Schema::hasColumn('price_lists', 'category')) {
            foreach (DB::table('price_lists')->select('code', 'category')->get() as $pl) {
                $code = strtolower(trim((string) $pl->code));
                if ($code !== '' && !isset($map[$code])) {
                    $map[$code] = $pl->category ?: 'partner';
                }
            }
        }
        return $map;
    }

    /** Doanh thu theo giờ 6h→22h (giờ có đơn đầu tiên → cuối cùng trong ngày). */
    private function hourly(int $branchId, Carbon $from, Carbon $to, float $taxRatio): array
    {
        $rows = $this->baseOrders($branchId, $from, $to)
            ->select(DB::raw('HOUR(created_at) AS h'), DB::raw('SUM(' . $this->revSql() . ') AS v')) // Vá phí ship thu hộ 2026-11-04
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

    /**
     * BH-2 (chỉ số 360 đợt 1): số món trên đơn (IPO) + tỷ lệ đơn có món
     * kèm (attach rate). Khóa định nghĩa tại spec: đơn NHÓM loại khỏi mẫu
     * chính (hiện riêng ipo_group); dòng QUÀ TẶNG không tính — dòng tặng
     * nhận diện bằng line_total = 0 (món KM tặng ghi giá 0 ở tầng đơn).
     * "Món kèm" = dòng có tùy chọn ở cột `options` JSON (F-360-3: cột
     * product_option_id không có dữ kiện thật — toàn bảng 0 dòng;
     * options JSON mới là nơi lựa chọn thật nằm, gồm size/topping/
     * món phụ). ĐỊNH NGHĨA ĐÃ CHỐT (Đại Vương phán 2026-11-15): ĐẾM
     * CHẶT — chỉ tính khi khách thật sự chọn thêm, tức
     * JSON_LENGTH(options) > 0; payload '[]' (bề mặt bán ghi mảng rỗng)
     * KHÔNG tính. Đối chiếu tháng 11/2026: 68/244 đơn = 27,9% (định
     * nghĩa lỏng cũ — options không NULL — cho 77/244 = 31,6%, lệch
     * đúng 9 đơn chỉ có '[]'; định nghĩa lỏng ĐÃ BỎ).
     */
    private function ipoMetrics(array $cur): array
    {
        $groupOrderIds = [];
        if (Schema::hasTable('group_orders') && Schema::hasColumn('group_orders', 'order_id')) {
            $groupOrderIds = DB::table('group_orders')->whereNotNull('order_id')
                ->pluck('order_id')->map(fn($v) => (int) $v)->flip()->all();
        }
        $perOrder = []; // order_id => ['qty' => float, 'attach' => bool, 'group' => bool]
        foreach ($cur['items'] as $it) {
            $oid = (int) $it->order_id;
            $isGroup = isset($groupOrderIds[$oid]);
            if (!isset($perOrder[$oid])) {
                $perOrder[$oid] = ['qty' => 0.0, 'attach' => false, 'group' => $isGroup];
            }
            if ((float) ($it->line_total ?? 0) <= 0) {
                continue; // dòng quà tặng / dòng 0đ — không tính IPO/attach
            }
            $perOrder[$oid]['qty'] += (float) ($it->quantity ?? 0);
            // Đếm chặt (định nghĩa đã chốt — xem docblock): options giải
            // mã phải có phần tử (JSON_LENGTH > 0); '[]' không tính.
            $opts = $it->options ?? null;
            $hasOptions = false;
            if (is_array($opts)) {
                $hasOptions = count($opts) > 0;
            } elseif (is_string($opts) && trim($opts) !== '') {
                $decoded = json_decode($opts);
                if (is_array($decoded)) $hasOptions = count($decoded) > 0;
                elseif (is_object($decoded)) $hasOptions = count(get_object_vars($decoded)) > 0;
            }
            if ($hasOptions) {
                $perOrder[$oid]['attach'] = true;
            }
        }
        $main = array_filter($perOrder, fn($o) => !$o['group'] && $o['qty'] > 0);
        $group = array_filter($perOrder, fn($o) => $o['group'] && $o['qty'] > 0);
        $orders = count($main);
        $qty = array_sum(array_column($main, 'qty'));
        $attach = count(array_filter($main, fn($o) => $o['attach']));
        $gOrders = count($group);
        $gQty = array_sum(array_column($group, 'qty'));
        return [
            'ipo' => $orders > 0 ? $this->r2($qty / $orders) : 0,
            'orders' => $orders,
            'items_qty' => $this->r2($qty),
            'attach_rate' => $orders > 0 ? $this->r2($attach / $orders * 100) : 0,
            'attach_orders' => $attach,
            'ipo_group' => $gOrders > 0 ? $this->r2($gQty / $gOrders) : null,
            'group_orders' => $gOrders,
        ];
    }

    /**
     * BH-3 (chỉ số 360 đợt 1): ma trận doanh thu Thứ × Giờ. Hàng = thứ
     * (2..8 theo ISO, 8 = Chủ nhật), cột = giờ 6..22 như hourly(). Ô cao
     * điểm nhất của phạm vi đang xem được đánh dấu is_peak.
     */
    private function daypart(int $branchId, Carbon $from, Carbon $to, float $taxRatio): array
    {
        $rows = $this->baseOrders($branchId, $from, $to)
            ->select(
                DB::raw('WEEKDAY(created_at) AS wd'),
                DB::raw('HOUR(created_at) AS h'),
                DB::raw('SUM(' . $this->revSql() . ') AS v'),
                DB::raw('COUNT(*) AS c')
            )
            ->groupBy('wd', 'h')
            ->get();
        $grid = [];
        $peak = null;
        foreach ($rows as $r) {
            $wd = (int) $r->wd; // 0 = Thứ 2 .. 6 = Chủ nhật
            $h = (int) $r->h;
            if ($h < 6 || $h > 22) continue;
            $v = (float) $r->v * $taxRatio;
            $grid[$wd][$h] = ['value' => $this->r2($v), 'orders' => (int) $r->c];
            if ($peak === null || $v > $peak['value']) {
                $peak = ['weekday' => $wd, 'hour' => $h, 'value' => $this->r2($v)];
            }
        }
        $out = [];
        for ($wd = 0; $wd < 7; $wd++) {
            $cells = [];
            for ($h = 6; $h <= 22; $h++) {
                $c = $grid[$wd][$h] ?? ['value' => 0, 'orders' => 0];
                $c['is_peak'] = $peak !== null && $peak['weekday'] === $wd && $peak['hour'] === $h && $c['value'] > 0;
                $cells[] = ['hour' => $h] + $c;
            }
            $out[] = ['weekday' => $wd, 'label' => ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'][$wd], 'cells' => $cells];
        }
        return ['rows' => $out, 'peak' => $peak];
    }

    /**
     * TC-1 (chỉ số 360 đợt 1): điểm hòa vốn của THÁNG chứa ngày neo.
     * - Chi phí cố định = phiếu chi danh mục cost_type='fixed' (cơ số
     *   paid_at) + phần lương cứng/BHXH + chi phí phân bổ tháng.
     * - Tỷ lệ biến đổi = (giá vốn BOM + chiết khấu kênh + phiếu chi
     *   cost_type='variable' + lương giờ) ÷ doanh thu tháng.
     * - Quy ước lương (spec): lương cứng + BHXH → Cố định; lương giờ theo
     *   ca → Biến đổi. Phần cố định của lương lấy = phụ cấp tháng đang
     *   hưởng + BHXH phần chủ sử dụng lao động; phần còn lại của tổng
     *   lương tháng là lương giờ (biến đổi).
     * - Danh mục chi CÓ phát sinh trong tháng mà chưa phân loại →
     *   status='unconfigured' + danh sách, KHÔNG ra số hòa vốn.
     * - Phạm vi CN: xem 1 CN chỉ tính phiếu của CN đó (phiếu branch_id
     *   NULL = chi chung toàn chuỗi, chỉ vào góc toàn chuỗi — luật C5).
     * - RdFixedCost (khai tay ở R&D) chỉ là dòng THAM CHIẾU đối chiếu;
     *   chuẩn tính là phân loại danh mục (spec TC-1).
     */
    private function breakeven(int $branchId, Carbon $anchor): array
    {
        $tz = 'Asia/Ho_Chi_Minh';
        $mStart = $anchor->copy()->startOfMonth()->startOfDay();
        $mEnd = $anchor->copy()->endOfMonth()->endOfDay();
        $month = $mStart->format('Y-m');
        $base = ['month' => $month, 'branch_id' => $branchId];

        if (!Schema::hasColumn('transaction_categories', 'cost_type')) {
            return $base + ['status' => 'unconfigured', 'unconfigured' => [], 'note' => 'Chưa chạy migration 000117 (cost_type).'];
        }

        $txQ = Transaction::query()
            ->where('type', 'expense')->where('status', 'paid')->whereNull('rejected_at')
            ->whereBetween('paid_at', [$mStart->toDateTimeString(), $mEnd->toDateTimeString()]);
        if ($branchId > 0) {
            $txQ->where('branch_id', $branchId);
        }
        $txs = $txQ->select('category_id', 'amount')->get();
        $catIds = $txs->pluck('category_id')->filter()->unique()->all();
        $cats = \App\Models\TransactionCategory::whereIn('id', $catIds)->get()->keyBy('id');
        $fixedTx = 0.0;
        $variableTx = 0.0;
        $unconfigured = [];
        foreach ($txs as $t) {
            $cat = $cats->get($t->category_id);
            $ct = $cat->cost_type ?? null;
            if ($ct === 'fixed') {
                $fixedTx += (float) $t->amount;
            } elseif ($ct === 'variable') {
                $variableTx += (float) $t->amount;
            } else {
                $name = $cat->name ?? 'Khác';
                $unconfigured[$name] = ($unconfigured[$name] ?? 0.0) + (float) $t->amount;
            }
        }
        if ($unconfigured !== []) {
            $list = [];
            foreach ($unconfigured as $name => $amt) {
                $list[] = ['name' => $name, 'amount' => $this->r2($amt)];
            }
            usort($list, fn($a, $b) => $b['amount'] <=> $a['amount']);
            return $base + [
                'status' => 'unconfigured',
                'unconfigured' => $list,
                'note' => 'Còn danh mục chi chưa phân loại Cố định/Biến đổi — vào Danh mục thu-chi để phân loại rồi số hòa vốn mới tính.',
            ];
        }

        // Lương tháng (số chốt nếu đã khóa, không thì ước tính — cùng
        // đường costs() của PNL) + tách phần cố định theo quy ước.
        $vatRate = (float) Setting::get('default_tax_rate', 8);
        $p = $this->buildPeriod($branchId, $mStart, $mEnd, $vatRate, $tz);
        $salExp = $this->shiftExpenses($p);
        $salary = (float) ($salExp['salary'] ?? 0);
        $empQ = \App\Models\Employee::query()->where('is_active', true);
        if ($branchId > 0) {
            $empQ->where('branch_id', $branchId);
        }
        $empIds = $empQ->pluck('id')->all();
        $allowances = $empIds === [] ? 0.0 : (float) DB::table('employee_allowances')
            ->whereIn('employee_id', $empIds)->where('is_active', true)
            ->where(fn($q) => $q->where('month', $month)->orWhereNull('month'))
            ->sum('amount');
        $bhxhEmployer = 0.0;
        if ($empIds !== [] && Schema::hasTable('employee_insurances')) {
            $rEmp = (float) Setting::get('bhxh_employer_rate', 21.5);
            $rEmpSide = (float) Setting::get('bhxh_emp_bhxh', 8)
                + (float) Setting::get('bhxh_emp_bhyt', 1.5)
                + (float) Setting::get('bhxh_emp_bhtn', 1);
            foreach (\App\Models\EmployeeInsurance::whereIn('employee_id', $empIds)->where('is_active', true)->get() as $ins) {
                $rate = $rEmp + (!empty($ins->employer_pays_all) ? $rEmpSide : 0);
                $bhxhEmployer += (float) $ins->base_amount * $rate / 100;
            }
        }
        $salaryFixed = min($salary, $allowances + $bhxhEmployer);
        $salaryVariable = max(0.0, $salary - $salaryFixed);

        $allocated = $this->allocatedExpenses($branchId, $mStart, $mEnd)['total'];
        $fixed = $fixedTx + $salaryFixed + $allocated;

        $bom = $this->bomCost($p);
        $comm = array_sum(array_column($this->commissions($p), 'cost'));
        $variable = $bom + $comm + $variableTx + $salaryVariable;

        $otherIncome = (float) Transaction::query()
            ->where('type', 'income')->where('status', 'paid')->whereNull('rejected_at')
            ->whereBetween('paid_at', [$mStart->toDateTimeString(), $mEnd->toDateTimeString()])
            ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
            ->sum('amount');
        $revenue = (float) $p['gross'] + $otherIncome;
        $variableRatio = $revenue > 0 ? $variable / $revenue : 0.0;
        $beRevenue = ($revenue > 0 && $variableRatio < 1) ? $fixed / (1 - $variableRatio) : null;

        $openDays = (int) $this->baseOrders($branchId, $mStart, $mEnd)
            ->select(DB::raw('COUNT(DISTINCT DATE(created_at)) AS d'))->value('d');
        $aov = $p['orders'] > 0 ? $revenue / $p['orders'] : 0.0;
        $dailyRevenue = ($beRevenue !== null && $openDays > 0) ? $beRevenue / $openDays : null;
        $ordersPerDay = ($dailyRevenue !== null && $aov > 0) ? $dailyRevenue / $aov : null;

        $rdFixed = null;
        if (Schema::hasTable('rd_fixed_costs')) {
            $rdQ = \App\Models\RdFixedCost::query();
            if ($branchId > 0) {
                $rdQ->where('branch_id', $branchId);
            } else {
                $rdQ->whereNull('branch_id');
            }
            $rdFixed = $this->r2((float) $rdQ->sum('amount'));
        }

        return $base + [
            'status' => 'ok',
            'fixed_costs' => $this->r2($fixed),
            'fixed_parts' => [
                'transactions' => $this->r2($fixedTx),
                'salary_fixed' => $this->r2($salaryFixed),
                'allocated' => $this->r2($allocated),
            ],
            'variable_costs' => $this->r2($variable),
            'variable_ratio' => $this->r2($variableRatio * 100),
            'revenue' => $this->r2($revenue),
            'breakeven_revenue' => $beRevenue === null ? null : $this->r2($beRevenue),
            'open_days' => $openDays,
            'aov' => $this->r2($aov),
            'daily_breakeven_revenue' => $dailyRevenue === null ? null : $this->r2($dailyRevenue),
            'daily_breakeven_orders' => $ordersPerDay === null ? null : $this->r2($ordersPerDay),
            'rd_fixed_reference' => $rdFixed,
            'salary_is_estimate' => !($salExp['salary_locked'] ?? false),
            'note' => 'Quy ước: lương cứng + BHXH vào Cố định · lương giờ theo ca vào Biến đổi. Chi phí chung toàn chuỗi chỉ ở góc toàn chuỗi.',
        ];
    }

    /**
     * TC-3 — mục tiêu tháng (N-3): tổng mục tiêu (CN × tháng) của tháng
     * chứa ngày neo. View toàn chuỗi = tổng các mục tiêu CN.
     */
    private function revenueTargetFor(int $branchId, Carbon $anchor): array
    {
        $monthStart = $anchor->copy()->startOfMonth()->startOfDay();
        $rows = RevenueTarget::query()->whereDate('month', $monthStart->toDateString());
        if ($branchId > 0) $rows->where('branch_id', $branchId);
        $rows = $rows->get(['branch_id', 'target_amount']);
        return [
            'month' => $monthStart->format('Y-m'),
            'target' => $rows->isNotEmpty() ? $this->r2((float) $rows->sum('target_amount')) : null,
            'has_target' => $rows->isNotEmpty(),
            'by_branch' => $rows->map(fn($r) => ['branch_id' => (int) $r->branch_id, 'target' => $this->r2((float) $r->target_amount)])->values()->all(),
        ];
    }

    /**
     * TC-3 (360 đợt 2, N-3): dự báo doanh thu cuối tháng (run-rate) — chỉ
     * tính khi kỳ là tháng. Cơ số: doanh thu THUẦN (gross − VAT) qua đúng
     * buildPeriod/baseOrders (§0.1/T-01). Phần còn lại của tháng = Σ ngày
     * còn lại × doanh thu TB cùng thứ-trong-tuần trong 8 tuần trước đầu
     * tháng; khoảng ± = 1 độ lệch chuẩn doanh thu ngày × sqrt(số ngày còn
     * lại). Số ƯỚC TÍNH — hệ số lịch sử có thể sai khi tháng có yếu tố
     * bất thường (spec §4 TC-3).
     */
    private function revenueForecast(int $branchId, Carbon $anchor, float $vatRate, string $tz): array
    {
        $monthStart = $anchor->copy()->startOfMonth()->startOfDay();
        $monthEnd = $anchor->copy()->endOfMonth()->endOfDay();
        $mtd = $this->buildPeriod($branchId, $monthStart, $anchor->copy()->endOfDay(), $vatRate, $tz);
        $mtdNet = max(0, $mtd['gross'] - $mtd['vat']);

        $histFrom = $monthStart->copy()->subDays(56)->startOfDay();
        $histTo = $monthStart->copy()->subDay()->endOfDay();
        $hist = $this->buildPeriod($branchId, $histFrom, $histTo, $vatRate, $tz);
        $histTaxRatio = $hist['gross'] > 0 ? (float) $hist['vat'] / (float) $hist['gross'] : 0.0;
        $dailyGross = $this->baseOrders($branchId, $histFrom, $histTo)
            ->selectRaw('DATE(orders.created_at) AS d, SUM(' . $this->revSql('orders.') . ') AS g')
            ->groupBy('d')->pluck('g', 'd');
        // Đủ 56 ngày (kể cả ngày 0đ) để mỗi thứ có đúng 8 mẫu.
        $dailyNet = [];
        $cursor = $histFrom->copy();
        while ($cursor->lte($histTo)) {
            $dailyNet[] = ['dow' => $cursor->dayOfWeek, 'net' => (float) ($dailyGross[$cursor->toDateString()] ?? 0) * (1 - $histTaxRatio)];
            $cursor->addDay();
        }
        $weekdaySums = array_fill(0, 7, 0.0);
        $weekdayCounts = array_fill(0, 7, 0);
        foreach ($dailyNet as $d) {
            $weekdaySums[$d['dow']] += $d['net'];
            $weekdayCounts[$d['dow']]++;
        }
        $weekdayMeans = [];
        for ($w = 0; $w < 7; $w++) {
            $weekdayMeans[$w] = $weekdayCounts[$w] > 0 ? $weekdaySums[$w] / $weekdayCounts[$w] : 0.0;
        }
        $remainingDays = [];
        $cursor = $anchor->copy()->addDay()->startOfDay();
        while ($cursor->lte($monthEnd)) {
            $remainingDays[] = $cursor->dayOfWeek;
            $cursor->addDay();
        }
        $expected = 0.0;
        foreach ($remainingDays as $dow) $expected += $weekdayMeans[$dow];
        $n = count($dailyNet);
        $mean = $n > 0 ? array_sum(array_column($dailyNet, 'net')) / $n : 0.0;
        $var = 0.0;
        foreach ($dailyNet as $d) $var += ($d['net'] - $mean) ** 2;
        $sigma = $n > 1 ? sqrt($var / ($n - 1)) : 0.0;
        $half = $sigma * sqrt(count($remainingDays));

        $mid = $mtdNet + $expected;
        $target = $this->revenueTargetFor($branchId, $anchor);
        return [
            'month' => $monthStart->format('Y-m'),
            'target' => $target['target'],
            'has_target' => $target['has_target'],
            'mtd_net' => $this->r2($mtdNet),
            'remaining_days' => count($remainingDays),
            'forecast_low' => $this->r2(max($mtdNet, $mid - $half)),
            'forecast_mid' => $this->r2($mid),
            'forecast_high' => $this->r2($mid + $half),
            'deviation_pct' => ($target['target'] ?? 0) > 0 ? $this->r2(($mid - $target['target']) / $target['target'] * 100) : null,
            'is_estimate' => true,
            'note' => 'Ước tính theo doanh thu trung bình cùng thứ trong 8 tuần gần nhất — hệ số lịch sử có thể sai khi tháng có yếu tố bất thường.',
        ];
    }

    /**
     * N-5: mốc đổi cấu hình của 1 họ trong kỳ — trả danh sách gọn cho FE
     * hiện "Cấu hình đổi ngày X". An toàn khi bảng chưa có (migration
     * 000122 chưa chạy) thì trả rỗng, không làm gãy báo cáo.
     */
    private function configMarkers(string $family, Carbon $from, Carbon $to): array
    {
        if (!Schema::hasTable('config_change_logs')) {
            return [];
        }
        return \App\Models\ConfigChangeLog::where('family', $family)
            ->whereBetween('changed_at', [$from->toDateTimeString(), $to->toDateTimeString()])
            ->orderBy('changed_at')
            ->get(['family', 'entity_type', 'entity_id', 'label', 'field', 'old_value', 'new_value', 'changed_by_name', 'changed_at'])
            ->map(fn($l) => [
                'family' => $l->family,
                'entity_type' => $l->entity_type,
                'entity_id' => $l->entity_id !== null ? (int) $l->entity_id : null,
                'label' => $l->label,
                'field' => $l->field,
                'old_value' => $l->old_value,
                'new_value' => $l->new_value,
                'changed_by_name' => $l->changed_by_name,
                'changed_at' => $l->changed_at?->format('d/m/Y H:i'),
            ])->all();
    }

    /** Các cột cho biểu đồ doanh thu: day→giờ, week→ngày, month→tuần, year→tháng. */
    private function buckets(string $period, int $branchId, Carbon $from, Carbon $to, string $tz, float $taxRatio): array
    {
        $defs = $this->bucketDefs($period, $from, $to, $tz);
        $out = [];
        foreach ($defs as $d) {
            $gross = (float) $this->baseOrders($branchId, $d['from'], $d['to'])->sum(DB::raw($this->revSql())); // Vá phí ship thu hộ 2026-11-04
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
            ['name' => 'Lương', 'value' => $exp['salary'], 'color' => '#24305E',
             'note' => ($exp['salary_locked'] ?? false) ? 'Số đã chốt lương' : 'Ước tính — chưa chốt lương'], 
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
        // Spec P4-C4: kỳ đã chốt → lấy số chốt; chưa chốt → ước tính đầy đủ + nhãn
        $payroll = $this->payrollSalaryForMonth($p);
        $salaryLocked = false;
        if ($payroll !== null) {
            $salary = $payroll['value'];
            $salaryLocked = $payroll['locked'];
        }
        return ['salary' => $salary, 'other' => $other, 'salary_locked' => $salaryLocked];
    }

    /**
     * Gói 55 p11ad: tổng lương của 1 tháng.
     * Spec P4-C4: kỳ đã chốt → lấy số chốt (payroll_locks.net_total);
     * kỳ chưa chốt → ước tính đầy đủ thành phần + nhãn "ước tính".
     * Trả về null nếu kỳ báo cáo không phải trọn 1 tháng DL → dùng fallback dò chuỗi cũ.
     * @return array{value: float, locked: bool}|null
     */
    private function payrollSalaryForMonth(array $p): ?array
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

        $month = $from->format('Y-m');
        $start = $from->format('Y-m-d');
        $end = $monthEnd->format('Y-m-d');
        $branchId = (int) ($p['branch_id'] ?? 0);

        // §3.8: kỳ đã chốt → dùng số chốt. Khóa toàn hệ (branch_id NULL)
        // dùng cho mọi góc xem; khóa theo CN chỉ dùng khi đang xem đúng CN
        // đó. Góc toàn hệ đang chốt rời rạc theo CN thì cộng số chốt của
        // các CN đã chốt + ước tính phần CN chưa chốt (xem khối dưới).
        if (\Illuminate\Support\Facades\Schema::hasTable('payroll_locks')) {
            $lock = \App\Models\PayrollLock::get($month, $branchId > 0 ? $branchId : null);
            if ($lock) {
                return ['value' => (float) $lock->net_total, 'locked' => true];
            }
        }

        // §3.8: góc toàn hệ khi đã chốt rời rạc theo CN — tổng = Σ net_total
        // các khóa CN đã chốt + ước tính phần CN chưa chốt. Không còn ngày
        // công nào ở CN chưa chốt thì tổng = đúng số chốt (locked = true).
        if ($branchId === 0 && \Illuminate\Support\Facades\Schema::hasTable('payroll_locks')) {
            $branchLocks = \App\Models\PayrollLock::where('month', $month)->whereNotNull('branch_id')->get();
            if ($branchLocks->isNotEmpty()) {
                $lockedSum = (float) $branchLocks->sum('net_total');
                $lockedIds = $branchLocks->pluck('branch_id')->map(fn ($v) => (int) $v)->all();
                $rest = $this->estimatePayrollForMonth($month, $start, $end, 0, $lockedIds);
                if ($rest === null) return ['value' => round($lockedSum), 'locked' => true];
                return ['value' => round($lockedSum + $rest), 'locked' => false];
            }
        }

        $estimate = $this->estimatePayrollForMonth($month, $start, $end, $branchId);
        if ($estimate === null) return null; // chưa có dữ liệu chấm công → fallback
        return ['value' => round($estimate), 'locked' => false];
    }

    /**
     * Ước tính lương 1 tháng từ ngày công + khoản theo tháng.
     * $onlyBranchId > 0: chỉ tính ngày công của CN đó (góc xem 1 CN).
     * $excludeBranchIds: bỏ ngày công các CN này; khoản theo tháng của NV
     * chỉ tính khi CN chính của NV không nằm trong danh sách loại (khuôn
     * engine buildPayrollData: khoản theo tháng chỉ hiện ở dòng CN chính).
     * Trả null khi không còn ngày công nào trong phạm vi (để caller fallback).
     * LƯU Ý: ước tính vẫn là xấp xỉ — đơn giá lấy theo mức hiện hành, không
     * theo mức từng ngày như engine chốt (xem §DT).
     */
    private function estimatePayrollForMonth(string $month, string $start, string $end, int $onlyBranchId = 0, array $excludeBranchIds = []): ?float
    {
        // Chưa chốt → ước tính đầy đủ: giờ × đơn giá + ăn + thưởng + phụ cấp − trừ khác − ứng − BHXH
        $hoursMap = DB::table('salary_days')
            ->whereBetween('date', [$start, $end])
            ->when($onlyBranchId > 0, fn($q) => $q->where('branch_id', $onlyBranchId))
            ->when($excludeBranchIds !== [], fn ($q) => $q->whereNotIn('branch_id', $excludeBranchIds))
            ->selectRaw('employee_id, SUM(hours) as total_hours, SUM(meal_count) as total_meals')
            ->groupBy('employee_id')
            ->get()->keyBy('employee_id');
        if ($hoursMap->isEmpty()) return null; // chưa có dữ liệu chấm công → fallback

        $empIds = $hoursMap->keys()->all();
        $employees = \App\Models\Employee::whereIn('id', $empIds)->get()->keyBy('id');
        $mealPrice = (float) \App\Models\Setting::get('meal_price', \App\Models\Setting::get('meal_allowance_amount', 25000));
        $bonuses = DB::table('bonuses')->whereIn('employee_id', $empIds)
            ->whereBetween('date', [$start, $end])->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        $advances = DB::table('salary_advances')->whereIn('employee_id', $empIds)
            ->whereBetween('date', [$start, $end])->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        $deducts = DB::table('salary_deductions')->whereIn('employee_id', $empIds)
            ->where('month', $month)->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        // §3.8/§DT: phụ cấp theo NV trước đây không được cộng vào ước tính
        // (lệch 5.300.000 ở 10/2026) — cộng theo đúng khuôn engine
        // (dòng theo tháng + dòng áp dụng mọi tháng, chỉ NV đang hưởng).
        $allowances = DB::table('employee_allowances')->whereIn('employee_id', $empIds)
            ->where('is_active', true)
            ->where(fn ($q) => $q->where('month', $month)->orWhereNull('month'))
            ->selectRaw('employee_id, SUM(amount) as t')->groupBy('employee_id')->pluck('t', 'employee_id');
        $insMap = \App\Models\EmployeeInsurance::whereIn('employee_id', $empIds)->where('is_active', true)->get()->keyBy('employee_id');
        $rBhxh = (float) \App\Models\Setting::get('bhxh_emp_bhxh', 8)
            + (float) \App\Models\Setting::get('bhxh_emp_bhyt', 1.5)
            + (float) \App\Models\Setting::get('bhxh_emp_bhtn', 1);

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
            $net = (float) $h->total_hours * $rate
                + (float) ($h->total_meals ?? 0) * $mealPrice;
            // Khoản theo tháng chỉ tính khi CN chính của NV chưa chốt
            // (CN chính đã chốt thì các khoản này đã nằm trong net_total
            // của khóa CN đó — cộng nữa là trùng).
            $moneyMain = $excludeBranchIds === [] || !in_array((int) ($emp->branch_id ?? 0), $excludeBranchIds, true);
            if ($moneyMain) {
                $net += (float) ($bonuses[$empId] ?? 0)
                    + (float) ($allowances[$empId] ?? 0)
                    - (float) ($deducts[$empId] ?? 0)
                    - (float) ($advances[$empId] ?? 0);
                $ins = $insMap->get($empId);
                if ($ins && !$ins->employer_pays_all) {
                    $net -= (float) $ins->base_amount * $rBhxh / 100;
                }
            }
            $total += $net;
        }
        return $total;
    }

    /** Cột kép Thu/Chi/Lợi nhuận theo từng bucket của kỳ. */
    private function profitGroups(string $period, int $branchId, Carbon $from, Carbon $to, float $vatRate, string $tz, callable $disp, bool $withCommission = false): array
    {
        $defs = $this->bucketDefs($period, $from, $to, $tz);
        $out = [];
        foreach ($defs as $d) {
            $p = $this->buildPeriod($branchId, $d['from'], $d['to'], $vatRate, $tz);
            $rev = $disp($p['gross'], $p['vat']);
            if ($withCommission) {
                // F2 (phân xử chiến dịch 4 vai, 2026-11-05): số đầu trang PNL đã
                // gồm "Thu khác" (phiếu thu tay — chủ đích Gói 55 p11ac) nhưng
                // chuỗi biểu đồ thì không, cùng màn lệch nhau đúng số đó
                // (mẫu vật 133.000đ). Cộng Thu khác của từng cột vào 'thu' với
                // ĐÚNG điều kiện của số đầu trang (paid + chưa bị từ chối +
                // paid_at trong cửa sổ cột + lọc CN) để tổng các cột khớp số
                // đầu trang. Đường overview (withCommission=false) giữ nguyên:
                // đầu trang bên đó không gồm Thu khác.
                $rev += (float) Transaction::query()
                    ->where('type', 'income')
                    ->where('status', 'paid')
                    ->whereNull('rejected_at')
                    ->whereBetween('paid_at', [$d['from']->toDateTimeString(), $d['to']->toDateTimeString()])
                    ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
                    ->sum('amount');
            }
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
            ->select('payment_method', DB::raw('SUM(' . $this->revSql() . ') AS v'), DB::raw('COUNT(*) AS c')) // Vá phí ship thu hộ 2026-11-04
            ->groupBy('payment_method')
            ->orderByDesc('v')
            ->get();
        $out = [];
        // Vá nhãn PTTT (2026-11-15, ngài duyệt A+B+C): chuẩn hóa khóa THÔ trước khi gom —
        // chữ tiếng Việt lọt thẳng ('Tiền mặt'/'Chuyển khoản') gộp về mã chuẩn cash/transfer
        // (cùng mẫu chuẩn hóa kênh ở dataset()); rỗng/NULL → 'unknown' giữ nguyên (điểm C).
        $canonPay = ['tiền mặt' => 'cash', 'chuyển khoản' => 'transfer'];
        foreach ($rows as $r) {
            $key = mb_strtolower(trim((string) ($r->payment_method ?? '')));
            $key = $canonPay[$key] ?? $key;
            $key = $key === '' ? 'unknown' : $key;
            if (!isset($out[$key])) {
                $out[$key] = ['v' => 0.0, 'c' => 0];
            }
            $out[$key]['v'] += (float) $r->v;
            $out[$key]['c'] += (int) $r->c;
        }
        uasort($out, fn ($a, $b) => $b['v'] <=> $a['v']);
        return $out;
    }

    private function paymentLabel(string $key): string
    {
        $map = [
            'cash' => 'Tiền mặt', 'transfer' => 'Chuyển khoản', 'bank' => 'Chuyển khoản',
            'card' => 'Thẻ', 'momo' => 'MoMo', 'vnpay' => 'VNPay',
            'zalopay' => 'ZaloPay', 'shopeepay' => 'ShopeePay', 'unknown' => 'Không rõ',
            // Điểm A (2026-11-15): COD của Mini App — giữ dòng riêng, KHÔNG gộp Tiền mặt (lệch đối soát két).
            'pay_at_store' => 'COD — trả khi nhận',
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

    // Spec P4-C1: breakdown doanh thu theo ca thu ngân (đơn, doanh thu, AOV)
    private function byShift(int $branchId, Carbon $from, Carbon $to, float $taxRatio): array
    {
        // HOTFIX 2026-10-20: bảng shifts KHÔNG có user_id (migration 20/09 tạo lại bảng,
        // người mở ca lưu dạng text ở cashier_name / opened_by_name — Gói 55). Bỏ join users,
        // lấy thẳng tên người mở ca từ shifts.
        $rows = $this->baseOrders($branchId, $from, $to)
            ->leftJoin('shifts', 'shifts.id', '=', 'orders.shift_id')
            ->selectRaw('COALESCE(shifts.id, 0) as sid, shifts.opened_at as opened, COALESCE(shifts.opened_by_name, shifts.cashier_name) as cashier, COUNT(*) as c, SUM(' . $this->revSql('orders.') . ') as v') // Vá phí ship thu hộ 2026-11-04
            ->groupBy('sid', 'opened', 'cashier')->orderByDesc('v')->get();
        $total = (float) $rows->sum('v');
        return $rows->map(function ($r) use ($taxRatio, $total) { // FIX 2026-11-04: closure dùng 2 biến ngoài ($taxRatio + $total cho 'share') — v1 chỉ bắt $taxRatio nên lỗi $total nổ tiếp khi có hàng theo ca; bản này bắt đủ cả hai
            $label = $r->sid
                ? ('Ca #' . $r->sid . ($r->opened ? ' — ' . Carbon::parse($r->opened)->format('d/m H:i') : '') . ($r->cashier ? ' (' . $r->cashier . ')' : ''))
                : 'Không rõ ca';
            return [
                'key' => (int) $r->sid,
                'name' => $label,
                'value' => $this->r2((float) $r->v * $taxRatio),
                'orders' => (int) $r->c,
                'avg' => $r->c > 0 ? $this->r2((float) $r->v * $taxRatio / (int) $r->c) : 0,
                'share' => $total > 0 ? $this->r2((float) $r->v / $total * 100) : 0,
            ];
        })->values()->all();
    }

    // Spec P4-C2: breakdown doanh thu theo nhân viên (đơn, doanh thu, AOV/NV)
    private function byStaff(int $branchId, Carbon $from, Carbon $to, float $taxRatio): array
    {
        $rows = $this->baseOrders($branchId, $from, $to)
            ->leftJoin('users', 'users.id', '=', 'orders.user_id')
            ->selectRaw('COALESCE(users.id, 0) as uid, COALESCE(users.name, ?) as uname, COUNT(*) as c, SUM(' . $this->revSql('orders.') . ') as v', ['Không rõ NV']) // Vá phí ship thu hộ 2026-11-04
            ->groupBy('uid', 'uname')->orderByDesc('v')->get();
        $total = (float) $rows->sum('v');
        return $rows->map(fn ($r) => [
            'key' => (int) $r->uid,
            'name' => $r->uname,
            'value' => $this->r2((float) $r->v * $taxRatio),
            'orders' => (int) $r->c,
            'avg' => $r->c > 0 ? $this->r2((float) $r->v * $taxRatio / (int) $r->c) : 0,
            'share' => $total > 0 ? $this->r2((float) $r->v / $total * 100) : 0,
        ])->values()->all();
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
            // C5 (2026-10-21): chi phí trả trước KHÔNG gắn CN (chung toàn chuỗi) chỉ tính ở
            // view "Tất cả chi nhánh" (branchId = 0, không lọc). P&L từng CN chỉ tính khoản
            // gắn đúng CN đó — hết lỗi cộng P&L 2 CN > P&L tổng.
            $q->where('branch_id', $branchId);
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
    /** Bảng giá theo mã (lowercase) — dùng chung cho mọi đường tính chiết khấu */
    private function priceListByCode(): array
    {
        $byCode = [];
        if (Schema::hasTable('price_lists') && Schema::hasColumn('price_lists', 'commission_rate')) {
            foreach (DB::table('price_lists')
                ->select('code', 'name', 'commission_rate', 'commission_tax_included', 'commission_tax_rate')
                ->get() as $pl) {
                $byCode[strtolower((string) $pl->code)] = $pl;
            }
        }
        return $byCode;
    }

    /**
     * Gói PNL kênh sàn (2026-10-31) — Khối 3: MỘT phép tính chiết khấu duy nhất
     * dùng chung cho PNL (commissions) và thẻ kênh (channels): cùng nền
     * total_amount (doanh thu kênh sau giảm, đã gồm VAT — giữ nguyên theo sự
     * thật sàn tính), cùng % của bảng giá, cùng xử lý cờ thuế như PNL vẫn làm.
     * Trả: bảng giá đã khớp (nếu có) + mã bảng giá + rate + cost + chú thích thuế.
     */
    private function commissionFor(string $chKey, float $rev, array $byCode): array
    {
        $aliases = ['pos' => ['nha_hang', 'pos'], 'zalo' => ['online', 'zalo']];
        $pl = null;
        foreach (($aliases[$chKey] ?? [$chKey]) as $c) {
            if (isset($byCode[strtolower($c)])) {
                $pl = $byCode[strtolower($c)];
                break;
            }
        }
        $rate = $pl ? (float) $pl->commission_rate : 0.0;
        $cost = $rev * $rate / 100;
        $taxNote = 'đã gồm thuế';
        if ($pl && !$pl->commission_tax_included) {
            $tr = (float) ($pl->commission_tax_rate ?? 0);
            if ($tr > 0) {
                $cost *= (1 + $tr / 100);
                $taxNote = 'chưa gồm thuế (+' . $this->r2($tr) . '% thuế)';
            } else {
                $taxNote = 'chưa gồm thuế (chưa nhập thuế suất)';
            }
        }
        return [
            'price_list' => $pl,
            'code' => $pl ? strtolower((string) $pl->code) : null,
            'rate' => $rate,
            'cost' => $cost,
            'tax_note' => $taxNote,
        ];
    }

    private function commissions(array $p): array
    {
        $byCode = $this->priceListByCode();
        if ($byCode === []) {
            return [];
        }
        $labels = $this->channelLabelMap();
        $out = [];
        foreach (($p['channels'] ?? []) as $chKey => $rev) {
            $rev = (float) $rev;
            $c = $this->commissionFor((string) $chKey, $rev, $byCode);
            if ($c['rate'] <= 0) {
                continue;
            }
            $pl = $c['price_list'];
            $out[] = [
                'channel_key' => $chKey,
                'channel' => $labels[$chKey] ?? ucfirst($chKey),
                'price_list' => $pl->name ?? $pl->code,
                'rate' => $this->r2($c['rate']),
                'tax_note' => $c['tax_note'],
                'revenue' => $this->r2($rev),
                'cost' => $this->r2($c['cost']),
            ];
        }
        return $out;
    }

    /**
     * Gói PNL kênh sàn (2026-10-31) — Khối 1.5/2: đọc phí marketing sàn đã nhập
     * cho các THÁNG TRỌN nằm trong kỳ [from, to]. Tháng bị kỳ cắt ngang không
     * tính phần nào (không chia tỷ lệ theo ngày). Chỉ tính dòng active.
     * Trả: full_months (Y-m) · partial_months (Y-m bị cắt) · missing_months
     * (tháng trọn chưa có dòng nhập nào trong phạm vi) · items · total ·
     * by_channel (mã bảng giá => tổng).
     */
    private function marketingAdjustments(Carbon $from, Carbon $to, int $branchId): array
    {
        $empty = ['full_months' => [], 'partial_months' => [], 'missing_months' => [], 'items' => [], 'total' => 0.0, 'by_channel' => []];
        $full = [];
        $partial = [];
        $cursor = $from->copy()->startOfMonth();
        $lastMonth = $to->copy()->startOfMonth();
        while ($cursor->lte($lastMonth)) {
            $mStart = $cursor->copy()->startOfMonth()->startOfDay();
            $mEnd = $cursor->copy()->endOfMonth()->endOfDay();
            if ($from->lte($mStart) && $to->gte($mEnd)) {
                $full[] = $cursor->format('Y-m');
            } else {
                $partial[] = $cursor->format('Y-m');
            }
            $cursor->addMonth();
        }
        if ($full === [] || !Schema::hasTable('channel_monthly_adjustments')) {
            return array_merge($empty, ['full_months' => $full, 'partial_months' => $partial,
                'missing_months' => $full]);
        }
        $labels = $this->channelLabelMap();
        $branchNames = Branch::pluck('name', 'id');
        $rows = ChannelMonthlyAdjustment::query()
            ->where('status', 'active')
            ->whereIn(DB::raw("DATE_FORMAT(month, '%Y-%m')"), $full)
            ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
            ->orderBy('month')
            ->get();
        $items = [];
        $byChannel = [];
        $enteredMonths = [];
        $total = 0.0;
        foreach ($rows as $r) {
            $ym = $r->month->format('Y-m');
            $enteredMonths[$ym] = true;
            $fee = (float) $r->marketing_fee;
            $total += $fee;
            $code = strtolower((string) $r->channel_code);
            $byChannel[$code] = ($byChannel[$code] ?? 0.0) + $fee;
            $items[] = [
                'channel_code' => $r->channel_code,
                'channel' => $labels[$code] ?? ($r->channel_code),
                'branch_id' => (int) $r->branch_id,
                'branch' => $branchNames[$r->branch_id] ?? ('CN #' . $r->branch_id),
                'month' => $ym,
                'amount' => $this->r2($fee),
            ];
        }
        $missing = array_values(array_filter($full, fn($m) => !isset($enteredMonths[$m])));
        return ['full_months' => $full, 'partial_months' => $partial, 'missing_months' => $missing,
            'items' => $items, 'total' => $total, 'by_channel' => $byChannel];
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
        if ($deny = $this->guardReportBranch($request)) return $deny;
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

        // ===== Chỉ số 360 đợt 1: KHO-1/2/3/4a + kiểm kê nhanh §6 =====
        $inv360 = $this->inventoryMetrics($cur, $wasteRows, $branchId, $period);

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
                // Spec P4-C3: giá trị tồn kho = tồn hiện tại × giá vốn lô (FIFO)
                'stock_value' => $this->stockValue($branchId),
                // Gói 55 p11ag: false = chưa có số kiểm kê nào → số liệu chỉ là ước tính
                'has_stocktake' => $hasAnyStocktake,
                // Chỉ số 360 đợt 1: turnover (KHO-1) · avt (KHO-2) ·
                // dead_stock (KHO-3) · price_variance (KHO-4a) ·
                // quick_stocktake (danh sách kiểm kê nhanh tuần §6).
                'turnover' => $inv360['turnover'],
                'avt' => $inv360['avt'],
                'dead_stock' => $inv360['dead_stock'],
                'price_variance' => $inv360['price_variance'],
                'quick_stocktake' => $inv360['quick_stocktake'],
                // Chỉ số 360 đợt 2 (N-1): KHO-4b giao đủ/đúng hẹn của NCC.
                'supplier_delivery' => $inv360['supplier_delivery'],
            ],
        ]);
    }

    /**
     * KHO-4b (360 đợt 2, N-1): giao đủ/đúng hẹn của NCC — Phụ lục khóa:
     * - Mẫu: phiếu đặt đã ordered/received, order_date trong kỳ, theo CN xem.
     * - Đủ lượng theo phiếu = Σ nhận ÷ Σ đặt (quy đổi về đơn vị cơ sở
     *   của từng NL, chỉ phiếu nhập confirmed), cap 100%.
     * - Đúng hẹn: phiếu nhập confirmed ĐẦU TIÊN (id nhỏ nhất) có
     *   receipt_date <= expected_date.
     * - Phiếu chưa có expected_date → "chưa có hẹn giao"; có hẹn mà chưa
     *   nhận → "chưa nhận": loại khỏi mẫu đúng hẹn, đếm riêng (không hồi tố).
     */
    private function supplierDeliveryMetrics(Carbon $from, Carbon $to, int $branchId): array
    {
        $pos = PurchaseOrder::with(['items.material.units'])
            ->whereIn('status', ['ordered', 'received'])
            ->whereBetween('order_date', [$from->toDateString(), $to->toDateString()]);
        if ($branchId > 0) $pos->where('branch_id', $branchId);
        $pos = $pos->orderBy('id')->get();

        // Lượng đã nhận (quy về đơn vị cơ sở) theo phiếu × NL, chỉ phiếu nhập confirmed.
        $received = [];
        $firstReceipt = [];
        if ($pos->isNotEmpty()) {
            $poIds = $pos->pluck('id')->all();
            foreach (InboundReceiptItem::query()
                ->join('inbound_receipts', 'inbound_receipts.id', '=', 'inbound_receipt_items.inbound_receipt_id')
                ->whereIn('inbound_receipts.purchase_order_id', $poIds)
                ->where('inbound_receipts.status', 'confirmed')
                ->select('inbound_receipts.purchase_order_id', 'inbound_receipt_items.material_id',
                    DB::raw('SUM(inbound_receipt_items.purchase_quantity * COALESCE(inbound_receipt_items.conversion_rate, 1)) AS q'))
                ->groupBy('inbound_receipts.purchase_order_id', 'inbound_receipt_items.material_id')
                ->get() as $r) {
                $received[(int) $r->purchase_order_id][(int) $r->material_id] = (float) $r->q;
            }
            // Phiếu nhập confirmed đầu tiên của mỗi phiếu đặt.
            $firsts = DB::table('inbound_receipts')
                ->whereIn('purchase_order_id', $poIds)
                ->where('status', 'confirmed')
                ->select('purchase_order_id', DB::raw('MIN(id) AS rid'))
                ->groupBy('purchase_order_id')->get();
            $byId = DB::table('inbound_receipts')->whereIn('id', $firsts->pluck('rid')->all())
                ->select('id', 'purchase_order_id', 'receipt_date')->get()->keyBy('id');
            foreach ($firsts as $f) {
                $r = $byId[(int) $f->rid] ?? null;
                if ($r) $firstReceipt[(int) $r->purchase_order_id] = (string) $r->receipt_date;
            }
        }
        $rate = function ($material, string $unitName): float {
            if ($unitName === $material->unit) return 1.0;
            $mu = $material->units->firstWhere('unit_name', $unitName);
            return $mu ? (float) $mu->conversion_rate : 1.0;
        };

        $total = $pos->count();
        $noExpected = 0; $notReceived = 0; $onTime = 0; $late = 0;
        $withExpected = 0; $fulSum = 0.0; $fulCount = 0;
        foreach ($pos as $po) {
            if (!$po->expected_date) { $noExpected++; continue; }
            $first = $firstReceipt[$po->id] ?? null;
            if (!$first) { $notReceived++; continue; }
            $withExpected++;
            $isOnTime = substr($first, 0, 10) <= $po->expected_date->toDateString();
            if ($isOnTime) $onTime++; else $late++;
            $orderedBase = 0.0; $receivedBase = 0.0;
            $orderedMats = [];
            foreach ($po->items as $item) {
                $material = $item->material;
                if (!$material) continue;
                $orderedBase += (float) $item->quantity * $rate($material, $item->unit_name);
                $orderedMats[(int) $item->material_id] = true;
            }
            foreach ($received[$po->id] ?? [] as $mid => $q) {
                if (isset($orderedMats[$mid])) $receivedBase += $q;
            }
            if ($orderedBase > 0) {
                $fulSum += min(1.0, $receivedBase / $orderedBase);
                $fulCount++;
            }
        }
        return [
            'total_pos' => $total,
            'total_with_expected' => $withExpected,
            'on_time_count' => $onTime,
            'late_count' => $late,
            'on_time_rate' => $withExpected > 0 ? $this->r2($onTime / $withExpected * 100) : null,
            'avg_fulfillment_pct' => $fulCount > 0 ? $this->r2($fulSum / $fulCount * 100) : null,
            'no_expected_count' => $noExpected,
            'not_received_count' => $notReceived,
            'basis' => 'ngày phát sinh (order_date)',
        ];
    }

    /** Giá vốn bình quân theo nguyên liệu: trọng số theo tồn lô hiện tại,
     *  dự phòng giá lô nhập gần nhất. Trả map material_id => unit_cost. */
    private function avgMaterialCosts(): array
    {
        $out = [];
        $weighted = DB::table('batches')
            ->where('current_quantity', '>', 0)
            ->select('material_id', DB::raw('SUM(current_quantity * unit_cost) / NULLIF(SUM(current_quantity), 0) AS c'))
            ->groupBy('material_id')->pluck('c', 'material_id');
        foreach ($weighted as $mid => $c) {
            $out[(int) $mid] = (float) $c;
        }
        $latest = DB::table('batches')->orderByDesc('id')
            ->select('material_id', 'unit_cost')->get();
        foreach ($latest as $b) {
            if (!isset($out[(int) $b->material_id])) {
                $out[(int) $b->material_id] = (float) $b->unit_cost;
            }
        }
        return $out;
    }

    /**
     * Khối chỉ số kho 360 (đợt 1) cho trang Kho chi tiết:
     * - KHO-1 vòng quay + ngày tồn (tồn đầu kỳ suy ngược từ stock_movements
     *   như waste(); kỳ xa hơn lịch sử movements → data_ok=false).
     * - KHO-2 AvT điểm %: food cost THỰC TẾ (NL có số kiểm kê trong kỳ:
     *   đầu + nhập − cuối đếm được) trừ food cost LÝ THUYẾT (BOM). NL
     *   ngoài danh sách kiểm kê ở nhịp tuần giữ cờ ước tính (§6.2.3).
     * - KHO-3 hàng chết/chậm: không phát sinh XUẤT dùng quá ngưỡng ngày
     *   (settings: cảnh báo 30 · chết 45 cho hàng có hạn dùng).
     * - KHO-4a biến động giá nhập: giá BQ gia quyền theo NL × NCC + lệch
     *   % 2 lần nhập liên tiếp gần nhất.
     * - §6 danh sách kiểm kê nhanh: top NL theo (giá trị tồn × tốc độ
     *   tiêu thụ), giới hạn cấu hình được (mặc định 15/CN).
     */
    private function inventoryMetrics(array $cur, array $wasteRows, int $branchId, string $period): array
    {
        $from = $cur['from'];
        $to = $cur['to'];
        // F-360-4: số ngày của kỳ phải là số ngày LỊCH nguyên — Carbon 3
        // diffInDays trả float (01/11 00:00 → 30/11 23:59:59 = 29,9999…)
        // khiến +1 thành 31,0 cho tháng 30 ngày (số ngày tồn kho lệch
        // +3,3%). Cắt về startOfDay hai đầu + ép int trước khi +1.
        $days = max(1, (int) $from->copy()->startOfDay()->diffInDays($to->copy()->startOfDay()) + 1);
        $avgCost = $this->avgMaterialCosts();
        $matNames = DB::table('materials')->pluck('name', 'id');

        // Tồn hiện tại theo NL (lượng + giá trị)
        $stockQ = DB::table('batches')->where('current_quantity', '>', 0);
        if ($branchId > 0) $stockQ->where('branch_id', $branchId);
        $stockQty = [];
        foreach ($stockQ->select('material_id', DB::raw('SUM(current_quantity) AS q'))->groupBy('material_id')->get() as $r) {
            $stockQty[(int) $r->material_id] = (float) $r->q;
        }
        $closingValue = 0.0;
        foreach ($stockQty as $mid => $q) {
            $closingValue += $q * ($avgCost[$mid] ?? 0);
        }

        // Tồn đầu kỳ suy ngược: tồn hiện tại + net biến động từ đầu kỳ
        // (stock_movements: xuất = dương, nhập = âm — cùng quy ước waste()).
        $netMove = [];
        $historyFrom = null;
        if (Schema::hasTable('stock_movements')) {
            $mq = DB::table('stock_movements')->where('created_at', '>=', $from->toDateTimeString());
            if ($branchId > 0) $mq->where('branch_id', $branchId);
            foreach ($mq->select('material_id', DB::raw('SUM(quantity) AS q'))->groupBy('material_id')->get() as $r) {
                $netMove[(int) $r->material_id] = (float) $r->q;
            }
            $historyFrom = DB::table('stock_movements')->min('created_at');
        }
        $openingValue = 0.0;
        foreach ($stockQty as $mid => $q) {
            $openingValue += ($q + ($netMove[$mid] ?? 0.0)) * ($avgCost[$mid] ?? 0);
        }
        $dataOk = $historyFrom === null || $from->toDateTimeString() >= (string) $historyFrom;
        $cogs = $this->bomCost($cur);
        $avgStock = ($openingValue + $closingValue) / 2;
        $turnover = [
            'data_ok' => $dataOk,
            'cogs' => $this->r2($cogs),
            'opening_value' => $this->r2($openingValue),
            'closing_value' => $this->r2($closingValue),
            'avg_value' => $this->r2($avgStock),
            'turnover' => ($dataOk && $avgStock > 0) ? $this->r2($cogs / $avgStock) : null,
            'days' => ($dataOk && $cogs > 0) ? $this->r2($avgStock / ($cogs / $days)) : null,
            'note' => $dataOk ? null : 'Kỳ bắt đầu trước lịch sử biến động kho — chưa đủ dữ kiện tính tồn đầu kỳ.',
        ];

        // KHO-2 AvT: lý thuyết từ BOM; thực tế chỉ trên NL có số kiểm kê
        // TRONG kỳ (stocktake_date thuộc kỳ — waste() đã gắn).
        $netRevenue = max(0, (float) $cur['gross'] - (float) $cur['vat']);
        $theoreticalPct = $netRevenue > 0 ? $cogs / $netRevenue * 100 : null;
        $actualValue = 0.0;
        $countedMats = 0;
        $bomMats = 0;
        $diffRows = [];
        foreach ($wasteRows as $w) {
            $mid = (int) $w['material_id'];
            if (($w['bom_qty'] ?? 0) <= 0) continue;
            $bomMats++;
            $cost = $avgCost[$mid] ?? 0;
            $diffRows[] = [
                'material_id' => $mid,
                'material' => $w['material'],
                'diff_qty' => $w['diff'],
                'diff_value' => $this->r2(((float) $w['diff']) * $cost),
                'is_estimate' => (bool) $w['is_estimate'],
            ];
            $inPeriod = $w['stocktake_date'] !== null
                && $w['stocktake_date'] >= $from->toDateTimeString()
                && $w['stocktake_date'] <= $to->toDateTimeString();
            if ($inPeriod && $w['opening_qty'] !== null && $w['actual_qty'] !== null) {
                $countedMats++;
                $actualValue += max(0, ((float) $w['opening_qty'] + (float) $w['inbound_qty'] - (float) $w['actual_qty'])) * $cost;
            }
        }
        usort($diffRows, fn($a, $b) => abs($b['diff_value']) <=> abs($a['diff_value']));
        $actualPct = ($countedMats > 0 && $netRevenue > 0) ? $actualValue / $netRevenue * 100 : null;
        $avt = [
            'theoretical_pct' => $theoreticalPct === null ? null : $this->r2($theoreticalPct),
            'actual_pct' => $actualPct === null ? null : $this->r2($actualPct),
            'avt_points' => ($actualPct !== null && $theoreticalPct !== null) ? $this->r2($actualPct - $theoreticalPct) : null,
            'is_estimate' => $countedMats === 0 || $countedMats < $bomMats,
            'counted_materials' => $countedMats,
            'total_materials' => $bomMats,
            'top_diffs' => array_slice($diffRows, 0, 5),
        ];

        // KHO-3 hàng chết / chậm luân chuyển
        $warnDays = (int) Setting::get('dead_stock_warn_days', 30);
        $deadDays = (int) Setting::get('dead_stock_dead_days', 45);
        $lastOut = [];
        if (Schema::hasTable('stock_movements')) {
            $oq = DB::table('stock_movements')->where('quantity', '>', 0);
            if ($branchId > 0) $oq->where('branch_id', $branchId);
            foreach ($oq->select('material_id', DB::raw('MAX(created_at) AS last_at'))->groupBy('material_id')->get() as $r) {
                $lastOut[(int) $r->material_id] = $r->last_at;
            }
        }
        $expiryMats = DB::table('batches')->whereNotNull('expired_at')->distinct()->pluck('material_id')
            ->map(fn($v) => (int) $v)->flip()->all();
        $today = Carbon::now('Asia/Ho_Chi_Minh')->startOfDay();
        $deadItems = [];
        $deadValue = 0.0;
        foreach ($stockQty as $mid => $q) {
            $last = $lastOut[$mid] ?? null;
            $since = $last !== null
                ? (int) Carbon::parse($last)->startOfDay()->diffInDays($today, false)
                : 9999;
            if ($since < $warnDays) continue;
            $val = $q * ($avgCost[$mid] ?? 0);
            $isDead = $since >= $deadDays && isset($expiryMats[$mid]);
            $deadItems[] = [
                'material_id' => $mid,
                'material' => $matNames[$mid] ?? ('Nguyên liệu #' . $mid),
                'qty' => $this->r2($q),
                'value' => $this->r2($val),
                'days_since_out' => $since >= 9999 ? null : $since,
                'status' => $isDead ? 'dead' : 'slow',
            ];
            $deadValue += $val;
        }
        usort($deadItems, fn($a, $b) => $b['value'] <=> $a['value']);
        $deadStock = [
            'warn_days' => $warnDays,
            'dead_days' => $deadDays,
            'items' => $deadItems,
            'total_value' => $this->r2($deadValue),
            'pct_of_stock' => $closingValue > 0 ? $this->r2($deadValue / $closingValue * 100) : 0,
        ];

        // KHO-4a biến động giá nhập: theo NL (× NCC khi nối được phiếu nhập)
        $partnerByBatch = [];
        if (Schema::hasTable('inbound_receipt_items') && Schema::hasColumn('inbound_receipt_items', 'batch_id')) {
            $partnerByBatch = DB::table('inbound_receipt_items')
                ->join('inbound_receipts', 'inbound_receipts.id', '=', 'inbound_receipt_items.inbound_receipt_id')
                ->whereNotNull('inbound_receipt_items.batch_id')
                ->pluck('inbound_receipts.partner_id', 'inbound_receipt_items.batch_id')
                ->map(fn($v) => $v === null ? null : (int) $v)->all();
        }
        $partnerNames = Schema::hasTable('partners') ? DB::table('partners')->pluck('name', 'id') : collect();
        $lotGroups = [];
        $bq = DB::table('batches')->where('initial_quantity', '>', 0)
            ->orderBy('material_id')->orderBy('created_at');
        if ($branchId > 0) $bq->where('branch_id', $branchId);
        foreach ($bq->select('id', 'material_id', 'initial_quantity', 'unit_cost', 'created_at')->get() as $b) {
            $pid = $partnerByBatch[(int) $b->id] ?? null;
            $k = $b->material_id . '|' . ($pid ?? 'x');
            $lotGroups[$k]['material_id'] = (int) $b->material_id;
            $lotGroups[$k]['partner_id'] = $pid;
            $lotGroups[$k]['lots'][] = ['qty' => (float) $b->initial_quantity, 'cost' => (float) $b->unit_cost, 'at' => $b->created_at];
        }
        $variance = [];
        foreach ($lotGroups as $g) {
            $lots = $g['lots'];
            $tq = array_sum(array_column($lots, 'qty'));
            $wavg = $tq > 0 ? array_sum(array_map(fn($l) => $l['qty'] * $l['cost'], $lots)) / $tq : 0;
            $lastChange = null;
            if (count($lots) >= 2) {
                $prev = $lots[count($lots) - 2]['cost'];
                $last = $lots[count($lots) - 1]['cost'];
                $lastChange = $prev > 0 ? $this->r2(($last - $prev) / $prev * 100) : null;
            }
            $variance[] = [
                'material_id' => $g['material_id'],
                'material' => $matNames[$g['material_id']] ?? ('Nguyên liệu #' . $g['material_id']),
                'partner_id' => $g['partner_id'],
                'partner' => $g['partner_id'] !== null ? ($partnerNames[$g['partner_id']] ?? ('NCC #' . $g['partner_id'])) : null,
                'weighted_avg_cost' => $this->r2($wavg),
                'lots' => count($lots),
                'last_change_pct' => $lastChange,
            ];
        }
        usort($variance, fn($a, $b) => abs($b['last_change_pct'] ?? 0) <=> abs($a['last_change_pct'] ?? 0));

        // §6: danh sách kiểm kê nhanh của tuần — top NL theo (giá trị tồn
        // × tốc độ tiêu thụ). branchId=0 → sinh riêng từng CN.
        $limit = max(1, (int) Setting::get('quick_stocktake_limit', 15));
        $branches = $branchId > 0
            ? [$branchId]
            : Branch::where('is_active', true)->pluck('id')->map(fn($v) => (int) $v)->all();
        // F-360-5: tốc độ tiêu thụ tính THEO TỪNG CN từ dữ kiện XUẤT DÙNG
        // của chính CN đó (stock_movements xuất = số dương, cùng quy ước
        // waste()) trong kỳ — bản cũ lấy dòng waste của phạm vi đang xem
        // (toàn hệ khi xem tất cả CN, lại rất thưa: tháng 11 chỉ 1 NL có
        // dữ kiện) dùng chung cho mọi CN.
        $consByBranch = [];
        if (Schema::hasTable('stock_movements')) {
            $cq = DB::table('stock_movements')
                ->where('quantity', '>', 0)
                ->whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()])
                ->select('branch_id', 'material_id', DB::raw('SUM(quantity) AS q'))
                ->groupBy('branch_id', 'material_id');
            foreach ($cq->get() as $r) {
                $consByBranch[(int) $r->branch_id][(int) $r->material_id] = (float) $r->q;
            }
        }
        $quickLists = [];
        foreach ($branches as $bid) {
            $bStockQ = DB::table('batches')->where('current_quantity', '>', 0)->where('branch_id', $bid);
            $bQty = [];
            foreach ($bStockQ->select('material_id', DB::raw('SUM(current_quantity) AS q'))->groupBy('material_id')->get() as $r) {
                $bQty[(int) $r->material_id] = (float) $r->q;
            }
            $consByMat = $consByBranch[$bid] ?? [];
            $scored = [];
            foreach ($bQty as $mid => $q) {
                $val = $q * ($avgCost[$mid] ?? 0);
                $cons = (float) ($consByMat[$mid] ?? 0);
                $speed = $days > 0 ? $cons / $days : 0;
                $scored[] = [
                    'material_id' => $mid,
                    'material' => $matNames[$mid] ?? ('Nguyên liệu #' . $mid),
                    'stock_qty' => $this->r2($q),
                    'stock_value' => $this->r2($val),
                    'consumption_qty' => $this->r2($cons),
                    '_score' => $val * $speed,
                ];
            }
            // Thứ tự xác định tuyệt đối: điểm giảm dần → NL chưa có dữ kiện
            // tiêu thụ (điểm 0) xếp theo GIÁ TRỊ TỒN giảm dần → material_id
            // tăng dần. Không còn suất nào xếp tùy ý.
            usort($scored, function ($a, $b) {
                if ($a['_score'] !== $b['_score']) return $b['_score'] <=> $a['_score'];
                if ($a['stock_value'] !== $b['stock_value']) return $b['stock_value'] <=> $a['stock_value'];
                return $a['material_id'] <=> $b['material_id'];
            });
            $scored = array_map(function ($r) { unset($r['_score']); return $r; }, array_slice($scored, 0, $limit));
            // CN đã có phiếu kiểm kê nhanh chốt trong kỳ chưa
            $hasQuick = DB::table('stocktakes')
                ->where('branch_id', $bid)->where('type', 'quick_weekly')->where('status', 'confirmed')
                ->whereBetween('checked_at', [$from->toDateTimeString(), $to->toDateTimeString()])
                ->exists();
            $quickLists[] = [
                'branch_id' => $bid,
                'branch_name' => Branch::find($bid)->name ?? ('CN #' . $bid),
                'limit' => $limit,
                'counted_in_period' => $hasQuick,
                'items' => $scored,
            ];
        }

        return [
            'turnover' => $turnover,
            'avt' => $avt,
            'dead_stock' => $deadStock,
            'price_variance' => $variance,
            'quick_stocktake' => ['limit' => $limit, 'lists' => $quickLists],
            // KHO-4b (đợt 2, N-1): giao đủ/đúng hẹn của NCC.
            'supplier_delivery' => $this->supplierDeliveryMetrics($from, $to, $branchId),
        ];
    }

    // Spec P4-C3: giá trị tồn kho theo nhóm NL/BTP/chi nhánh (tồn × giá vốn lô)
    private function stockValue(int $branchId): array
    {
        $btpIds = \App\Models\ProductionRecipe::distinct()->pluck('material_id')->all();
        $rows = \App\Models\Batch::with('material:id,name')
            ->where('status', 'active')->where('current_quantity', '>', 0)
            ->when($branchId > 0, fn ($q) => $q->where('branch_id', $branchId))
            ->get();
        $byGroup = ['raw' => 0.0, 'btp' => 0.0];
        $byBranch = [];
        foreach ($rows as $b) {
            $val = (float) $b->current_quantity * (float) ($b->unit_cost ?? 0);
            $isBtp = in_array($b->material_id, $btpIds, true);
            $byGroup[$isBtp ? 'btp' : 'raw'] += $val;
            $bid = (int) $b->branch_id;
            $byBranch[$bid] = ($byBranch[$bid] ?? 0) + $val;
        }
        $branchNames = Branch::whereIn('id', array_keys($byBranch))->pluck('name', 'id');
        arsort($byBranch);
        return [
            'total' => round(array_sum($byGroup), 0),
            'by_group' => [
                ['key' => 'raw', 'name' => 'Nguyên liệu thô', 'value' => round($byGroup['raw'], 0)],
                ['key' => 'btp', 'name' => 'Bán thành phẩm', 'value' => round($byGroup['btp'], 0)],
            ],
            'by_branch' => array_map(
                fn ($bid, $v) => ['branch_id' => $bid, 'branch_name' => $branchNames[$bid] ?? ('#' . $bid), 'value' => round($v, 0)],
                array_keys($byBranch), array_values($byBranch)
            ),
        ];
    }

    // Spec P4-C6: báo cáo nhân sự tổng hợp — giờ công, lương thực nhận theo NV/CN/kỳ;
    // top NV giờ cao; cảnh báo NV vượt giờ (ngưỡng cấu hình được, mặc định 200h/tháng)
    // GET /api/reports/hr-summary?month=YYYY-MM&branch_id=
    public function hrSummary(Request $request): JsonResponse
    {
        $month = $request->query('month', Carbon::now()->format('Y-m'));
        if (!preg_match('/^\\d{4}-\\d{2}$/', $month)) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ.'], 422);
        }
        if ($deny = $this->guardReportBranch($request)) return $deny;
        $branchId = (int) $request->query('branch_id', 0);
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        $end = $start->copy()->endOfMonth();
        $overHours = (float) \App\Models\Setting::get('hr_over_hours_threshold', 200);

        $days = \App\Models\SalaryDay::whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->when($branchId > 0, fn ($q) => $q->where('branch_id', $branchId))
            ->selectRaw('employee_id, branch_id, SUM(hours) as hours, COUNT(DISTINCT date) as workdays')
            ->groupBy('employee_id', 'branch_id')->get();

        // Lát 2j (2026-11-04): giờ công chỉ chảy vào bảng lương qua bước "Đổ giờ
        // công" (thiết kế 2 bước) — tháng chưa đổ thì SalaryDay rỗng và tab hiện
        // 0h/0 NV dù đã có chấm công. Khi SalaryDay trống HẲN, tạm tính từ chấm
        // công (cùng nguồn với tab Vận hành) và ghi rõ nguồn để giao diện chú
        // thích; SalaryDay có dữ liệu thì vẫn là nguồn chuẩn, không đổi.
        $hoursSource = 'salary_days';
        if ($days->isEmpty()) {
            $att = DB::table('attendances')
                ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
                ->whereNotNull('check_in')->whereNotNull('check_out')
                ->when($branchId > 0, fn ($q) => $q->where('branch_id', $branchId))
                ->selectRaw('employee_id, branch_id, SUM(TIMESTAMPDIFF(MINUTE, check_in, check_out)) / 60 as hours, COUNT(DISTINCT date) as workdays')
                ->groupBy('employee_id', 'branch_id')->get();
            if ($att->isNotEmpty()) {
                $days = $att;
                $hoursSource = 'attendance';
            }
        }

        $empIds = $days->pluck('employee_id')->unique()->all();
        $emps = \App\Models\Employee::with('branch:id,name')->whereIn('id', $empIds)->get()->keyBy('id');

        // Lương thực nhận: dùng số chốt nếu có, không thì ước tính từ controller lương
        // §3.8: cờ khóa theo (tháng × CN đang xem) — khóa CN khác không làm
        // CN này hiện "đã chốt". Góc toàn hệ chỉ hiện "đã chốt" khi còn khóa
        // toàn hệ đời trước HOẶC mọi CN đang hoạt động đều đã chốt; chốt rời
        // rạc 1 CN thì locked = false + locked_branches liệt kê CN đã chốt.
        if ($branchId > 0) {
            $locked = \App\Models\PayrollLock::isLocked($month, (int) $branchId);
            $lockedBranches = $locked ? [(int) $branchId] : [];
        } else {
            $lockedBranches = \App\Models\PayrollLock::lockedBranchIds($month);
            if (in_array(null, $lockedBranches, true)) {
                $lockedBranches = \App\Models\Branch::where('is_active', true)
                    ->pluck('id')->map(fn ($v) => (int) $v)->all();
            }
            $activeBranches = \App\Models\Branch::where('is_active', true)
                ->pluck('id')->map(fn ($v) => (int) $v)->all();
            $locked = \App\Models\PayrollLock::legacy($month) !== null
                || ($activeBranches !== [] && count(array_diff($activeBranches, $lockedBranches)) === 0);
        }
        $netMap = [];
        if ($locked) {
            [$rows] = (new \App\Http\Controllers\Api\SalaryController())->buildPayrollData($month, $branchId ?: null);
            foreach ($rows as $r) {
                $netMap[$r['employee_id']] = ($netMap[$r['employee_id']] ?? 0) + $r['net'];
            }
        }

        $rows = [];
        foreach ($days as $d) {
            $emp = $emps->get($d->employee_id);
            if (!$emp) continue;
            $hours = (float) $d->hours;
            $rows[] = [
                'employee_id' => $d->employee_id,
                'full_name' => $emp->full_name,
                'branch_name' => $emp->branch?->name ?? '',
                'hours' => round($hours, 1),
                'workdays' => (int) $d->workdays,
                'net' => isset($netMap[$d->employee_id]) ? (int) $netMap[$d->employee_id] : null,
                'over_hours' => $hours > $overHours,
            ];
        }
        usort($rows, fn ($a, $b) => $b['hours'] <=> $a['hours']);

        return response()->json(['success' => true, 'data' => [
            'month' => $month,
            'locked' => (bool) $locked,
            'locked_branches' => $lockedBranches, // §3.8: CN nào đã chốt trong kỳ (góc toàn hệ)
            'over_hours_threshold' => $overHours,
            'rows' => $rows,
            'top_hours' => array_slice($rows, 0, 5),
            'warnings' => array_values(array_filter($rows, fn ($r) => $r['over_hours'])),
            'total_hours' => round(array_sum(array_column($rows, 'hours')), 1),
            'total_net' => array_sum(array_filter(array_column($rows, 'net'), fn ($v) => $v !== null)),
            'hours_source' => $hoursSource, // Lát 2j: 'salary_days' | 'attendance' (tạm tính)
        ]]);
    }

    // Spec P4-C5: tổng hợp thu/chi theo danh mục + kỳ (ngày/tuần/tháng) + cơ cấu
    // GET /api/reports/cash-summary?branch_id=&period=&date=
    public function cashSummary(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        if ($deny = $this->guardReportBranch($request)) return $deny;
        $branchId = (int) $request->query('branch_id', 0);
        $period = $request->query('period', 'month');
        if (!in_array($period, ['day', 'week', 'month'], true)) $period = 'month';
        try {
            $anchor = $request->query('date')
                ? Carbon::parse($request->query('date'), $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $anchor = Carbon::now($tz)->startOfDay();
        }
        [$from, $to] = $this->window($period, $anchor);

        $txs = Transaction::with('category:id,name')
            ->where('status', 'paid')
            ->whereNull('rejected_at') // Gói "Chờ duyệt trên Hub" (2026-10-21): phiếu bị từ chối không tính vào báo cáo
            // Lát 2j (2026-11-04): cùng cơ số TIỀN HIỆU LỰC với trang Thu-Chi
            // (lát 1c) — trước đây tính cả phiếu đang chờ duyệt.
            ->where(fn($w) => $w->where(fn($a) => $a->whereNotNull('approved_by')->orWhereNotNull('approved_by_employee_id'))
                ->orWhereIn('related_type', ['inbound_receipt', 'batch']))
            ->whereBetween('occurred_at', [$from->toDateString(), $to->toDateString()])
            ->when($branchId > 0, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['id', 'type', 'category_id', 'amount', 'occurred_at']);

        // Theo danh mục
        $byCat = [];
        foreach ($txs as $t) {
            $k = $t->type . '|' . ($t->category?->name ?? 'Khác');
            if (!isset($byCat[$k])) $byCat[$k] = ['type' => $t->type, 'name' => $t->category?->name ?? 'Khác', 'value' => 0];
            $byCat[$k]['value'] += (float) $t->amount;
        }
        $byCat = array_values($byCat);
        usort($byCat, fn ($a, $b) => $b['value'] <=> $a['value']);
        $totIn = array_sum(array_column(array_filter($byCat, fn ($x) => $x['type'] === 'income'), 'value'));
        $totOut = array_sum(array_column(array_filter($byCat, fn ($x) => $x['type'] === 'expense'), 'value'));

        // Theo kỳ (bucket ngày)
        $buckets = [];
        $d = $from->copy();
        while ($d->lte($to)) {
            $key = $d->toDateString();
            $buckets[$key] = ['label' => $d->format('d/m'), 'income' => 0, 'expense' => 0];
            $d->addDay();
        }
        foreach ($txs as $t) {
            $key = Carbon::parse($t->occurred_at)->toDateString();
            if (isset($buckets[$key])) $buckets[$key][$t->type] += (float) $t->amount;
        }

        // TC-2 (chỉ số 360 đợt 1): dòng tiền vận hành theo cơ số NGÀY
        // HIỆU LỰC TIỀN (paid_at) — khác cơ số ngày phát sinh (occurred_at)
        // của sổ chi tiết ở trên; nhãn cơ số hiện rõ ở FE (rủi ro #2).
        $cfQ = Transaction::query()
            ->where('status', 'paid')->whereNull('rejected_at')
            ->whereBetween('paid_at', [$from->copy()->startOfDay()->toDateTimeString(), $to->copy()->endOfDay()->toDateTimeString()]);
        if ($branchId > 0) {
            $cfQ->where('branch_id', $branchId);
        }
        $cfIn = (float) (clone $cfQ)->where('type', 'income')->sum('amount');
        $cfOut = (float) (clone $cfQ)->where('type', 'expense')->sum('amount');
        // Tiền thực thu sàn — cơ số TẠM theo phán của ngài (2026-11-15):
        // hệ chưa có dữ kiện tiền sàn trả thật (nạp file sàn N-7 hoãn sang
        // giai đoạn sau) nên thực thu ƯỚC TÍNH theo mô hình % dùng ĐÚNG
        // các thành phần BH-1 đã tính ở channels() cho cùng kỳ:
        //   thực thu ≈ doanh thu kênh − chiết khấu % cấu hình kênh
        //              − giảm giá quán chịu − phí marketing nhập tay.
        // Số mang nhãn ƯỚC TÍNH (§0.3); khi N-7 chạy, số file sàn thắng.
        // Kênh nào chưa có phí marketing (kỳ chưa trọn tháng đối soát —
        // §0.4) thì estimated_received = null + cờ incomplete, không
        // tính thiếu như đã đủ. Cơ số thuế: gồm thuế (taxRatio 1.0) —
        // khớp payload BH-1 mặc định ở tab Doanh thu/PNL.
        $vatRate = (float) Setting::get('default_tax_rate', 8);
        $curPeriod = $this->buildPeriod($branchId, $from->copy()->startOfDay(), $to->copy()->endOfDay(), $vatRate, $tz);
        $mktTc2 = $this->marketingAdjustments($from, $to, $branchId);
        $channelRows = $this->channels($curPeriod, ['channels' => [], 'gross' => 0, 'items' => []], 1.0, $mktTc2);
        $platformChannels = [];
        $estimatedTotal = 0.0;
        $hasIncomplete = false;
        foreach ($channelRows as $row) {
            if (($row['category'] ?? null) !== 'partner') continue;
            $incomplete = (bool) ($row['burden_incomplete'] ?? true);
            $estimated = null;
            if (!$incomplete) {
                $estimated = $this->r2((float) $row['value'] - (float) $row['commission']
                    - (float) $row['discount'] - (float) ($row['marketing_fee'] ?? 0));
                $estimatedTotal += $estimated;
            } else {
                $hasIncomplete = true;
            }
            $platformChannels[] = [
                'key' => $row['key'],
                'name' => $row['name'],
                'revenue' => $row['value'],
                'commission' => $row['commission'],
                'discount' => $row['discount'],
                'marketing_fee' => $incomplete ? null : ($row['marketing_fee'] ?? 0),
                'estimated_received' => $estimated,
                'incomplete' => $incomplete,
            ];
        }
        $tc2 = [
            'basis' => 'paid_at',
            'cash_in' => $this->r2($cfIn),
            'cash_out' => $this->r2($cfOut),
            'net' => $this->r2($cfIn - $cfOut),
            'platform_receivable' => [
                'status' => 'estimate_percent_model',
                'is_estimate' => true,
                'channels' => $platformChannels,
                'estimated_received' => $this->r2($estimatedTotal),
                'has_incomplete' => $hasIncomplete,
                'note' => 'Thực thu sàn là số ƯỚC TÍNH theo mô hình % (doanh thu − chiết khấu cấu hình − giảm giá quán chịu − phí marketing nhập tay, cùng thành phần BH-1) — chưa phải số sàn trả thật. Khi nạp file sàn (N-7, giai đoạn sau) số thật sẽ thay thế.'
                    . ($period !== 'month' ? ' Vế sàn chỉ tính được ở mức tháng (phí marketing đối soát theo tháng) — kỳ ngày/tuần các kênh sẽ ở trạng thái chưa đủ dữ kiện.' : ''),
            ],
        ];

        return response()->json(['success' => true, 'data' => [
            'from' => $from->toDateString(), 'to' => $to->toDateString(),
            'total_income' => round($totIn), 'total_expense' => round($totOut),
            'net' => round($totIn - $totOut),
            // TC-2 (chỉ số 360 đợt 1).
            'tc2' => $tc2,
            'by_category' => array_map(fn ($x) => $x + ['share' => ($x['type'] === 'income' ? $totIn : $totOut) > 0
                ? round($x['value'] / ($x['type'] === 'income' ? $totIn : $totOut) * 100, 1) : 0], $byCat),
            'buckets' => array_values($buckets),
        ]]);
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
        if ($deny = $this->guardReportBranch($request)) return $deny;
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
            'cancel_reason', 'cancel_reason_code', 'cancelled_at', 'cancelled_by', 'cancelled_by_type', 'created_at'
        )->orderByDesc('cancelled_at')->get();

        // N-2 (360 đợt 2): đơn nguồn bị GỘP không phải hủy — nhận diện bằng
        // text "Gộp vào đơn …", loại khỏi đếm VH-2/CL-2 + by_reason, đếm
        // riêng để tổng đối chiếu được (Phụ lục khóa).
        $isMerged = fn($o) => str_starts_with(trim((string) ($o->cancel_reason ?? '')), 'Gộp vào đơn ');
        $mergedCount = $orders->filter($isMerged)->count();

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
            'cancel_reason_code' => $o->cancel_reason_code,
            'cancel_reason_label' => CancelReasonCodes::label($o->cancel_reason_code),
            'is_merged' => $isMerged($o),
        ])->values()->all();

        // Gói 57: gom đơn hủy theo lý do — N-2 (360 đợt 2): gom theo MÃ
        // nguyên nhân chuẩn; dữ kiện cũ (code NULL) → "chưa phân loại";
        // đơn gộp loại khỏi bảng này (đếm riêng ở merged_count).
        $byReason = [];
        foreach ($orders as $o) {
            if ($isMerged($o)) continue;
            $code = $o->cancel_reason_code ?: 'unclassified';
            if (!isset($byReason[$code])) $byReason[$code] = ['count' => 0, 'total_amount' => 0.0];
            $byReason[$code]['count']++;
            $byReason[$code]['total_amount'] += (float) $o->total_amount;
        }
        $byReasonOut = [];
        foreach ($byReason as $code => $agg) {
            $byReasonOut[] = ['code' => $code, 'reason' => CancelReasonCodes::label($code === 'unclassified' ? null : $code), 'count' => $agg['count'], 'total_amount' => $this->r2($agg['total_amount'])];
        }
        usort($byReasonOut, fn($a, $b) => $b['count'] <=> $a['count']);

        $branchName = $branchId > 0
            ? (Branch::find($branchId)->name ?? ('Chi nhánh #' . $branchId))
            : 'Tất cả chi nhánh';

        // VH-2 (chỉ số 360 đợt 1 — phần lõi): hủy theo PHÍA hủy + chỉ số
        // riêng "đơn đã thu tiền rồi hủy", kèm xu hướng kỳ trước.
        // N-2 (360 đợt 2): mapping phía theo giá trị THẬT (user|employee|
        // customer — nhãn 'staff' cũ không bao giờ khớp nên bỏ); đơn gộp
        // loại khỏi đếm (nhận diện bằng text "Gộp vào đơn …").
        [$cFrom, $cTo] = $this->compareWindow($period, $anchor, 'previous', $request, $tz);
        $sideAgg = function (Carbon $f, Carbon $t) use ($branchId) {
            $qq = Order::query()->whereBetween('created_at', [$f->toDateTimeString(), $t->toDateTimeString()]);
            if ($branchId > 0) $qq->where('branch_id', $branchId);
            $total = (int) (clone $qq)->count();
            $cancelled = (clone $qq)->where('status', 'cancelled')
                ->where(function ($w) {
                    $w->whereNull('cancel_reason')->orWhere('cancel_reason', 'not like', 'Gộp vào đơn %');
                })
                ->get(['payment_status', 'cancelled_by_type', 'total_amount']);
            $bySide = [];
            foreach ($cancelled as $o) {
                // Quán = employee + user (Admin); Khách = customer; còn lại theo giá trị.
                $side = match ($o->cancelled_by_type) {
                    'employee', 'user' => 'shop',
                    'customer' => 'customer',
                    'system' => 'system',
                    default => 'unknown',
                };
                if (!isset($bySide[$side])) $bySide[$side] = ['count' => 0, 'total_amount' => 0.0];
                $bySide[$side]['count']++;
                $bySide[$side]['total_amount'] += (float) $o->total_amount;
            }
            $paidCancelled = $cancelled->filter(fn($o) => in_array($o->payment_status, ['paid', 'refunded'], true))->count();
            return ['total_orders' => $total, 'cancelled' => $cancelled->count(), 'by_side' => $bySide, 'paid_cancelled' => $paidCancelled];
        };
        $curSide = $sideAgg($from, $to);
        $refSide = $sideAgg($cFrom, $cTo);
        $sideLabels = ['customer' => 'Khách hủy', 'shop' => 'Quán hủy', 'system' => 'Hệ thống', 'unknown' => 'Không rõ phía'];
        $bySideOut = [];
        foreach ($curSide['by_side'] as $side => $agg) {
            $bySideOut[] = [
                'side' => $side,
                'label' => $sideLabels[$side] ?? $side,
                'count' => $agg['count'],
                'total_amount' => $this->r2($agg['total_amount']),
                'pct_of_cancelled' => $curSide['cancelled'] > 0 ? $this->r2($agg['count'] / $curSide['cancelled'] * 100) : 0,
            ];
        }
        usort($bySideOut, fn($a, $b) => $b['count'] <=> $a['count']);
        $vh2 = [
            'total_orders' => $curSide['total_orders'],
            'cancel_rate' => $curSide['total_orders'] > 0 ? $this->r2($curSide['cancelled'] / $curSide['total_orders'] * 100) : 0,
            'by_side' => $bySideOut,
            'paid_cancelled' => $curSide['paid_cancelled'],
            'paid_cancelled_pct' => $curSide['total_orders'] > 0 ? $this->r2($curSide['paid_cancelled'] / $curSide['total_orders'] * 100) : 0,
            'prev' => [
                'total_orders' => $refSide['total_orders'],
                'cancelled' => $refSide['cancelled'],
                'cancel_rate' => $refSide['total_orders'] > 0 ? $this->r2($refSide['cancelled'] / $refSide['total_orders'] * 100) : 0,
                'paid_cancelled' => $refSide['paid_cancelled'],
                'paid_cancelled_pct' => $refSide['total_orders'] > 0 ? $this->r2($refSide['paid_cancelled'] / $refSide['total_orders'] * 100) : 0,
            ],
        ];

        // CL-2 (chỉ số 360 đợt 1 — phần tổng hợp): hoàn tác xác nhận thanh
        // toán từ OrderPaymentUndoLog hiện có. Số tiền lấy theo tổng đơn
        // được hoàn tác. N-2 (360 đợt 2): "phía" suy từ MÃ nguyên nhân
        // chuẩn — bỏ hẳn lớp quét từ khóa ở lý do text (đợt 1).
        $cl2 = null;
        if (Schema::hasTable('order_payment_undo_logs')) {
            $logQ = \App\Models\OrderPaymentUndoLog::query()
                ->join('orders', 'orders.id', '=', 'order_payment_undo_logs.order_id')
                ->whereBetween('order_payment_undo_logs.created_at', [$from->toDateTimeString(), $to->toDateTimeString()]);
            if ($branchId > 0) {
                $logQ->where('order_payment_undo_logs.branch_id', $branchId);
            }
            $logs = $logQ->select('order_payment_undo_logs.reason', 'order_payment_undo_logs.reason_code', 'orders.total_amount')->get();
            $byReason = [];
            $byCause = ['shop' => ['count' => 0, 'amount' => 0.0], 'customer' => ['count' => 0, 'amount' => 0.0], 'unknown' => ['count' => 0, 'amount' => 0.0]];
            foreach ($logs as $l) {
                $code = $l->reason_code ?: 'unclassified';
                if (!isset($byReason[$code])) $byReason[$code] = ['count' => 0, 'amount' => 0.0];
                $byReason[$code]['count']++;
                $byReason[$code]['amount'] += (float) $l->total_amount;
                $cause = in_array($l->reason_code, CancelReasonCodes::SHOP_CODES, true)
                    ? 'shop'
                    : ($l->reason_code === CancelReasonCodes::CUSTOMER_CHANGED_MIND ? 'customer' : 'unknown');
                $byCause[$cause]['count']++;
                $byCause[$cause]['amount'] += (float) $l->total_amount;
            }
            $reasonOut = [];
            foreach ($byReason as $code => $agg) {
                $reasonOut[] = ['code' => $code, 'reason' => CancelReasonCodes::label($code === 'unclassified' ? null : $code), 'count' => $agg['count'], 'amount' => $this->r2($agg['amount'])];
            }
            usort($reasonOut, fn($a, $b) => $b['count'] <=> $a['count']);
            $cl2 = [
                'count' => $logs->count(),
                'amount' => $this->r2($logs->sum(fn($l) => (float) $l->total_amount)),
                'by_reason' => $reasonOut,
                'by_cause' => [
                    'shop' => ['label' => 'Hoàn vì lỗi quán', 'count' => $byCause['shop']['count'], 'amount' => $this->r2($byCause['shop']['amount'])],
                    'customer' => ['label' => 'Hoàn phía khách', 'count' => $byCause['customer']['count'], 'amount' => $this->r2($byCause['customer']['amount'])],
                    'unknown' => ['label' => 'Chưa rõ phía', 'count' => $byCause['unknown']['count'], 'amount' => $this->r2($byCause['unknown']['amount'])],
                ],
            ];
        }

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
                'merged_count' => $mergedCount,
                'detail' => $detail,
                // VH-2 + CL-2 (chỉ số 360 đợt 1).
                'vh2' => $vh2,
                'payment_undo' => $cl2,
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
        if ($deny = $this->guardReportBranch($request)) return $deny;
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
        // Gói PNL kênh sàn (2026-10-31): phí marketing sàn của các tháng trọn trong kỳ
        $mkt = $this->marketingAdjustments($from, $to, $branchId);
        $refMkt = $this->marketingAdjustments($cFrom, $cTo, $branchId);
        $disp = fn(float $gross, float $vat): float => $taxIncluded ? $gross : max(0, $gross - $vat);
        $taxRatio = $cur['gross'] > 0 ? $disp($cur['gross'], $cur['vat']) / $cur['gross'] : 1.0;

        $revDisplayed = $disp($cur['gross'], $cur['vat']);
        $refDisplayed = $disp($ref['gross'], $ref['vat']);

        // Gói 55 p11ac: "Thu khác" (phiếu thu tay trong Sổ thu-chi) cộng vào tổng thu PNL
        $otherIncomeOf = function (Carbon $f, Carbon $t) use ($branchId): float {
            return (float) Transaction::query()
                ->where('type', 'income')
                ->where('status', 'paid')
                ->whereNull('rejected_at') // Gói "Chờ duyệt trên Hub" (2026-10-21): phiếu bị từ chối không tính vào báo cáo
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
        // Gói PNL kênh sàn (2026-10-31): phí marketing kênh sàn là chi phí trực
        // tiếp của kỳ — dùng đúng số đã nhập theo đối soát sàn (không nhân hệ
        // số thuế), trừ vào lợi nhuận PNL như mọi chi phí khác.
        if ($mkt['total'] > 0) {
            $costs[] = ['name' => 'Phí marketing kênh sàn', 'value' => $mkt['total'], 'color' => '#E5646E'];
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
            + $this->allocatedExpenses($branchId, $cFrom, $cTo)['total']
            + $refMkt['total']; // PNL kênh sàn: kỳ so sánh cũng trừ marketing của chính kỳ đó

        $profit = $revDisplayed - $costTotal;
        $refProfit = $refDisplayed - $refCostTotal;

        // Gói 57: Net Revenue làm mốc 100% cho % các dòng chi phí.
        // Thống nhất C1 (rà soát chỉ số 2026-11-15): Doanh thu thuần = Gross − VAT
        // — CÙNG định nghĩa với tab Tổng quan (overview). "Thu khác" để riêng
        // đúng bản chất: vẫn cộng vào $revDisplayed nên LỢI NHUẬN không đổi,
        // chỉ không nằm trong Doanh thu thuần nữa.
        $netRevenuePnl = max(0, $cur['gross'] - $cur['vat']);
        $costsOut = array_map(fn($c) => [
            'name' => $c['name'],
            'value' => $this->r2($c['value']),
            'color' => $c['color'],
            'pct' => $netRevenuePnl > 0 ? $this->r2($c['value'] / $netRevenuePnl * 100) : 0,
            // B3 (rà soát 2026-11-15): giữ trường ghi chú của dòng chi phí
            // (vd Lương "Ước tính — chưa chốt lương") — trước đây bị rơi ở
            // bước đóng gói này nên banner cảnh báo phía FE không kích hoạt.
            'note' => $c['note'] ?? null,
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
                'income_channels' => $this->channels($cur, $ref, $taxRatio, $mkt),
                'costs' => $costsOut,
                'commissions' => $commissions,
                // Gói PNL kênh sàn (2026-10-31): chi tiết phí marketing kênh sàn
                'marketing' => [
                    'total' => $this->r2($mkt['total']),
                    'items' => $mkt['items'],
                    'full_months' => $mkt['full_months'],
                    'partial_months' => $mkt['partial_months'],
                    'missing_months' => $mkt['missing_months'],
                ],
                'allocated_expenses' => $allocated['items'],
                'allocated_total' => $this->r2($allocated['total']),
                'cost_total' => $this->r2($costTotal),
                'profit' => $this->r2($profit),
                // Thống nhất cơ số biên (ngài phán 2026-11-15): Biên lợi nhuận PNL
                // cũng tính trên Doanh thu thuần C1 (Gross − VAT, không gồm thu
                // khác) — cùng cơ số với Biên EBITDA + % cơ cấu chi phí.
                'margin' => $netRevenuePnl > 0 ? $this->r2($profit / $netRevenuePnl * 100) : 0,
                'delta_profit' => $this->pct($profit, $refProfit),
                'delta_cost' => $this->pct($costTotal, $refCostTotal),
                'delta_revenue' => $this->pct($revDisplayed, $refDisplayed),
                'groups' => $this->profitGroups($period, $branchId, $from, $to, $vatRate, $tz, $disp, true),
                // Chỉ số 360 đợt 1 — TC-1: khối hòa vốn của tháng chứa
                // ngày neo (định nghĩa khóa tại breakeven()).
                'breakeven' => $this->breakeven($branchId, $anchor),
                // Chỉ số 360 đợt 2 (N-3): mục tiêu doanh thu tháng của kỳ/CN.
                'revenue_target' => $this->revenueTargetFor($branchId, $anchor),
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
        if ($deny = $this->guardReportBranch($request)) return $deny;
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

        // 6. VH-1 (chỉ số 360 đợt 1): phân vị thời gian pha chế p50/p90 +
        // % đơn vượt chuẩn + tỷ lệ phủ mốc. Mẫu = đơn hoàn thành CÓ
        // ready_at; đơn thiếu mốc loại khỏi mẫu và báo số lượng (rủi ro
        // #6). Ngưỡng chuẩn cấu hình được (settings), mặc định 15 phút.
        $prep = null;
        if (Schema::hasColumn('orders', 'ready_at')) {
            $standardMin = (float) Setting::get('prep_standard_minutes', 15);
            $durations = (clone $dayOrders)
                ->where('status', 'completed')
                ->whereNotNull('ready_at')
                ->select(DB::raw('TIMESTAMPDIFF(SECOND, created_at, ready_at) AS secs'))
                ->pluck('secs')
                ->map(fn($s) => (float) $s)
                ->filter(fn($s) => $s >= 0)
                ->sort()
                ->values();
            $sample = $durations->count();
            $percentile = function ($sorted, float $q) {
                $n = $sorted->count();
                if ($n === 0) return null;
                $idx = (int) ceil($q / 100 * $n) - 1;
                return $sorted[max(0, min($n - 1, $idx))];
            };
            $over = $durations->filter(fn($s) => $s > $standardMin * 60)->count();
            $prep = [
                'p50_minutes' => $sample > 0 ? $this->r2($percentile($durations, 50) / 60) : null,
                'p90_minutes' => $sample > 0 ? $this->r2($percentile($durations, 90) / 60) : null,
                'over_standard_pct' => $sample > 0 ? $this->r2($over / $sample * 100) : null,
                'over_count' => $over,
                'standard_minutes' => $standardMin,
                'sample' => $sample,
                'completed' => $completedOrders,
                'missing_marks' => max(0, $completedOrders - $sample),
                'coverage_pct' => $completedOrders > 0 ? $this->r2($sample / $completedOrders * 100) : null,
            ];
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
                // Lát 2j (2026-11-04): khối KPI đầu trang phía giao diện đọc qua
                // 'kpis' — trước đây backend chỉ trả khóa phẳng nên 4 ô đầu trang
                // luôn "—" trong khi cảnh báo bên dưới (đọc khóa phẳng) có số.
                'kpis' => [
                    'avg_prep_minutes' => $avgPrepMinutes,
                    'cancel_rate_pct' => $cancelRate,
                    'orders_per_hour_per_staff' => $ordersPerHourPerStaff,
                    'understaffed_hours' => count(array_filter($hourly, fn($row) => $row['understaffed'])),
                ],
                // VH-1 (chỉ số 360 đợt 1): p50/p90 pha chế + phủ mốc.
                'prep' => $prep,
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
        // Lát 1d (2026-11-04): trang Báo cáo gửi period+date như mọi tab khác —
        // trước đây hàm chỉ đọc from/to nên kỳ chọn trên giao diện bị bỏ qua.
        if ($request->filled('from') && $request->filled('to')) {
            $from = $request->query('from');
            $to = $request->query('to');
        } elseif ($request->filled('period')) {
            $tzMe = 'Asia/Ho_Chi_Minh';
            $period = $request->query('period', 'month');
            if (!in_array($period, ['day', 'week', 'month', 'year'], true)) $period = 'month';
            try {
                $anchor = $request->query('date')
                    ? Carbon::parse($request->query('date'), $tzMe)->startOfDay()
                    : Carbon::now($tzMe)->startOfDay();
            } catch (\Exception $e) {
                $anchor = Carbon::now($tzMe)->startOfDay();
            }
            [$wFrom, $wTo] = $this->window($period, $anchor);
            $from = $wFrom->toDateString();
            $to = $wTo->toDateString();
        } else {
            $from = now()->startOfMonth()->toDateString();
            $to = now()->toDateString();
        }
        if ($deny = $this->guardReportBranch($request)) return $deny;
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

        // Lát 1d (2026-11-04): bổ sung đúng hợp đồng giao diện Gói 58 đang đọc
        // (matrix 4 ô + trường theo ly) — trước đây backend trả tên trường
        // khác hẳn (product_name/qty_sold/quadrant, không có matrix) nên tab
        // hiện tên trống và toàn 0 dù có dữ liệu bán. Giữ nguyên các trường cũ.
        $matrix = ['stars' => [], 'puzzles' => [], 'plowhorses' => [], 'dogs' => []];
        foreach ($items as &$it) {
            $qty = $it['qty_sold'] > 0 ? $it['qty_sold'] : 0;
            $profitPerUnit = $qty > 0 ? $it['gross_profit'] / $qty : 0;
            $it['name'] = $it['product_name'];
            $it['qty'] = $qty;
            $it['price'] = $qty > 0 ? $this->r2($it['revenue'] / $qty) : 0;
            $it['cogs_per_unit'] = $qty > 0 ? $this->r2($it['cogs'] / $qty) : 0;
            $it['cost_pct'] = $it['revenue'] > 0 ? $this->r2($it['cogs'] / $it['revenue'] * 100) : 0;
            $it['profit_per_unit'] = $this->r2($profitPerUnit);
            $it['total_profit'] = $it['gross_profit'];
            $it['category'] = $it['quadrant'];
            $bucket = ['star' => 'stars', 'puzzle' => 'puzzles', 'plowhorse' => 'plowhorses', 'dog' => 'dogs'][$it['quadrant']] ?? 'dogs';
            $matrix[$bucket][] = ['name' => $it['product_name'], 'qty' => $qty, 'profit_per_unit' => $this->r2($profitPerUnit)];
        }
        unset($it);

        // SP-1 (chỉ số 360 đợt 1): Menu Engineering THEO KÊNH — biên đóng
        // góp món sau chiết khấu kênh. Chiết khấu phân bổ theo doanh thu
        // món trong kênh (nhãn "phân bổ ước tính" §0.3); phí marketing
        // KHÔNG phân bổ xuống món (dừng ở sau-chiết-khấu). 2 nhóm chạy
        // ma trận riêng: sàn gộp (partner) · trực tiếp (tại quầy + Zalo).
        $sp1 = ['platform' => [], 'direct' => []];
        $chRows = DB::table('order_items as oi')
            ->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->join('products as p', 'p.id', '=', 'oi.product_id')
            ->where('o.status', '!=', 'cancelled')
            ->where('o.payment_status', 'paid')
            ->whereDate('o.created_at', '>=', $from)
            ->whereDate('o.created_at', '<=', $to)
            ->when($branchId, fn($q) => $q->where('o.branch_id', $branchId))
            ->groupBy('oi.product_id', 'p.name', 'o.online_channel')
            ->selectRaw('oi.product_id, p.name as product_name, o.online_channel')
            ->selectRaw('SUM(oi.quantity) as qty_sold')
            ->selectRaw('SUM(oi.quantity * oi.price) as revenue')
            ->selectRaw('SUM(oi.quantity * COALESCE(oi.unit_cost, 0)) as cogs')
            ->get();
        $categories = $this->channelCategoryMap();
        $canon = ['online' => 'zalo', 'nha_hang' => 'pos'];
        $byCode = $this->priceListByCode();
        $groupAgg = ['platform' => [], 'direct' => []]; // product_id => agg
        $channelRev = [];
        $channelComm = [];
        foreach ($chRows as $r) {
            $key = $this->channelKey($r);
            $key = $canon[$key] ?? $key;
            $grp = (($categories[$key] ?? 'partner') === 'partner') ? 'platform' : 'direct';
            $channelRev[$key] = ($channelRev[$key] ?? 0.0) + (float) $r->revenue;
            $pid = (int) $r->product_id;
            if (!isset($groupAgg[$grp][$pid])) {
                $groupAgg[$grp][$pid] = ['product_id' => $pid, 'product_name' => $r->product_name, 'qty' => 0.0, 'revenue' => 0.0, 'cogs' => 0.0];
            }
            $groupAgg[$grp][$pid]['qty'] += (float) $r->qty_sold;
            $groupAgg[$grp][$pid]['revenue'] += (float) $r->revenue;
            $groupAgg[$grp][$pid]['cogs'] += (float) $r->cogs;
        }
        foreach ($channelRev as $key => $rev) {
            $channelComm[$key] = $rev > 0 ? $this->commissionFor((string) $key, $rev, $byCode)['cost'] / $rev : 0.0;
        }
        foreach (['platform', 'direct'] as $grp) {
            $rate = 0.0;
            $gRev = 0.0;
            $gComm = 0.0;
            foreach ($channelRev as $key => $rev) {
                $kGrp = (($categories[$key] ?? 'partner') === 'partner') ? 'platform' : 'direct';
                if ($kGrp !== $grp) continue;
                $gRev += $rev;
                $gComm += $rev * ($channelComm[$key] ?? 0.0);
            }
            $rate = $gRev > 0 ? $gComm / $gRev : 0.0;
            $rows = array_values($groupAgg[$grp]);
            $maxQty = 0.0;
            foreach ($rows as &$row) {
                $row['qty'] = (float) $row['qty'];
                if ($row['qty'] > $maxQty) $maxQty = $row['qty'];
                $price = $row['qty'] > 0 ? $row['revenue'] / $row['qty'] : 0;
                $unitCogs = $row['qty'] > 0 ? $row['cogs'] / $row['qty'] : 0;
                $alloc = $price * $rate;
                $row['price'] = $this->r2($price);
                $row['cogs_per_unit'] = $this->r2($unitCogs);
                $row['commission_alloc_per_unit'] = $this->r2($alloc);
                $row['cm_per_unit'] = $this->r2($price - $unitCogs - $alloc);
                $row['cm_pct'] = $price > 0 ? $this->r2(($price - $unitCogs - $alloc) / $price * 100) : 0;
                $row['revenue'] = $this->r2($row['revenue']);
                $row['cogs'] = $this->r2($row['cogs']);
            }
            unset($row);
            $avgCm = count($rows) > 0 ? array_sum(array_column($rows, 'cm_pct')) / count($rows) : 0;
            foreach ($rows as &$row) {
                $pop = $maxQty > 0 ? $row['qty'] / $maxQty : 0;
                $highM = $row['cm_pct'] >= $avgCm;
                $highP = $pop >= 0.7;
                $row['quadrant'] = $highM && $highP ? 'star' : ($highM ? 'puzzle' : ($highP ? 'plowhorse' : 'dog'));
            }
            unset($row);
            usort($rows, fn($a, $b) => $b['cm_per_unit'] * $b['qty'] <=> $a['cm_per_unit'] * $a['qty']);
            $sp1[$grp] = [
                'commission_rate' => $this->r2($rate * 100),
                'avg_cm_pct' => $this->r2($avgCm),
                'items' => $rows,
            ];
        }

        return response()->json(['success' => true, 'data' => [
            'items' => $items,
            'matrix' => $matrix,
            'summary' => $summary,
            'avg_margin' => $avgMargin,
            // SP-1 (chỉ số 360 đợt 1): theo kênh — nhãn phân bổ ước tính.
            'by_channel_group' => $sp1,
            'meta' => ['from' => $from, 'to' => $to, 'branch_id' => $branchId],
        ]]);
    }

    /**
     * Tab Khách hàng (chỉ số 360 đợt 1, spec §0.5/§0.8/§0.9) —
     * GET /api/reports/customers?period=month&date=&branch_id=
     * KH-1 repeat rate · KH-2 chuyển hạng + tần suất · KH-3 nợ điểm ·
     * KH-4 CLV + nguy cơ rời bỏ · KH-5 cohort quý · MK-1/2/3 (khối
     * Marketing, gác thêm lá reports.marketing.view trong thân hàm).
     * Mọi chỉ số khách chỉ trên TẬP ĐỊNH DANH (đơn có customer_id) và
     * đầu payload luôn có tỷ lệ phủ định danh của kỳ (§0.5). KH-2/KH-3
     * là số TOÀN HỆ (hạng/điểm không gắn CN) kèm nhãn §0.9.
     */
    public function customers(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        if ($deny = $this->guardReportBranch($request)) return $deny;
        $branchId = (int) $request->query('branch_id', 0);
        $actor = $request->user();
        $isOwnerUser = $actor instanceof \App\Models\User;
        if ($isOwnerUser && $actor->isBranchOwner()) {
            // Chủ CN: ép phạm vi về CN của chính họ (§0.8/§0.9)
            $branchId = (int) ($actor->owner_branch_id ?? 0);
        }
        $canMarketing = true;
        if ($actor instanceof \App\Models\Employee) {
            $canMarketing = $actor->role && $actor->role->hasPermission('reports.marketing.view');
        }
        $period = $request->query('period', 'month');
        if (!in_array($period, ['week', 'month', 'year'], true)) $period = 'month';
        try {
            $anchor = $request->query('date')
                ? Carbon::parse($request->query('date'), $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $anchor = Carbon::now($tz)->startOfDay();
        }
        [$from, $to] = $this->window($period, $anchor);

        $identified = fn($q) => $q->whereNotNull('orders.customer_id');
        $totalOrders = $this->baseOrders($branchId, $from, $to)->count();
        $idOrders = $identified($this->baseOrders($branchId, $from, $to))->count();
        $coverage = [
            'identified_orders' => $idOrders,
            'total_orders' => $totalOrders,
            'pct' => $totalOrders > 0 ? $this->r2($idOrders / $totalOrders * 100) : 0,
        ];

        // ---- KH-1: repeat rate 2 cửa sổ + khách mới/quay lại trong kỳ
        $repeatOf = function (int $days) use ($branchId, $to, $identified) {
            $wFrom = $to->copy()->subDays($days - 1)->startOfDay();
            $counts = $identified($this->baseOrders($branchId, $wFrom, $to))
                ->select('orders.customer_id', DB::raw('COUNT(*) AS c'))
                ->groupBy('orders.customer_id')->pluck('c');
            $customers = $counts->count();
            $repeat = $counts->filter(fn($c) => (int) $c >= 2)->count();
            return [
                'days' => $days,
                'customers' => $customers,
                'repeat_customers' => $repeat,
                'rate' => $customers > 0 ? $this->r2($repeat / $customers * 100) : null,
            ];
        };
        $firstOrderAt = $identified($this->baseOrders($branchId, Carbon::create(2000, 1, 1, 0, 0, 0, $tz), $to))
            ->select('orders.customer_id', DB::raw('MIN(orders.created_at) AS first_at'))
            ->groupBy('orders.customer_id')->pluck('first_at', 'orders.customer_id');
        $periodCustomers = $identified($this->baseOrders($branchId, $from, $to))
            ->distinct()->pluck('orders.customer_id');
        $newCustomers = 0;
        foreach ($periodCustomers as $cid) {
            $fa = $firstOrderAt[$cid] ?? null;
            if ($fa !== null && $fa >= $from->toDateTimeString() && $fa <= $to->toDateTimeString()) {
                $newCustomers++;
            }
        }
        $kh1 = [
            'repeat_90' => $repeatOf(90),
            'repeat_365' => $repeatOf(365),
            'new_customers' => $newCustomers,
            'returning_customers' => max(0, $periodCustomers->count() - $newCustomers),
            'active_customers' => $periodCustomers->count(),
        ];

        // ---- KH-2: ma trận chuyển hạng (TOÀN HỆ — §0.9) + tần suất mua
        $tiers = \App\Models\MembershipTier::orderBy('id')->get(['id', 'name']);
        $tierName = $tiers->pluck('name', 'id')->all();
        $logs = \App\Models\CustomerTierLog::whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()])
            ->orderBy('created_at')->get();
        $logsByCustomer = $logs->groupBy('customer_id');
        $naturalMoves = $logs->filter(fn($l) => $l->reason !== 'manual')->count();
        $manualMoves = $logs->filter(fn($l) => $l->reason === 'manual')->count();
        // F-360-7 (§0.9): KH-2 là số TOÀN HỆ ở MỌI view — đơn của ma trận/
        // tần suất KHÔNG lọc theo CN đang xem (trước đây lọc theo $branchId
        // nên view 1 CN cho số khác hẳn: ô (1,1) 27 thay vì 35).
        $periodOrdersByCustomer = $identified($this->baseOrders(0, $from, $to))
            ->select('orders.customer_id', 'orders.total_amount', 'orders.shipping_fee', 'orders.online_channel')
            ->get()
            ->groupBy('customer_id');
        $matrixCustomers = collect($periodOrdersByCustomer->keys())
            ->merge($logsByCustomer->keys())->unique();
        $customersById = \App\Models\Customer::whereIn('id', $matrixCustomers->all())
            ->get(['id', 'membership_tier_id'])->keyBy('id');
        $cells = [];
        $freqCounts = ['1' => 0, '2' => 0, '3-5' => 0, '6+' => 0];
        foreach ($matrixCustomers as $cid) {
            $cust = $customersById->get($cid);
            $currentTier = $cust->membership_tier_id ?? null;
            $cLogs = $logsByCustomer->get($cid, collect());
            $startTier = $cLogs->isNotEmpty() ? $cLogs->first()->from_tier_id : $currentTier;
            $endTier = $cLogs->isNotEmpty() ? $cLogs->last()->to_tier_id : $currentTier;
            $orders = $periodOrdersByCustomer->get($cid, collect());
            $rev = 0.0;
            foreach ($orders as $o) {
                $rev += (float) $o->total_amount - (strtolower((string) $o->online_channel) === 'zalo' ? (float) $o->shipping_fee : 0);
            }
            $k = ($startTier ?? 'none') . '|' . ($endTier ?? 'none');
            if (!isset($cells[$k])) {
                $cells[$k] = ['from_tier_id' => $startTier, 'to_tier_id' => $endTier, 'customers' => 0, 'revenue' => 0.0];
            }
            $cells[$k]['customers']++;
            $cells[$k]['revenue'] += $rev;
            $oc = $orders->count();
            if ($oc === 1) $freqCounts['1']++;
            elseif ($oc === 2) $freqCounts['2']++;
            elseif ($oc >= 3 && $oc <= 5) $freqCounts['3-5']++;
            elseif ($oc >= 6) $freqCounts['6+']++;
        }
        $matrixOut = [];
        foreach ($cells as $c) {
            $matrixOut[] = $c + [
                'from_tier' => $c['from_tier_id'] !== null ? ($tierName[$c['from_tier_id']] ?? ('Hạng #' . $c['from_tier_id'])) : 'Chưa có hạng',
                'to_tier' => $c['to_tier_id'] !== null ? ($tierName[$c['to_tier_id']] ?? ('Hạng #' . $c['to_tier_id'])) : 'Chưa có hạng',
                'revenue' => $this->r2($c['revenue']),
            ];
        }
        $kh2 = [
            'scope' => 'system',
            'matrix' => $matrixOut,
            'tiers' => $tiers->map(fn($t) => ['id' => $t->id, 'name' => $t->name])->values()->all(),
            'natural_moves' => $naturalMoves,
            'manual_moves' => $manualMoves,
            // F-360-6: frequency PHẢI là mảng tuần tự [{bucket, customers}]
            // — mảng liên hợp khóa '1'/'2' bị json_encode thành object
            // {"1":…} khiến FE .map() sập trắng trang.
            'frequency' => [
                ['bucket' => '1', 'customers' => $freqCounts['1']],
                ['bucket' => '2', 'customers' => $freqCounts['2']],
                ['bucket' => '3-5', 'customers' => $freqCounts['3-5']],
                ['bucket' => '6+', 'customers' => $freqCounts['6+']],
            ],
        ];

        // ---- KH-3: nợ điểm + vòng đời điểm (TOÀN HỆ — §0.9)
        $pointValue = (int) Setting::get('points_point_value', 100);
        $liabilityPoints = (int) \App\Models\PointLot::query()
            ->where('points_remaining', '>', 0)
            ->where('earned_at', '<=', $to->toDateTimeString())
            ->where('expires_at', '>', $to->toDateTimeString())
            ->sum('points_remaining');
        $issuedPeriod = (int) \App\Models\PointLot::whereBetween('earned_at', [$from->toDateTimeString(), $to->toDateTimeString()])
            ->sum('points_initial');
        $txTypes = \App\Models\PointTransaction::whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()])
            ->select('type', DB::raw('SUM(ABS(`change`)) AS pts'))->groupBy('type')->pluck('pts', 'type');
        $redeemedPeriod = (int) ($txTypes['redeem'] ?? 0);
        $expiredPeriod = (int) ($txTypes['expire'] ?? 0);
        if ($expiredPeriod === 0) {
            $expiredPeriod = (int) \App\Models\PointLot::whereBetween('expires_at', [$from->toDateTimeString(), $to->toDateTimeString()])
                ->sum('points_remaining');
        }
        $issuedAll = (int) \App\Models\PointLot::sum('points_initial');
        $redeemedAll = (int) \App\Models\PointTransaction::where('type', 'redeem')->sum(DB::raw('ABS(`change`)'));
        $kh3 = [
            'scope' => 'system',
            'value_per_point' => $pointValue,
            'as_of' => $to->toDateString(),
            'liability_points' => $liabilityPoints,
            'liability_value' => $this->r2($liabilityPoints * $pointValue),
            'issued' => $issuedPeriod,
            'redeemed' => $redeemedPeriod,
            'expired' => $expiredPeriod,
            'redeem_rate_cumulative' => $issuedAll > 0 ? $this->r2($redeemedAll / $issuedAll * 100) : null,
        ];

        // ---- KH-4: CLV quan sát + khách nguy cơ rời bỏ
        $allIdOrders = $identified($this->baseOrders($branchId, Carbon::create(2000, 1, 1, 0, 0, 0, $tz), $to))
            ->select('orders.customer_id', 'orders.total_amount', 'orders.shipping_fee', 'orders.online_channel', 'orders.created_at')
            ->orderBy('orders.created_at')->get();
        $byCustomer = $allIdOrders->groupBy('customer_id');
        $custInfo = \App\Models\Customer::whereIn('id', $byCustomer->keys()->all())
            ->get(['id', 'name', 'phone'])->keyBy('id');
        $clvRows = [];
        $churnRows = [];
        $nowDay = Carbon::now($tz)->startOfDay();
        foreach ($byCustomer as $cid => $orders) {
            $rev = 0.0;
            foreach ($orders as $o) {
                $rev += (float) $o->total_amount - (strtolower((string) $o->online_channel) === 'zalo' ? (float) $o->shipping_fee : 0);
            }
            $info = $custInfo->get($cid);
            $clvRows[] = [
                'customer_id' => (int) $cid,
                'name' => $info->name ?? ('Khách #' . $cid),
                'phone' => $info->phone ?? null,
                'orders' => $orders->count(),
                'lifetime_revenue' => $this->r2($rev),
                'last_order_at' => $orders->last()->created_at?->toDateTimeString(),
            ];
            if ($orders->count() >= 3) {
                $times = $orders->map(fn($o) => Carbon::parse($o->created_at))->values();
                $gaps = [];
                for ($i = 1; $i < $times->count(); $i++) {
                    $gaps[] = $times[$i - 1]->diffInDays($times[$i]);
                }
                $avgGap = array_sum($gaps) / max(1, count($gaps));
                $sinceLast = $times->last()->copy()->startOfDay()->diffInDays($nowDay, false);
                if ($avgGap > 0 && $sinceLast > 2 * $avgGap && $sinceLast <= 365) {
                    $churnRows[] = [
                        'customer_id' => (int) $cid,
                        'name' => $info->name ?? ('Khách #' . $cid),
                        'phone' => $info->phone ?? null,
                        'orders' => $orders->count(),
                        'lifetime_revenue' => $this->r2($rev),
                        'avg_gap_days' => $this->r2($avgGap),
                        'days_since_last' => (int) $sinceLast,
                        'last_order_at' => $times->last()->toDateTimeString(),
                    ];
                }
            }
        }
        usort($clvRows, fn($a, $b) => $b['lifetime_revenue'] <=> $a['lifetime_revenue']);
        usort($churnRows, fn($a, $b) => $b['lifetime_revenue'] <=> $a['lifetime_revenue']);
        $kh4 = [
            'top_clv' => array_slice($clvRows, 0, 20),
            'churn_risk' => array_slice($churnRows, 0, 30),
        ];

        // ---- KH-5: giữ chân theo cohort QUÝ đăng ký
        // F-360-8: mốc M+k neo theo THÁNG ĐĂNG KÝ CỦA TỪNG KHÁCH (không
        // neo tháng đầu quý — bản cũ dồn khách đăng ký cuối quý lên trước
        // 2 tháng: cohort Q3/2026 toàn bộ đăng ký tháng 9, số mua tháng 9
        // (62,99%) bị hiện ở ô m2 thay vì tính đúng mốc). Mẫu số của M+k
        // chỉ gồm khách mà tháng M+k của họ ĐÃ bắt đầu; chưa tới → null.
        // Đối chiếu TESTER §KF (Q3/2026, 127 khách T9): m1 (T10) = 97 →
        // 76,38 · m2 (T11) = 37 → 29,13 · m3 (T12) = null.
        $cohorts = [];
        $qStart = Carbon::now($tz)->startOfQuarter()->subQuarters(5);
        for ($i = 0; $i < 6; $i++) {
            $qs = $qStart->copy()->addQuarters($i);
            $qe = $qs->copy()->endOfQuarter();
            $members = \App\Models\Customer::whereBetween('created_at', [$qs->toDateTimeString(), $qe->toDateTimeString()])
                ->get(['id', 'created_at']);
            $row = [
                'quarter' => 'Q' . $qs->quarter . '/' . $qs->year,
                'customers' => $members->count(),
                'm1' => null, 'm2' => null, 'm3' => null,
            ];
            if ($members->isNotEmpty()) {
                $byRegMonth = [];
                foreach ($members as $mem) {
                    $byRegMonth[Carbon::parse($mem->created_at)->format('Y-m')][] = (int) $mem->id;
                }
                foreach ([1, 2, 3] as $m) {
                    $actSum = 0;
                    $denSum = 0;
                    foreach ($byRegMonth as $ym => $ids) {
                        $mFrom = Carbon::createFromFormat('Y-m-d H:i:s', $ym . '-01 00:00:00', $tz)
                            ->addMonths($m)->startOfMonth();
                        if ($mFrom->gt($nowDay)) continue;
                        $mTo = $mFrom->copy()->endOfMonth();
                        $actSum += $identified($this->baseOrders($branchId, $mFrom, $mTo))
                            ->whereIn('orders.customer_id', $ids)
                            ->distinct()->count('orders.customer_id');
                        $denSum += count($ids);
                    }
                    $row['m' . $m] = $denSum > 0 ? $this->r2($actSum / $denSum * 100) : null;
                }
            }
            $cohorts[] = $row;
        }
        $kh5 = ['cohorts' => $cohorts];

        // ---- Khối Marketing (MK-1/2/3) — chỉ khi có lá marketing
        $mk = null;
        if ($canMarketing) {
            // MK-1: hiệu quả chương trình KM/coupon
            $promoOrders = $this->baseOrders($branchId, $from, $to)
                ->whereNotNull('promotion_id')
                ->select('promotion_id', 'total_amount', 'shipping_fee', 'online_channel', 'promotion_discount')
                ->get()->groupBy('promotion_id');
            $promoNames = \App\Models\Promotion::pluck('name', 'id');
            $mk1 = [];
            foreach ($promoOrders as $pid => $orders) {
                $rev = 0.0;
                foreach ($orders as $o) {
                    $rev += (float) $o->total_amount - (strtolower((string) $o->online_channel) === 'zalo' ? (float) $o->shipping_fee : 0);
                }
                $mk1[] = [
                    'kind' => 'promotion',
                    'program' => $promoNames[$pid] ?? ('Chương trình #' . $pid),
                    'issued' => null,
                    'used' => $orders->count(),
                    'use_rate' => null,
                    'discount' => $this->r2($orders->sum(fn($o) => (float) $o->promotion_discount)),
                    'revenue' => $this->r2($rev),
                    'aov' => $orders->count() > 0 ? $this->r2($rev / $orders->count()) : 0,
                ];
            }
            $couponGroups = \App\Models\CustomerCoupon::whereNotNull('promotion_id')
                ->select('promotion_id', DB::raw('COUNT(*) AS issued'),
                    DB::raw("SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_cnt"))
                ->groupBy('promotion_id')->get();
            $usedCoupons = \App\Models\CustomerCoupon::whereNotNull('promotion_id')
                ->where('status', 'used')
                ->whereBetween('used_at', [$from->toDateTimeString(), $to->toDateTimeString()])
                ->whereNotNull('used_order_id')->get(['promotion_id', 'used_order_id']);
            $couponOrders = \App\Models\Order::whereIn('id', $usedCoupons->pluck('used_order_id')->all())
                ->get(['id', 'total_amount', 'shipping_fee', 'online_channel', 'discount_amount', 'promotion_discount', 'voucher_code'])
                ->keyBy('id');
            foreach ($couponGroups as $g) {
                $usedHere = $usedCoupons->where('promotion_id', $g->promotion_id);
                $disc = 0.0;
                $rev = 0.0;
                foreach ($usedHere as $c) {
                    $o = $couponOrders->get($c->used_order_id);
                    if (!$o) continue;
                    $rev += (float) $o->total_amount - (strtolower((string) $o->online_channel) === 'zalo' ? (float) $o->shipping_fee : 0);
                    // Giảm của coupon suy từ khối giá đơn: tổng giảm − KM
                    // chương trình (đơn có cả voucher gõ tay thì phần voucher
                    // chưa tách được — ghi nhận ở note phương pháp).
                    $disc += max(0, (float) $o->discount_amount - (float) $o->promotion_discount);
                }
                $mk1[] = [
                    'kind' => 'coupon',
                    'program' => $promoNames[$g->promotion_id] ?? ('Chương trình #' . $g->promotion_id),
                    'issued' => (int) $g->issued,
                    'used' => $usedHere->count(),
                    'use_rate' => $g->issued > 0 ? $this->r2($usedHere->count() / (int) $g->issued * 100) : null,
                    'discount' => $this->r2($disc),
                    'revenue' => $this->r2($rev),
                    'aov' => $usedHere->count() > 0 ? $this->r2($rev / $usedHere->count()) : 0,
                ];
            }
            $allPeriod = $this->baseOrders($branchId, $from, $to)
                ->select('total_amount', 'shipping_fee', 'online_channel', 'promotion_id')->get();
            $revOf = fn($o) => (float) $o->total_amount - (strtolower((string) $o->online_channel) === 'zalo' ? (float) $o->shipping_fee : 0);
            $withPromo = $allPeriod->filter(fn($o) => $o->promotion_id !== null);
            $withoutPromo = $allPeriod->filter(fn($o) => $o->promotion_id === null);
            $mk1Summary = [
                'aov_with' => $withPromo->count() > 0 ? $this->r2($withPromo->sum($revOf) / $withPromo->count()) : null,
                'aov_without' => $withoutPromo->count() > 0 ? $this->r2($withoutPromo->sum($revOf) / $withoutPromo->count()) : null,
            ];

            // MK-2: chi phí điểm theo nguồn phát hành (lô điểm trong kỳ).
            // N-4: dòng 'adjust' tách theo manual_source (NULL/cũ → chưa phân loại).
            $sourceLabels = ['earn' => 'Đơn hàng', 'referral' => 'Referral', 'adjust' => 'Ghi tay / khác', 'migration' => 'Chuyển đổi dữ kiện', 'minigame' => 'Minigame'];
            $lotGroups = \App\Models\PointLot::whereBetween('earned_at', [$from->toDateTimeString(), $to->toDateTimeString()])
                ->select('source_type', Schema::hasColumn('point_lots', 'manual_source') ? 'manual_source' : DB::raw('NULL AS manual_source'), DB::raw('SUM(points_initial) AS pts'))
                ->groupBy('source_type', 'manual_source')->get();
            $mk2 = [];
            foreach ($lotGroups as $g) {
                $isAdjust = $g->source_type === 'adjust';
                $ms = $isAdjust ? $g->manual_source : null;
                $label = $isAdjust
                    ? ($ms !== null ? 'Ghi tay — ' . \App\Support\ManualPointSources::label($ms) : 'Ghi tay — chưa phân loại')
                    : ($sourceLabels[$g->source_type] ?? $g->source_type);
                $mk2[] = [
                    'source' => $g->source_type,
                    'manual_source' => $ms,
                    'label' => $label,
                    'points' => (int) $g->pts,
                    'value' => $this->r2(((int) $g->pts) * $pointValue),
                ];
            }

            // MK-3: referral
            $refs = \App\Models\Referral::whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()])->get();
            $completed = $refs->filter(fn($r) => $r->status === 'completed');
            $referredIds = $completed->pluck('referred_id')->filter()->unique()->all();
            $referredRevenue = 0.0;
            if ($referredIds !== []) {
                $rOrders = $this->baseOrders($branchId, Carbon::create(2000, 1, 1, 0, 0, 0, $tz), $to)
                    ->whereIn('orders.customer_id', $referredIds)
                    ->select('orders.total_amount', 'orders.shipping_fee', 'orders.online_channel')->get();
                foreach ($rOrders as $o) {
                    $referredRevenue += (float) $o->total_amount - (strtolower((string) $o->online_channel) === 'zalo' ? (float) $o->shipping_fee : 0);
                }
            }
            $mk3 = [
                'referrers' => $refs->pluck('referrer_id')->unique()->count(),
                'referrals' => $refs->count(),
                'completed' => $completed->count(),
                'completion_rate' => $refs->count() > 0 ? $this->r2($completed->count() / $refs->count() * 100) : null,
                'referred_lifetime_revenue' => $this->r2($referredRevenue),
            ];

            $mk = ['mk1' => $mk1, 'mk1_summary' => $mk1Summary, 'mk2' => $mk2, 'mk3' => $mk3];
        }

        return response()->json(['success' => true, 'data' => [
            'meta' => [
                'branch_id' => $branchId,
                'period' => $period,
                'from' => $from->toDateTimeString(),
                'to' => $to->toDateTimeString(),
                'scope_note' => $branchId > 0
                    ? 'Chỉ số theo đơn lọc theo chi nhánh; KH-2/KH-3 là số toàn hệ — hạng/điểm không tách theo chi nhánh.'
                    : 'Toàn chuỗi.',
            ],
            'coverage' => $coverage,
            'kh1' => $kh1,
            'kh2' => $kh2,
            'kh3' => $kh3,
            'kh4' => $kh4,
            'kh5' => $kh5,
            'marketing' => $mk,
            // N-5: mốc đổi cấu hình trong kỳ — KH-2 ← ngưỡng hạng, KH-3 ← giá trị điểm.
            'config_markers' => [
                'membership_tier' => $this->configMarkers('membership_tier', $from, $to),
                'point_value' => $this->configMarkers('point_value', $from, $to),
            ],
            // CL-1: mặt báo cáo chỉ mở khi N-6 (chấm sao Mini App, đợt 2)
            // có dữ kiện — trước đó hiện trạng thái chưa thu thập.
            'ratings' => ['status' => 'not_collected'],
        ]]);
    }

    /** Đơn giá giờ hiệu lực của NV: employees.hourly_rate, dự phòng
     *  WageLevel gần nhất (cùng khuôn estimatePayrollForMonth). */
    private function employeeRates(array $empIds, Carbon $asOf): array
    {
        if ($empIds === []) return [];
        $emps = \App\Models\Employee::whereIn('id', $empIds)->get()->keyBy('id');
        $out = [];
        foreach ($empIds as $id) {
            $emp = $emps->get($id);
            $rate = $emp ? (float) ($emp->hourly_rate ?? 0) : 0.0;
            if ($rate <= 0) {
                $lv = \App\Models\WageLevel::where('employee_id', $id)
                    ->where('start_date', '<=', $asOf->toDateString())
                    ->orderBy('start_date', 'desc')->first();
                $rate = $lv ? (float) $lv->hourly_rate : 0.0;
            }
            $out[$id] = $rate;
        }
        return $out;
    }

    /**
     * NS-1 + NS-2 (chỉ số 360 đợt 1) — GET /api/reports/hr-metrics
     * ?period=week|month&date=&branch_id=
     * NS-1: chuỗi theo tuần — doanh thu thuần (cùng cơ số buildPeriod,
     * T-01) ÷ giờ công từ chấm công GỐC (attendances, không qua đổ giờ
     * bảng lương — nhãn nguồn 'attendance'); labor % tuần = ƯỚC TÍNH
     * (giờ × đơn giá giờ, nhãn §0.3); labor % tháng đối chiếu số chốt
     * khi kỳ lương đã khóa. Kèm số ca thiếu check-out từng tuần.
     * NS-2: tuân thủ ca trên toàn kỳ — trễ >5' / về sớm / thiếu
     * check-out đối chiếu lịch xếp ca; giờ ngoài lịch + chi phí (ước
     * tính); mốc sửa lịch gần nhất trong kỳ.
     */
    public function hrMetrics(Request $request): JsonResponse
    {
        $tz = 'Asia/Ho_Chi_Minh';
        if ($deny = $this->guardReportBranch($request)) return $deny;
        $branchId = (int) $request->query('branch_id', 0);
        $period = $request->query('period', 'week');
        if (!in_array($period, ['week', 'month'], true)) $period = 'week';
        try {
            $anchor = $request->query('date')
                ? Carbon::parse($request->query('date'), $tz)->startOfDay()
                : Carbon::now($tz)->startOfDay();
        } catch (\Exception $e) {
            $anchor = Carbon::now($tz)->startOfDay();
        }
        [$from, $to] = $this->window($period, $anchor);
        $vatRate = (float) Setting::get('default_tax_rate', 8);

        // Tách cửa sổ thành các tuần ISO (T2–CN)
        $weeks = [];
        $cursor = $from->copy()->startOfWeek(Carbon::MONDAY);
        while ($cursor->lte($to)) {
            $wFrom = $cursor->copy()->max($from);
            $wTo = $cursor->copy()->endOfWeek(Carbon::SUNDAY)->min($to);
            $weeks[] = [$wFrom, $wTo];
            $cursor->addWeek();
        }

        $weekRows = [];
        foreach ($weeks as [$wFrom, $wTo]) {
            $p = $this->buildPeriod($branchId, $wFrom, $wTo, $vatRate, $tz);
            $net = max(0, (float) $p['gross'] - (float) $p['vat']);
            $attQ = DB::table('attendances')
                ->whereBetween('date', [$wFrom->toDateString(), $wTo->toDateString()])
                ->whereNotNull('check_in');
            if ($branchId > 0) $attQ->where('branch_id', $branchId);
            $perEmp = (clone $attQ)->whereNotNull('check_out')
                ->selectRaw('employee_id, SUM(TIMESTAMPDIFF(MINUTE, check_in, check_out)) / 60 AS hours')
                ->groupBy('employee_id')->pluck('hours', 'employee_id');
            $missing = (clone $attQ)->whereNull('check_out')->count();
            $hours = 0.0;
            $labor = 0.0;
            $rates = $this->employeeRates($perEmp->keys()->map(fn($v) => (int) $v)->all(), $wTo);
            foreach ($perEmp as $empId => $h) {
                $hours += (float) $h;
                $labor += (float) $h * ($rates[(int) $empId] ?? 0.0);
            }
            // Tháng trọn + đã khóa lương → labor tháng là số chốt
            $isEstimate = true;
            $monthLocked = false;
            if ($wFrom->format('d') === '01' && $wTo->format('Y-m-d') === $wFrom->copy()->endOfMonth()->format('Y-m-d')) {
                $sal = $this->shiftExpenses($p);
                if (($sal['salary_locked'] ?? false) === true) {
                    $labor = (float) $sal['salary'];
                    $isEstimate = false;
                    $monthLocked = true;
                }
            }
            $weekRows[] = [
                'from' => $wFrom->toDateString(),
                'to' => $wTo->toDateString(),
                'label' => $wFrom->format('d/m') . '–' . $wTo->format('d/m'),
                'net_revenue' => $this->r2($net),
                'hours' => $this->r2($hours),
                'splh' => $hours > 0 ? $this->r2($net / $hours) : null,
                'labor_cost' => $this->r2($labor),
                'labor_pct' => $net > 0 ? $this->r2($labor / $net * 100) : null,
                'is_estimate' => $isEstimate,
                'payroll_locked' => $monthLocked,
                'missing_checkout' => $missing,
            ];
        }

        // NS-2: tuân thủ ca trên toàn cửa sổ
        $sched = DB::table('work_schedules')
            ->join('work_shifts', 'work_shifts.id', '=', 'work_schedules.work_shift_id')
            ->whereBetween('work_schedules.date', [$from->toDateString(), $to->toDateString()])
            ->when($branchId > 0, fn($q) => $q->where('work_schedules.branch_id', $branchId))
            ->select('work_schedules.employee_id', 'work_schedules.date', 'work_schedules.branch_id',
                'work_schedules.updated_at',
                DB::raw('COALESCE(work_schedules.custom_start_time, work_shifts.start_time) AS start_t'),
                DB::raw('COALESCE(work_schedules.custom_end_time, work_shifts.end_time) AS end_t'))
            ->get();
        $attWin = DB::table('attendances')
            ->whereBetween('date', [$from->toDateString(), $to->toDateString()])
            ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
            ->get()->keyBy(fn($a) => $a->employee_id . '|' . $a->date . '|' . ($a->branch_id ?? ''));
        $totalSched = $sched->count();
        $late = 0;
        $early = 0;
        $noShow = 0;
        $missingOut = 0;
        $schedHours = 0.0;
        $otByEmpDay = [];
        $lastModified = null;
        foreach ($sched as $s) {
            $start = Carbon::parse($s->date . ' ' . $s->start_t, $tz);
            $end = Carbon::parse($s->date . ' ' . $s->end_t, $tz);
            if ($end->lte($start)) $end->addDay();
            $schedHours += $start->diffInMinutes($end) / 60;
            if ($lastModified === null || $s->updated_at > $lastModified) {
                $lastModified = $s->updated_at;
            }
            $key = $s->employee_id . '|' . $s->date . '|' . ($s->branch_id ?? '');
            $att = $attWin->get($key) ?? $attWin->get($s->employee_id . '|' . $s->date . '|');
            if (!$att || !$att->check_in) {
                $noShow++;
                continue;
            }
            $in = Carbon::parse($att->check_in, $tz);
            if ($in->gt($start->copy()->addMinutes(5))) $late++;
            if (!$att->check_out) {
                $missingOut++;
                continue;
            }
            $out = Carbon::parse($att->check_out, $tz);
            if ($out->lt($end)) $early++;
            $actualDay = $in->diffInMinutes($out) / 60;
            $schedDay = $start->diffInMinutes($end) / 60;
            $ot = $actualDay - $schedDay;
            if ($ot > 0) {
                $k = $s->employee_id;
                $otByEmpDay[$k] = ($otByEmpDay[$k] ?? 0.0) + $ot;
            }
        }
        $otHours = array_sum($otByEmpDay);
        $otRates = $this->employeeRates(array_map('intval', array_keys($otByEmpDay)), $to);
        $otCost = 0.0;
        foreach ($otByEmpDay as $empId => $h) {
            $otCost += $h * ($otRates[(int) $empId] ?? 0.0);
        }
        $compliance = [
            'scheduled_shifts' => $totalSched,
            'late_count' => $late,
            'late_pct' => $totalSched > 0 ? $this->r2($late / $totalSched * 100) : null,
            'early_count' => $early,
            'early_pct' => $totalSched > 0 ? $this->r2($early / $totalSched * 100) : null,
            'no_show' => $noShow,
            'missing_checkout' => $missingOut,
            'scheduled_hours' => $this->r2($schedHours),
            'overtime_hours' => $this->r2($otHours),
            'overtime_cost' => $this->r2($otCost),
            'overtime_is_estimate' => true,
            'schedule_last_modified' => $lastModified,
        ];

        return response()->json(['success' => true, 'data' => [
            'meta' => [
                'branch_id' => $branchId,
                'period' => $period,
                'from' => $from->toDateTimeString(),
                'to' => $to->toDateTimeString(),
                'hours_source' => 'attendance',
            ],
            'weeks' => $weekRows,
            'compliance' => $compliance,
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
        if ($deny = $this->guardReportBranch($request)) return $deny;
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
