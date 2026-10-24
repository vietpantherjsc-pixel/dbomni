<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\CustomerTierLog;
use App\Models\MembershipTier;
use App\Models\Order;
use App\Models\PointLot;
use App\Models\PointTransaction;
use App\Models\Setting;
use Carbon\Carbon;
use Exception;

// Gói 5 (2026-10-05): Tích điểm / đổi điểm / tự động nâng hạng thành viên.
// Loyalty 2.0 (2026-10-21): lô điểm FIFO có HSD, hạng theo cửa sổ trượt, điểm
// chỉ còn 1 đường ra là đổi coupon ở Cửa hàng điểm (spec-hang-thanh-vien-moi).
class LoyaltyService
{
    /**
     * @deprecated Loyalty 2.0 — trừ điểm trực tiếp vào đơn đã GỠ (spec mục 4.2).
     * Giữ lại 1 phiên bản chỉ để đối chiếu lịch sử; KHÔNG controller nào gọi nữa.
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
     * @deprecated Loyalty 2.0 — xem previewRedeem(). Không còn nơi gọi.
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
     * Tích điểm + cộng tổng tiền + xét LÊN hạng theo cửa sổ trượt (gọi khi đơn
     * được THANH TOÁN). Loyalty 2.0: điểm tích = floor(tiền / earn_per_amount)
     * × earn_points × earn_multiplier của hạng HIỆN TẠI (trước khi lên hạng)
     * × hệ số sự kiện Double Days (nếu đang diễn ra và hạng có cờ quyền lợi);
     * mỗi lần tích tạo 1 lô FIFO có HSD theo cấu hình tại thời điểm tích.
     * @return int số điểm đã tích
     */
    public function earnForOrder(Customer $customer, Order $order, float $paidAmount): int
    {
        $customer = Customer::lockForUpdate()->findOrFail($customer->id);

        $tier = $customer->tier;
        $perAmount = (float) ($tier->earn_per_amount ?? 10000);
        $perPoints = (int) ($tier->earn_points ?? 1);
        $base = $perAmount > 0 ? floor($paidAmount / $perAmount) * $perPoints : 0;
        $multiplier = (float) ($tier->earn_multiplier ?? 1);
        $ddMult = $this->doubleDaysMultiplier($tier);
        $earned = (int) floor($base * $multiplier * $ddMult);

        $customer->total_spent += $paidAmount;
        $customer->points += $earned;

        if ($earned > 0) {
            $lot = $this->createLot($customer, $earned, 'earn', $order->id);
            PointTransaction::create([
                'customer_id' => $customer->id,
                'order_id' => $order->id,
                'point_lot_id' => $lot->id,
                'change' => $earned,
                'type' => 'earn',
                'note' => "Tích điểm đơn {$order->code}" . ($ddMult > 1 ? " · double_points ×{$ddMult}" : ''),
            ]);
        }
        $customer->save();

        // Lên hạng tức thì theo chi tiêu cửa sổ (hạ hạng chỉ qua cron đêm — mục 3.3)
        $this->evaluateUpgrade($customer);

        return $earned;
    }

    /**
     * Gói 9: thưởng điểm giới thiệu cho người share link (affiliate).
     * Loyalty 2.0: tạo lô riêng source_type = referral, HSD như điểm thường.
     */
    public function awardReferral(Customer $referrer, Order $order, int $points): void
    {
        if ($points <= 0) {
            return;
        }
        $referrer = Customer::lockForUpdate()->findOrFail($referrer->id);
        $referrer->points += $points;
        $referrer->save();

        $lot = $this->createLot($referrer, $points, 'referral', $order->id);
        PointTransaction::create([
            'customer_id' => $referrer->id,
            'order_id' => $order->id,
            'point_lot_id' => $lot->id,
            'change' => $points,
            'type' => 'earn',
            'note' => "Thưởng giới thiệu đơn {$order->code}",
        ]);
    }

