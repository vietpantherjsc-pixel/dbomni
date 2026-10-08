<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\MembershipTier;
use App\Models\Order;
use App\Models\PointTransaction;
use App\Models\Setting;
use Exception;

// Gói 5 (2026-10-05): Tích điểm / đổi điểm / tự động nâng hạng thành viên.
class LoyaltyService
{
    /**
     * Tính số điểm được đổi thành tiền (không trừ điểm).
     * @return array ['points_used' => int, 'discount' => float]
     */
    public function previewRedeem(Customer $customer, int $requestedPoints, float $maxDiscount): array
    {
        $redeemPoints = max(1, (int) Setting::get('points_redeem_points', 10));
        $redeemAmount = (float) Setting::get('points_redeem_amount', 1000);

        $usable = min($requestedPoints, $customer->points);
        // Chỉ đổi theo bội số (VD: bội của 10 điểm)
        $usable = (int) (floor($usable / $redeemPoints) * $redeemPoints);
        if ($usable <= 0) {
            return ['points_used' => 0, 'discount' => 0];
        }

        $discount = ($usable / $redeemPoints) * $redeemAmount;
        $discount = min($discount, $maxDiscount);
        // Quy tròn lại số điểm theo discount thực tế (tránh lẻ khi bị cap)
        $pointsUsed = (int) (floor($discount / $redeemAmount) * $redeemPoints);

        return ['points_used' => $pointsUsed, 'discount' => round($discount, 0)];
    }

    /**
     * Trừ điểm đổi thưởng cho 1 đơn (gọi SAU khi đã tạo order).
     */
    public function applyRedeem(Customer $customer, Order $order, int $pointsUsed): void
    {
        if ($pointsUsed <= 0) {
            return;
        }
        $customer = Customer::lockForUpdate()->findOrFail($customer->id);
        if ($customer->points < $pointsUsed) {
            throw new Exception('Điểm của khách hàng không đủ để đổi.');
        }
        $customer->points -= $pointsUsed;
        $customer->save();

        PointTransaction::create([
            'customer_id' => $customer->id,
            'order_id' => $order->id,
            'change' => -$pointsUsed,
            'type' => 'redeem',
            'note' => "Đổi điểm trừ tiền đơn {$order->code}",
        ]);
    }

    /**
     * Tích điểm + cộng tổng tiền + tự nâng hạng (gọi khi đơn được THANH TOÁN).
     * @return int số điểm đã tích
     */
    public function earnForOrder(Customer $customer, Order $order, float $paidAmount): int
    {
        $customer = Customer::lockForUpdate()->findOrFail($customer->id);

        $tier = $customer->tier;
        $perAmount = (float) ($tier->earn_per_amount ?? 10000);
        $perPoints = (int) ($tier->earn_points ?? 1);
        $earned = $perAmount > 0 ? (int) (floor($paidAmount / $perAmount) * $perPoints) : 0;

        $customer->total_spent += $paidAmount;
        $customer->points += $earned;

        // Tự nâng hạng theo tổng tiền tích lũy
        $newTier = MembershipTier::where('min_total_spent', '<=', $customer->total_spent)
            ->orderByDesc('min_total_spent')
            ->first();
        if ($newTier && $newTier->id !== $customer->membership_tier_id) {
            $customer->membership_tier_id = $newTier->id;
        }
        $customer->save();

        if ($earned > 0) {
            PointTransaction::create([
                'customer_id' => $customer->id,
                'order_id' => $order->id,
                'change' => $earned,
                'type' => 'earn',
                'note' => "Tích điểm đơn {$order->code}",
            ]);
        }

        return $earned;
    }

    /**
     * Gói 9: thưởng điểm giới thiệu cho người share link (affiliate).
     */
    public function awardReferral(Customer $referrer, Order $order, int $points): void
    {
        $referrer = Customer::lockForUpdate()->findOrFail($referrer->id);
        $referrer->points += $points;
        $referrer->save();

        PointTransaction::create([
            'customer_id' => $referrer->id,
            'order_id' => $order->id,
            'change' => $points,
            'type' => 'earn',
            'note' => "Thưởng giới thiệu đơn {$order->code}",
        ]);
    }

    /**
     * Hoàn điểm đã đổi khi hủy đơn.
     */
    public function refundRedeem(Order $order): void
    {
        if (!$order->customer_id || $order->points_redeemed <= 0) {
            return;
        }
        $customer = Customer::lockForUpdate()->findOrFail($order->customer_id);
        $customer->points += $order->points_redeemed;
        $customer->save();

        PointTransaction::create([
            'customer_id' => $customer->id,
            'order_id' => $order->id,
            'change' => $order->points_redeemed,
            'type' => 'adjust',
            'note' => "Hoàn điểm do hủy đơn {$order->code}",
        ]);
    }

    /**
     * Gói 13: thu hồi điểm đã TÍCH khi hủy đơn (chống gian lận tích điểm rồi hủy).
     */
    public function revokeEarn(Order $order): void
    {
        if (!$order->customer_id || $order->points_earned <= 0) {
            return;
        }
        $customer = Customer::lockForUpdate()->findOrFail($order->customer_id);
        $customer->points = max(0, $customer->points - $order->points_earned);
        $customer->save();

        PointTransaction::create([
            'customer_id' => $customer->id,
            'order_id' => $order->id,
            'change' => -$order->points_earned,
            'type' => 'revoke',
            'note' => "Thu hồi điểm đã tích do hủy đơn {$order->code}",
        ]);
    }
}
