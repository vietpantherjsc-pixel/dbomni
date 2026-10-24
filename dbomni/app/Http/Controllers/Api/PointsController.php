<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\PointExchangeItem;
use App\Models\PointLot;
use App\Models\PointTransaction;
use App\Services\AutoIssueCouponService;
use App\Services\CustomerIdentityService;
use App\Services\LoyaltyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Loyalty 2.0 (2026-10-21): Cửa hàng điểm + lịch sử điểm cho Mini App
// (spec mục 6 + 8). Định danh khách theo chuẩn Spec 3 (CustomerIdentityService)
// — không tin customer_id trần. Điểm CHỈ ra bằng đường đổi coupon ở đây.
class PointsController extends Controller
{
    private function verifiedOrFail(Request $request): Customer|JsonResponse
    {
        $customer = CustomerIdentityService::verifiedCustomer($request->all());
        if (!$customer) {
            return response()->json([
                'success' => false,
                'error' => 'NOT_VERIFIED',
                'message' => 'Chưa xác thực được thông tin thành viên. Vui lòng mở lại app từ Zalo.',
            ], 401);
        }
        return $customer;
    }

    /** Giá điểm của 1 món đối với hạng của khách (giảm giá đổi điểm theo hạng). */
    private function priceFor(PointExchangeItem $item, ?\App\Models\MembershipTier $tier): int
    {
        $disc = (int) ($tier->points_discount_pct ?? 0);
        return (int) ceil($item->points_cost * (100 - $disc) / 100);
    }

    /** GET /online/points/exchange-items — danh sách món đổi + trạng thái theo khách. */
    public function exchangeItems(Request $request, LoyaltyService $loyalty): JsonResponse
    {
        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }
        $tier = $customer->tier;
        $available = $loyalty->availablePoints($customer);
        $tierRank = $tier ? (float) $tier->min_spent_window * 1000 + (float) $tier->sort_order : -1;

        $items = PointExchangeItem::with(['promotion', 'minTier'])
            ->where('is_active', true)
            ->whereHas('promotion')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(function ($item) use ($tier, $available, $tierRank, $customer) {
                $price = $this->priceFor($item, $tier);
                $lockedByTier = false;
                if ($item->minTier) {
                    $minRank = (float) $item->minTier->min_spent_window * 1000 + (float) $item->minTier->sort_order;
                    $lockedByTier = $tierRank < $minRank;
                }
                // 1 lượt đổi có thể trừ qua NHIỀU lô (nhiều dòng transaction)
                // → đếm theo số coupon phân biệt, không đếm số dòng.
                $exchangedByCustomer = PointTransaction::where('customer_id', $customer->id)
                    ->where('type', 'exchange')
                    ->where('point_exchange_item_id', $item->id)
                    ->distinct()
                    ->count('coupon_id');
                return [
                    'id' => $item->id,
                    'name' => $item->name,
                    'icon' => $item->icon,
                    'points_cost' => (int) $item->points_cost,
                    'points_price' => $price,
                    'min_tier_name' => $item->minTier?->name,
                    'locked_by_tier' => $lockedByTier,
                    'enough_points' => $available >= $price,
                    'promotion_name' => $item->promotion?->name,
                    'per_customer_remaining' => $item->per_customer_limit !== null
                        ? max(0, (int) $item->per_customer_limit - $exchangedByCustomer)
                        : null,
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $items,
            'points' => $available,
            'points_balance' => (int) $customer->points,
        ]);
    }

    /** POST /online/points/exchange {item_id} — đổi điểm lấy coupon vào ví. */
    public function exchange(Request $request, LoyaltyService $loyalty, AutoIssueCouponService $issuer): JsonResponse
    {
        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }
        $validated = $request->validate([
            'item_id' => 'required|integer',
        ]);