    /**
     * Hoàn điểm đã đổi khi hủy đơn.
     * Loyalty 2.0: chỉ còn áp cho đơn CŨ (trước chuyển đổi) có points_redeemed;
     * điểm hoàn vào 1 lô mới (HSD tính từ lúc hoàn) để sổ lô luôn nhất quán.
     */
    public function refundRedeem(Order $order): void
    {
        if (!$order->customer_id || $order->points_redeemed <= 0) {
            return;
        }
        $customer = Customer::lockForUpdate()->findOrFail($order->customer_id);
        $customer->points += $order->points_redeemed;
        $customer->save();

        $lot = $this->createLot($customer, (int) $order->points_redeemed, 'adjust', $order->id);
        PointTransaction::create([
            'customer_id' => $customer->id,
            'order_id' => $order->id,
            'point_lot_id' => $lot->id,
            'change' => $order->points_redeemed,
            'type' => 'adjust',
            'note' => "Hoàn điểm do hủy đơn {$order->code}",
        ]);
    }

    /**
     * Gói 13: thu hồi điểm đã TÍCH khi hủy đơn (chống gian lận tích điểm rồi hủy).
     * Gói 55 p11ae: earnForOrder() LUÔN cộng total_spent dù points_earned = 0, nên hủy đơn
     * đã paid phải trừ lại total_spent trong mọi trường hợp; chỉ skip phần trừ ĐIỂM khi
     * points_earned = 0. Tham số $hadPaid cho biết đơn đã từng paid (earn đã chạy) —
     * đơn held hủy khi chưa paid thì earn chưa bao giờ chạy, không được trừ total_spent.
     */
    public function revokeEarn(Order $order, bool $hadPaid = false): void
    {
        if (!$order->customer_id || !$hadPaid) {
            return;
        }
        $customer = Customer::lockForUpdate()->findOrFail($order->customer_id);
        // Trừ lại tổng chi tiêu đã cộng lúc tích điểm. Loyalty 2.0: hủy đơn KHÔNG
        // hạ hạng tức thì nữa — chi tiêu cửa sổ giảm sẽ được cron đêm xét theo
        // đúng quy trình báo trước (spec mục 3.3); recalculateTier cũ đã bỏ.
        $customer->total_spent = max(0, (float) $customer->total_spent - (float) $order->total_amount);

        if ($order->points_earned > 0) {
            // Gói SEC: cho phép số dư âm (đúng bản chất kế toán) — chống gian lận tích → tiêu → hủy
            $customer->points = $customer->points - $order->points_earned;
            // Loyalty 2.0: trừ vào đúng lô của đơn trước; phần lô đã bị tiêu thì
            // trừ tiếp các lô khác theo FIFO (đồng bộ sổ lô với số dư âm).
            $this->deductFromOrderLotThenFifo($customer, (int) $order->points_earned, $order->id);
            PointTransaction::create([
                'customer_id' => $customer->id,
                'order_id' => $order->id,
                'change' => -$order->points_earned,
                'type' => 'revoke',
                'note' => "Thu hồi điểm đã tích do hủy đơn {$order->code}",
            ]);
        }
        $customer->save();
    }

    // =====================================================================
    // Loyalty 2.0 (2026-10-21) — lô điểm FIFO, cửa sổ trượt, Cửa hàng điểm
    // =====================================================================

    /** Cấu hình Loyalty đọc từ settings kèm mặc định theo spec mục 1.5. */
    public function config(): array
    {
        return [
            'window_days' => max(1, (int) Setting::get('tier_window_days', 60)),
            'eval_cycle' => (string) Setting::get('tier_eval_cycle', 'rolling'),
            'downgrade_notice_days' => max(0, (int) Setting::get('tier_downgrade_notice_days', 10)),
            'grace_first_cycle' => filter_var(Setting::get('tier_grace_first_cycle', '1'), FILTER_VALIDATE_BOOLEAN),
            'expire_months' => max(1, (int) Setting::get('points_expire_months', 12)),
            'expiry_warn_days' => max(1, (int) Setting::get('points_expiry_warn_days', 30)),
            'point_value' => (int) Setting::get('points_point_value', 100),
            'started_at' => Setting::get('loyalty_v2_started_at'),
        ];
    }

