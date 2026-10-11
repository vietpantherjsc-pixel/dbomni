<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Order;
use App\Models\PointTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 46: Affiliate — top thành viên giới thiệu + lịch sử đơn affiliate.
// Dữ liệu từ orders.referred_by (mã TV người giới thiệu, chỉ tính đơn thành công:
// payment_status='paid' hoặc đã trừ kho).
class AffiliateController extends Controller
{
    // Top thành viên affiliate theo tháng: số đơn + tổng tiền đơn đã giới thiệu.
    public function top(Request $request): JsonResponse
    {
        $v = $request->validate([
            'month' => 'required|date_format:Y-m',
            'limit' => 'nullable|integer|min:1|max:100',
        ]);
        $limit = (int) ($v['limit'] ?? 20);
        [$y, $m] = explode('-', $v['month']);

        $stats = Order::whereNotNull('referred_by')
            ->where('referred_by', '!=', '')
            ->whereYear('created_at', $y)
            ->whereMonth('created_at', $m)
            ->where(function ($q) {
                $q->where('payment_status', 'paid')->orWhere('stock_deducted', true);
            })
            ->selectRaw('referred_by, COUNT(*) as order_count, SUM(total_amount) as total_amount')
            ->groupBy('referred_by')
            ->orderByDesc('order_count')
            ->orderByDesc('total_amount')
            ->limit($limit)
            ->get();

        $codes = $stats->pluck('referred_by')->all();
        $customers = Customer::whereIn('member_code', $codes)
            ->select('id', 'member_code', 'name', 'phone')
            ->get()->keyBy('member_code');

        // Tổng điểm đã thưởng cho từng người giới thiệu (theo order có referred_by)
        $orderIds = Order::whereNotNull('referred_by')
            ->where('referred_by', '!=', '')
            ->whereYear('created_at', $y)
            ->whereMonth('created_at', $m)
            ->where(function ($q) {
                $q->where('payment_status', 'paid')->orWhere('stock_deducted', true);
            })
            ->pluck('id');
        $pointsByOrder = PointTransaction::whereIn('order_id', $orderIds)
            ->where('type', 'earn')
            ->where('note', 'like', 'Thưởng giới thiệu đơn%')
            ->selectRaw('order_id, SUM(`change`) as points')
            ->groupBy('order_id')
            ->pluck('points', 'order_id');
        $orderRefMap = Order::whereIn('id', $orderIds)->pluck('referred_by', 'id');
        $pointsByRef = [];
        foreach ($orderRefMap as $oid => $ref) {
            $pointsByRef[$ref] = ($pointsByRef[$ref] ?? 0) + (int) ($pointsByOrder[$oid] ?? 0);
        }

        $data = $stats->map(function ($s) use ($customers, $pointsByRef) {
            $c = $customers->get($s->referred_by);
            return [
                'member_code' => $s->referred_by,
                'full_name' => $c?->name ?? '(không rõ)',
                'phone' => $c?->phone ?? '',
                'order_count' => (int) $s->order_count,
                'total_amount' => (float) $s->total_amount,
                'points_awarded' => (int) ($pointsByRef[$s->referred_by] ?? 0),
            ];
        });

        return response()->json(['success' => true, 'data' => $data]);
    }

    // Lịch sử đơn hàng affiliate: tìm kiếm theo mã đơn / người giới thiệu / khoảng ngày.
    public function orders(Request $request): JsonResponse
    {
        $v = $request->validate([
            'code' => 'nullable|string|max:50',
            'referrer' => 'nullable|string|max:50', // tên hoặc SĐT người giới thiệu
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $q = Order::with(['customer:id,name,phone'])
            ->whereNotNull('orders.referred_by')
            ->where('orders.referred_by', '!=', '')
            ->where(function ($qq) {
                $qq->where('orders.payment_status', 'paid')->orWhere('orders.stock_deducted', true);
            });

        if (!empty($v['code'])) $q->where('orders.code', 'like', '%' . $v['code'] . '%');
        if (!empty($v['from'])) $q->whereDate('orders.created_at', '>=', $v['from']);
        if (!empty($v['to'])) $q->whereDate('orders.created_at', '<=', $v['to']);
        if (!empty($v['referrer'])) {
            $kw = $v['referrer'];
            $codes = Customer::where('name', 'like', "%{$kw}%")
                ->orWhere('phone', 'like', "%{$kw}%")
                ->pluck('member_code');
            $q->whereIn('orders.referred_by', $codes);
        }

        $page = $q->orderByDesc('orders.created_at')
            ->paginate($v['per_page'] ?? 20, ['id', 'code', 'created_at', 'total_amount', 'referred_by', 'customer_id']);

        // Gắn thông tin người giới thiệu
        $codes = $page->getCollection()->pluck('referred_by')->unique()->all();
        $referrers = Customer::whereIn('member_code', $codes)
            ->select('member_code', 'name', 'phone')
            ->get()->keyBy('member_code');
        // Điểm thưởng của từng đơn
        $points = PointTransaction::whereIn('order_id', $page->getCollection()->pluck('id'))
            ->where('type', 'earn')
            ->where('note', 'like', 'Thưởng giới thiệu đơn%')
            ->selectRaw('order_id, SUM(`change`) as points')
            ->groupBy('order_id')
            ->pluck('points', 'order_id');

        $page->getCollection()->transform(function ($o) use ($referrers, $points) {
            $r = $referrers->get($o->referred_by);
            $o->referrer_name = $r?->name ?? '(không rõ)';
            $o->referrer_phone = $r?->phone ?? '';
            $o->points_awarded = (int) ($points[$o->id] ?? 0);
            return $o;
        });

        return response()->json(['success' => true, 'data' => $page]);
    }
}