        try {
            $result = DB::transaction(function () use ($validated, $customer, $loyalty, $issuer) {
                $locked = Customer::lockForUpdate()->findOrFail($customer->id);
                $item = PointExchangeItem::with('promotion')->find($validated['item_id']);
                if (!$item || !$item->is_active) {
                    throw new \Exception('Món đổi này hiện không còn áp dụng.');
                }
                $promo = $item->promotion;
                if (!$promo || !$promo->is_active
                    || ($promo->starts_at && now()->lt($promo->starts_at))
                    || ($promo->expires_at && now()->gt($promo->expires_at))) {
                    // Kiểm TRƯỚC khi trừ điểm (checklist: mẫu dừng → báo rõ, không trừ điểm rồi lỗi)
                    throw new \Exception('Mẫu coupon của món đổi này đang tạm dừng. Vui lòng thử lại sau hoặc chọn món khác.');
                }
                $tier = $locked->tier;
                if ($item->minTier) {
                    $tierRank = $tier ? (float) $tier->min_spent_window * 1000 + (float) $tier->sort_order : -1;
                    $minRank = (float) $item->minTier->min_spent_window * 1000 + (float) $item->minTier->sort_order;
                    if ($tierRank < $minRank) {
                        throw new \Exception("Món này chỉ dành cho hạng {$item->minTier->name} trở lên.");
                    }
                }
                // Trần lượt: đếm theo số COUPON phân biệt của các dòng exchange
                // (1 lượt đổi trừ qua nhiều lô = nhiều dòng nhưng 1 coupon).
                // Lượt đã bị thu hồi VẪN tính vào trần (đúng spec 6.2 — dòng
                // hoàn điểm là type 'adjust', không làm giảm bộ đếm này).
                if ($item->per_customer_limit !== null) {
                    $mine = PointTransaction::where('customer_id', $locked->id)
                        ->where('type', 'exchange')
                        ->where('point_exchange_item_id', $item->id)
                        ->distinct()
                        ->count('coupon_id');
                    if ($mine >= (int) $item->per_customer_limit) {
                        throw new \Exception('Bạn đã đạt giới hạn đổi món này.');
                    }
                }
                if ($item->daily_limit !== null) {
                    $todayCount = PointTransaction::where('type', 'exchange')
                        ->where('point_exchange_item_id', $item->id)
                        ->whereDate('created_at', now()->toDateString())
                        ->distinct()
                        ->count('coupon_id');
                    if ($todayCount >= (int) $item->daily_limit) {
                        throw new \Exception('Món này đã hết lượt đổi hôm nay. Vui lòng quay lại ngày mai.');
                    }
                }
                $price = $this->priceFor($item, $tier);
                if ($loyalty->availablePoints($locked) < $price) {
                    throw new \Exception("Chưa đủ điểm (cần {$price} điểm).");
                }
                // Trừ điểm FIFO (ghi transaction từng lô) TRƯỚC, phát coupon SAU;
                // phát lỗi → exception → cả transaction rollback, điểm nguyên vẹn.
                $allocation = $loyalty->spendFifo($locked, $price, 'exchange', 'Đổi điểm: ' . $item->name, null, $item->id);
                $coupon = $issuer->issue($locked, $promo, 'points_exchange');
                if (!$coupon) {
                    throw new \Exception('Không phát được coupon cho món đổi này. Điểm của bạn không bị trừ.');
                }
                // Gắn coupon vào các dòng transaction của lượt đổi này — Admin
                // thu hồi coupon sẽ hoàn điểm về đúng lô theo liên kết này.
                \App\Models\PointTransaction::whereIn('id', array_column($allocation, 'transaction_id'))
                    ->update(['coupon_id' => $coupon->id]);
                return [
                    'coupon' => [
                        'code' => $coupon->code,
                        'promotion_name' => $promo->name,
                        'expires_at' => $coupon->expires_at,
                    ],
                    'points_spent' => $price,
                    'points_remaining' => (int) $locked->fresh()->points,
                ];
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Đổi điểm thành công! Coupon đã được thêm vào Ví coupon của bạn.',
            'data' => $result,
        ]);
    }

    /** GET /online/points/history — lịch sử điểm + các lô sắp hết hạn. */
    public function history(Request $request, LoyaltyService $loyalty): JsonResponse
    {
        $customer = $this->verifiedOrFail($request);
        if ($customer instanceof JsonResponse) {
            return $customer;
        }
        $transactions = PointTransaction::where('customer_id', $customer->id)
            ->orderByDesc('id')
            ->limit(100)
            ->get(['id', 'change', 'type', 'note', 'created_at']);
        $lots = PointLot::where('customer_id', $customer->id)
            ->where('points_remaining', '>', 0)
            ->where('expires_at', '>', now())
            ->orderBy('expires_at')
            ->get(['id', 'points_remaining', 'earned_at', 'expires_at', 'source_type']);

        return response()->json([
            'success' => true,
            'data' => [
                'points' => $loyalty->availablePoints($customer),
                'points_balance' => (int) $customer->points,
                'transactions' => $transactions,
                'lots' => $lots,
            ],
        ]);
    }
}