    /** Tạo 1 lô điểm; HSD chụp theo cấu hình TẠI THỜI ĐIỂM tạo (spec mục 1.2). */
    public function createLot(Customer $customer, int $points, string $sourceType, ?int $orderId = null, ?Carbon $earnedAt = null): PointLot
    {
        $earnedAt = $earnedAt ?? now();
        return PointLot::create([
            'customer_id' => $customer->id,
            'source_type' => $sourceType,
            'source_order_id' => $orderId,
            'points_initial' => $points,
            'points_remaining' => $points,
            'earned_at' => $earnedAt,
            'expires_at' => $earnedAt->copy()->addMonths($this->config()['expire_months']),
        ]);
    }

    /** Tổng điểm còn lại trong các lô CHƯA hết hạn. */
    public function lotBalance(Customer $customer): int
    {
        return (int) PointLot::where('customer_id', $customer->id)
            ->where('expires_at', '>', now())
            ->sum('points_remaining');
    }

    /**
     * Số điểm khả dụng để tiêu: tổng lô chưa hết hạn trừ phần âm lịch sử
     * (khi customers.points < tổng lô do từng bị trừ âm kiểu Gói SEC).
     * available = max(0, min(customers.points, lotBalance)).
     */
    public function availablePoints(Customer $customer): int
    {
        return max(0, min((int) $customer->points, $this->lotBalance($customer)));
    }

    /** Điểm sắp hết hạn trong N ngày tới + ngày hết hạn gần nhất (spec 5.4). */
    public function expiringSoon(Customer $customer, ?int $warnDays = null): array
    {
        $warnDays = $warnDays ?? $this->config()['expiry_warn_days'];
        $lots = PointLot::where('customer_id', $customer->id)
            ->where('points_remaining', '>', 0)
            ->where('expires_at', '>', now())
            ->where('expires_at', '<=', now()->addDays($warnDays))
            ->orderBy('expires_at')
            ->get();
        return [
            'points' => (int) $lots->sum('points_remaining'),
            'next_date' => $lots->first()?->expires_at?->toDateString(),
        ];
    }

    /**
     * Đồng bộ sổ lô với số dư sổ sách khi tổng lô > customers.points (phần âm
     * lịch sử chưa phản ánh vào lô): trừ FIFO thầm lặng đúng phần chênh —
     * transaction âm tương ứng đã được ghi ở lần trừ trước nên không ghi lại.
     */
    private function syncLotsToBalance(Customer $customer): void
    {
        $excess = $this->lotBalance($customer) - (int) $customer->points;
        if ($excess <= 0) {
            return;
        }
        $lots = PointLot::where('customer_id', $customer->id)
            ->where('points_remaining', '>', 0)
            ->where('expires_at', '>', now())
            ->orderBy('expires_at')
            ->lockForUpdate()
            ->get();
        foreach ($lots as $lot) {
            if ($excess <= 0) break;
            $take = min($excess, (int) $lot->points_remaining);
            $lot->points_remaining -= $take;
            $lot->save();
            $excess -= $take;
        }
    }

