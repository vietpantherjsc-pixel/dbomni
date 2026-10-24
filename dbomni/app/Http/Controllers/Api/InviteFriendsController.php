<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerCoupon;
use App\Models\Order;
use App\Models\Referral;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

// "Mời bạn bè" (thay Affiliate Gói 46 — đổi tên 2026-10-20 theo chốt Đại Vương):
// Mini App đã chuyển sang giới thiệu nhận coupon CP-02 (SPEC-02), không còn điểm affiliate.
// Dữ liệu: referrals (lời mời hoàn tất) + orders.referred_by (đơn phát sinh) + customer_coupons
// (voucher CP-02 đã phát, issue_trigger='referral').
// Route cũ /affiliate/* giữ nguyên trỏ vào đây + log deprecated (bỏ ở phiên bản sau).
class InviteFriendsController extends Controller
{
    private function logDeprecated(Request $request): void
    {
        if (str_contains($request->path(), 'affiliate')) {
            Log::warning('[Deprecated] Route /affiliate/* đã đổi tên thành /invite-friends/* — cập nhật client.');
        }
    }

    // Top thành viên mời bạn bè theo tháng: lượt mời thành công + đơn phát sinh + voucher đã phát.
    public function top(Request $request): JsonResponse
    {
        $this->logDeprecated($request);
        $v = $request->validate([
            'month' => 'required|date_format:Y-m',
            'limit' => 'nullable|integer|min:1|max:100',
        ]);
        $limit = (int) ($v['limit'] ?? 20);
        [$y, $m] = explode('-', $v['month']);

        // Đơn phát sinh từ lời mời (orders.referred_by = mã TV người mời)
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

        // Lượt mời thành công trong tháng (referrals completed)
        $invitedByCode = [];
        if ($customers->isNotEmpty()) {
            $refs = Referral::whereIn('referrer_id', $customers->pluck('id')->all())
                ->where('status', 'completed')
                ->whereYear('completed_at', $y)
                ->whereMonth('completed_at', $m)
                ->selectRaw('referrer_id, COUNT(*) as c')
                ->groupBy('referrer_id')
                ->pluck('c', 'referrer_id');
            $idToCode = $customers->pluck('member_code', 'id');
            foreach ($refs as $rid => $cnt) {
                if (isset($idToCode[$rid])) $invitedByCode[$idToCode[$rid]] = (int) $cnt;
            }
        }

        // Voucher CP-02 đã phát cho người mời trong tháng
        $couponByCode = [];
        if ($customers->isNotEmpty()) {
            $cps = CustomerCoupon::whereIn('customer_id', $customers->pluck('id')->all())
                ->where('issue_trigger', 'referral')
                ->whereYear('issued_at', $y)
                ->whereMonth('issued_at', $m)
                ->selectRaw('customer_id, COUNT(*) as c')
                ->groupBy('customer_id')
                ->pluck('c', 'customer_id');
            $idToCode = $customers->pluck('member_code', 'id');
            foreach ($cps as $cid => $cnt) {
                if (isset($idToCode[$cid])) $couponByCode[$idToCode[$cid]] = (int) $cnt;
            }
        }

        $data = $stats->map(function ($s) use ($customers, $invitedByCode, $couponByCode) {
            $c = $customers->get($s->referred_by);
            return [
                'member_code' => $s->referred_by,
                'full_name' => $c?->name ?? '(không rõ)',
                'phone' => $c?->phone ?? '',
                'invited_count' => (int) ($invitedByCode[$s->referred_by] ?? 0),
                'order_count' => (int) $s->order_count,
                'total_amount' => (float) $s->total_amount,
                'coupons_issued' => (int) ($couponByCode[$s->referred_by] ?? 0),
            ];
        });

        return response()->json(['success' => true, 'data' => $data]);
    }

    // Danh sách đơn hàng phát sinh từ lời mời: tìm theo mã đơn / người mời / khoảng ngày.
    public function orders(Request $request): JsonResponse
    {
        $this->logDeprecated($request);
        $v = $request->validate([
            'code' => 'nullable|string|max:50',
            'referrer' => 'nullable|string|max:50', // tên hoặc SĐT người mời
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

        $codes = $page->getCollection()->pluck('referred_by')->unique()->all();
        $referrers = Customer::whereIn('member_code', $codes)
            ->select('member_code', 'name', 'phone')
            ->get()->keyBy('member_code');

        $page->getCollection()->transform(function ($o) use ($referrers) {
            $r = $referrers->get($o->referred_by);
            $o->referrer_name = $r?->name ?? '(không rõ)';
            $o->referrer_phone = $r?->phone ?? '';
            return $o;
        });

        return response()->json(['success' => true, 'data' => $page]);
    }
}