    /**
     * Trừ điểm theo FIFO (lô sắp hết hạn trước), ghi 1 dòng point_transactions
     * MỖI LÔ kèm point_lot_id để hoàn điểm về đúng lô khi cần (spec 6.1).
     * Khách phải đã được lockForUpdate ở transaction ngoài. Trả về phân bổ.
     * @return array<int, array{lot_id:int, points:int}>
     */
    public function spendFifo(Customer $customer, int $points, string $type, string $note, ?int $orderId = null, ?int $exchangeItemId = null): array
    {
        $this->syncLotsToBalance($customer);
        if ($this->availablePoints($customer) < $points) {
            throw new Exception('Điểm của khách hàng không đủ.');
        }
        $lots = PointLot::where('customer_id', $customer->id)
            ->where('points_remaining', '>', 0)
            ->where('expires_at', '>', now())
            ->orderBy('expires_at')
            ->lockForUpdate()
            ->get();
        $allocation = [];
        $remaining = $points;
        foreach ($lots as $lot) {
            if ($remaining <= 0) break;
            $take = min($remaining, (int) $lot->points_remaining);
            $lot->points_remaining -= $take;
            $lot->save();
            $tx = PointTransaction::create([
                'customer_id' => $customer->id,
                'order_id' => $orderId,
                'point_lot_id' => $lot->id,
                'point_exchange_item_id' => $exchangeItemId,
                'change' => -$take,
                'type' => $type,
                'note' => $note,
            ]);
            $allocation[] = ['lot_id' => $lot->id, 'points' => $take, 'transaction_id' => $tx->id];
            $remaining -= $take;
        }
        $customer->points -= $points;
        $customer->save();
        return $allocation;
    }

    /** Hoàn điểm về ĐÚNG các lô đã trừ (giữ nguyên expires_at gốc — spec 6.1). */
    public function refundToLots(Customer $customer, array $allocation, string $note, array $extra = []): void
    {
        foreach ($allocation as $row) {
            $lot = PointLot::lockForUpdate()->find($row['lot_id']);
            if (!$lot) continue;
            $lot->points_remaining += (int) $row['points'];
            $lot->save();
            PointTransaction::create(array_merge([
                'customer_id' => $customer->id,
                'point_lot_id' => $lot->id,
                'change' => (int) $row['points'],
                'type' => 'adjust',
                'note' => $note,
            ], $extra));
            $customer->points += (int) $row['points'];
        }
        $customer->save();
    }

    /** Revoke: trừ vào lô của đơn gốc trước, thiếu thì trừ tiếp FIFO các lô khác. */
    private function deductFromOrderLotThenFifo(Customer $customer, int $points, int $orderId): void
    {
        $remaining = $points;
        $orderLots = PointLot::where('customer_id', $customer->id)
            ->where('source_order_id', $orderId)
            ->where('points_remaining', '>', 0)
            ->orderBy('expires_at')
            ->lockForUpdate()
            ->get();
        foreach ($orderLots as $lot) {
            if ($remaining <= 0) break;
            $take = min($remaining, (int) $lot->points_remaining);
            $lot->points_remaining -= $take;
            $lot->save();
            $remaining -= $take;
        }
        if ($remaining > 0) {
            $lots = PointLot::where('customer_id', $customer->id)
                ->where('points_remaining', '>', 0)
                ->where('expires_at', '>', now())
                ->orderBy('expires_at')
                ->lockForUpdate()
                ->get();
            foreach ($lots as $lot) {
                if ($remaining <= 0) break;
                $take = min($remaining, (int) $lot->points_remaining);
                $lot->points_remaining -= $take;
                $lot->save();
                $remaining -= $take;
            }
        }
        // Phần còn lại (nếu có) là số dư âm thuần sổ sách — customers.points đã
        // bị trừ ở revokeEarn, lô không còn gì để trừ: đúng hành vi Gói SEC.
    }

    /** Chi tiêu cửa sổ trượt: tổng total_amount đơn đã thanh toán, không hủy,
     *  có gắn khách, trong [now − window_days, now] (spec mục 3.1). Thời điểm
     *  thanh toán lấy theo paid_at nếu có, không thì updated_at của đơn paid. */
    public function windowSpent(Customer $customer, ?Carbon $at = null): float
    {
        $at = $at ?? now();
        $days = $this->config()['window_days'];
        return (float) Order::where('customer_id', $customer->id)
            ->where('payment_status', 'paid')
            ->where('status', '!=', 'cancelled')
            ->where(function ($q) use ($at, $days) {
                $from = $at->copy()->subDays($days);
                $q->where(function ($q2) use ($from, $at) {
                    $q2->whereNotNull('paid_at')->whereBetween('paid_at', [$from, $at]);
                })->orWhere(function ($q2) use ($from, $at) {
                    $q2->whereNull('paid_at')->whereBetween('updated_at', [$from, $at]);
                });
            })
            ->sum('total_amount');
    }

    /** Thứ hạng so sánh của 1 hạng (theo sort_order, dự phòng min_spent_window). */
    private function tierRank(MembershipTier $tier): float
    {
        return (float) $tier->min_spent_window * 1000 + (float) $tier->sort_order;
    }

    /**
     * Xét LÊN hạng tức thì sau khi thanh toán (spec 3.2): đạt ngưỡng lên của
     * hạng cao hơn → lên ngay + log earn_threshold + phát coupon chào hạng nếu
     * Admin đã cấu hình setting tier_up_promotion_id (trống = không phát).
     */
    public function evaluateUpgrade(Customer $customer): void
    {
        $current = $customer->tier;
        $spent = $this->windowSpent($customer);
        $best = MembershipTier::where('min_spent_window', '<=', $spent)
            ->orderByDesc('min_spent_window')
            ->orderByDesc('sort_order')
            ->first();
        if (!$best) {
            return;
        }
        if ($current && $this->tierRank($best) <= $this->tierRank($current)) {
            return;
        }
        $fromId = $customer->membership_tier_id;
        $customer->membership_tier_id = $best->id;
        $customer->tier_warning_at = null;
        $customer->tier_projected_id = null;
        $customer->save();

        CustomerTierLog::create([
            'customer_id' => $customer->id,
            'from_tier_id' => $fromId,
            'to_tier_id' => $best->id,
            'reason' => 'earn_threshold',
            'window_spent' => $spent,
        ]);

        $promoId = (int) Setting::get('tier_up_promotion_id', 0);
        if ($promoId > 0) {
            $promo = \App\Models\Promotion::find($promoId);
            if ($promo) {
                app(AutoIssueCouponService::class)->issue($customer, $promo, 'tier_up');
            }
        }
    }

    /** Hạng "đáng giữ" cao nhất theo chi tiêu cửa sổ (spec 3.3 bước 1). */
    public function keepTierFor(float $windowSpent): ?MembershipTier
    {
        $best = null;
        foreach (MembershipTier::orderBy('sort_order')->get() as $tier) {
            if ($windowSpent + 0.001 >= $tier->effectiveKeepSpent()) {
                if (!$best || $this->tierRank($tier) > $this->tierRank($best)) {
                    $best = $tier;
                }
            }
        }
        // Hạng mặc định luôn giữ được kể cả khi ngưỡng giữ > 0 do cấu hình lạ
        return $best ?? MembershipTier::where('is_default', true)->first();
    }

    /**
     * Ngày deadline giữ hạng: ngày mà nếu khách không mua thêm, chi tiêu cửa
     * sổ sẽ rơi xuống dưới ngưỡng giữ của hạng HIỆN TẠI (trượt cửa sổ qua các
     * đơn đã thanh toán trong cửa sổ, cộng dồn từ cũ nhất). Null = chưa xác
     * định được (không có đơn nào trong cửa sổ / đã dưới ngưỡng ngay hôm nay).
     */
    public function keepDeadline(Customer $customer, float $keepThreshold): ?string
    {
        $days = $this->config()['window_days'];
        $orders = Order::where('customer_id', $customer->id)
            ->where('payment_status', 'paid')
            ->where('status', '!=', 'cancelled')
            ->where(function ($q) use ($days) {
                $from = now()->subDays($days);
                $q->where(function ($q2) use ($from) {
                    $q2->whereNotNull('paid_at')->where('paid_at', '>=', $from);
                })->orWhere(function ($q2) use ($from) {
                    $q2->whereNull('paid_at')->where('updated_at', '>=', $from);
                });
            })
            ->get(['total_amount', 'paid_at', 'updated_at'])
            ->map(fn ($o) => ['amount' => (float) $o->total_amount, 'at' => $o->paid_at ?? $o->updated_at])
            ->sortBy('at')
            ->values();
        $spent = (float) $orders->sum('amount');
        if ($spent < $keepThreshold) {
            return null;
        }
        foreach ($orders as $o) {
            $spent -= $o['amount'];
            if ($spent < $keepThreshold) {
                // Đơn này rời cửa sổ vào ngày at + window_days → deadline là ngày đó
                return Carbon::parse($o['at'])->addDays($days)->toDateString();
            }
        }
        return null;
    }

    /**
     * Payload loyalty cho Mini App (spec mục 8): hạng + điểm + sắp hết hạn +
     * tiến trình lên/giữ hạng theo cửa sổ + bảng lợi ích mọi hạng. Nguồn dữ
     * liệu duy nhất cho trang Tài khoản — Admin sửa cấu hình là app đổi theo.
     */
    public function loyaltyPayload(Customer $customer): array
    {
        $cfg = $this->config();
        $tier = $customer->tier;
        $spent = $this->windowSpent($customer);
        $expiring = $this->expiringSoon($customer);
        $tiers = MembershipTier::orderBy('sort_order')->orderBy('min_spent_window')->get();
        $currentRank = $tier ? $this->tierRank($tier) : -1;

        $next = null;
        foreach ($tiers as $t) {
            if ($this->tierRank($t) > $currentRank && (float) $t->min_spent_window > $spent) {
                if (!$next || (float) $t->min_spent_window < (float) $next->min_spent_window) {
                    $next = $t;
                }
            }
        }

        $isDefault = $tier ? (bool) $tier->is_default : true;
        $keepThreshold = $tier ? $tier->effectiveKeepSpent() : 0;
        $keepRemaining = max(0, $keepThreshold - $spent);
        $atRisk = !$isDefault && ($customer->tier_warning_at !== null || $keepRemaining > 0);
        $deadline = null;
        if ($atRisk) {
            $deadline = $this->keepDeadline($customer, $keepThreshold);
            if (!$deadline && $customer->tier_warning_at) {
                // Đã dưới ngưỡng ngay: mốc tụt sớm nhất = hết thời gian báo trước
                $deadline = $customer->tier_warning_at->copy()->addDays($cfg['downgrade_notice_days'])->toDateString();
            }
        }

        $justUpgraded = null;
        $lastUp = CustomerTierLog::with('toTier')
            ->where('customer_id', $customer->id)
            ->where('reason', 'earn_threshold')
            ->where('created_at', '>=', now()->subDays(7))
            ->orderByDesc('id')
            ->first();
        if ($lastUp && $lastUp->toTier && $tier && $lastUp->to_tier_id === $tier->id) {
            $justUpgraded = $lastUp->toTier->name;
        }

        return [
            'tier_code' => $tier?->code,
            'tier_name' => $tier?->name,
            'points' => $this->availablePoints($customer),
            'points_balance' => (int) $customer->points,
            'points_expiring_soon' => $expiring['points'],
            'points_expire_next_date' => $expiring['next_date'],
            'point_value' => $cfg['point_value'],
            'points_event' => $this->activeDoubleDaysEvent($tier),
            'window_days' => $cfg['window_days'],
            'window_spent' => (int) round($spent),
            'next_tier' => $next ? [
                'name' => $next->name,
                'threshold' => (int) $next->min_spent_window,
                'remaining' => (int) max(0, (float) $next->min_spent_window - $spent),
            ] : null,
            'keep' => [
                'threshold' => (int) $keepThreshold,
                'remaining' => (int) $keepRemaining,
                'status' => $atRisk ? 'at_risk' : 'safe',
                'deadline_date' => $deadline,
            ],
            'just_upgraded_to' => $justUpgraded,
            'tiers' => $tiers->map(fn ($t) => [
                'code' => $t->code,
                'name' => $t->name,
                'earn_multiplier' => (float) $t->earn_multiplier,
                'points_discount_pct' => (int) $t->points_discount_pct,
                'benefits' => $t->benefits ?? [],
                'min_spent_window' => (int) $t->min_spent_window,
                'keep_spent_window' => (int) $t->effectiveKeepSpent(),
                'is_current' => $tier && $t->id === $tier->id,
            ])->values(),
        ];
    }

    /**
     * Fix L1 (2026-10-21, Đại Vương phán SỬA theo spec §1.5/§2.1): cấu hình
     * Double Days đọc từ khóa MỚI double_points_* (enabled/start/end/
     * multiplier). Máy đã áp Loyalty 2.0 trước fix này có thể còn cấu hình ở
     * khóa CŨ double_days_* → đọc fallback khóa cũ khi khóa mới chưa có.
     * Lưu cấu hình (MembershipTierController) ghi khóa mới + xóa khóa cũ.
     * double_points_enabled chưa từng lưu → suy từ hành vi cũ: có cửa sổ
     * ngày = đang bật (giữ nguyên sự kiện đang chạy, không tắt oan).
     */
    public static function doublePointsSettings(): array
    {
        $start = Setting::get('double_points_start') ?: Setting::get('double_days_start');
        $end = Setting::get('double_points_end') ?: Setting::get('double_days_end');
        $mult = Setting::get('double_points_multiplier');
        if ($mult === null || $mult === '') {
            $mult = Setting::get('double_days_multiplier', 2);
        }
        $enabled = Setting::get('double_points_enabled');
        if ($enabled === null) {
            $enabled = $start ? '1' : '0';
        }
        return [
            'enabled' => filter_var($enabled, FILTER_VALIDATE_BOOLEAN),
            'start' => $start ?: null,
            'end' => $end ?: null,
            'multiplier' => (float) $mult,
        ];
    }

    /**
     * Sự kiện Double Days đang hiệu lực cho hạng này (null nếu không có):
     * công tắc double_points_enabled phải BẬT, hạng phải có cờ
     * benefits.double_points_day và now nằm trong cửa sổ settings
     * double_points_start/end (hỗ trợ cả giá trị ngày lẫn ngày–giờ).
     * Tắt công tắc = sự kiện ngưng ngay dù còn trong khoảng ngày.
     */
    public function activeDoubleDaysEvent(?MembershipTier $tier): ?array
    {
        if (!$tier) {
            return null;
        }
        $benefits = $tier->benefits ?? [];
        if (empty($benefits['double_points_day'])) {
            return null;
        }
        $dd = self::doublePointsSettings();
        $start = $dd['start'];
        $end = $dd['end'];
        $mult = $dd['multiplier'];
        if (!$dd['enabled'] || !$start || !$end || $mult <= 1) {
            return null;
        }
        try {
            $startAt = \Carbon\Carbon::parse($start);
            if (strlen((string) $start) <= 10) {
                $startAt->startOfDay();
            }
            $endAt = \Carbon\Carbon::parse($end);
            if (strlen((string) $end) <= 10) {
                $endAt->endOfDay();
            }
        } catch (\Exception $e) {
            return null;
        }
        $now = now();
        if ($now->lt($startAt) || $now->gt($endAt)) {
            return null;
        }
        return [
            'multiplier' => $mult,
            'starts_at' => $startAt->toDateTimeString(),
            'ends_at' => $endAt->toDateTimeString(),
        ];
    }

    public function doubleDaysMultiplier(?MembershipTier $tier): float
    {
        $event = $this->activeDoubleDaysEvent($tier);
        return $event ? (float) $event['multiplier'] : 1.0;
    }
}

