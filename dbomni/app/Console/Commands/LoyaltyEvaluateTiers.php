<?php

namespace App\Console\Commands;

use App\Models\Customer;
use App\Models\CustomerTierLog;
use App\Models\MembershipTier;
use App\Services\LoyaltyService;
use Illuminate\Console\Command;

// Loyalty 2.0 (2026-10-21): cron đêm — xét XUỐNG hạng theo cửa sổ trượt có
// báo trước (spec mục 3.3). Chạy cùng khung 01:00 với coupons:issue-scheduled.
// Quy trình mỗi khách trên hạng mặc định:
// - Đang được bảo vệ hạng tay (tier_manual_until chưa qua) → bỏ qua.
// - Chi tiêu cửa sổ đủ giữ hạng hiện tại → thoát nguy cơ (nếu đang có).
// - Chưa đủ: vào/giữ trạng thái nguy cơ (tier_warning_at + tier_projected_id).
// - Đã nguy cơ đủ số ngày báo trước mà vẫn chưa đủ → tụt ĐÚNG 1 bậc + log.
// Ân hạn chu kỳ đầu (tier_grace_first_cycle): chỉ ghi nhận nguy cơ, không tụt.
class LoyaltyEvaluateTiers extends Command
{
    protected $signature = 'loyalty:evaluate-tiers';
    protected $description = 'Loyalty 2.0: xét xuống hạng theo cửa sổ trượt (báo trước, tụt từng bậc)';

    public function handle(LoyaltyService $loyalty): int
    {
        $cfg = $loyalty->config();
        $noticeDays = $cfg['downgrade_notice_days'];
        $defaultTier = MembershipTier::where('is_default', true)->first();

        // Ân hạn chu kỳ đầu: từ mốc bật Loyalty 2.0 tới hết 1 cửa sổ đầu tiên
        $inGrace = false;
        if ($cfg['grace_first_cycle'] && $cfg['started_at']) {
            $graceEnd = \Carbon\Carbon::parse($cfg['started_at'])->addDays($cfg['window_days']);
            $inGrace = now()->lt($graceEnd);
        }

        $tiersAsc = MembershipTier::orderBy('sort_order')->orderBy('min_spent_window')->get();
        $warned = 0;
        $cleared = 0;
        $downgraded = 0;

        Customer::whereNotNull('membership_tier_id')
            ->when($defaultTier, fn ($q) => $q->where('membership_tier_id', '!=', $defaultTier->id))
            ->chunkById(200, function ($customers) use ($loyalty, $tiersAsc, $noticeDays, $inGrace, &$warned, &$cleared, &$downgraded) {
                foreach ($customers as $customer) {
                    // Hạng gán tay còn trong thời gian bảo vệ → cron không đụng
                    if ($customer->tier_manual_until && now()->lt($customer->tier_manual_until)) {
                        continue;
                    }
                    $current = $tiersAsc->firstWhere('id', $customer->membership_tier_id);
                    if (!$current) {
                        continue;
                    }
                    $spent = $loyalty->windowSpent($customer);
                    $keepTier = $loyalty->keepTierFor($spent);
                    $currentRank = (float) $current->min_spent_window * 1000 + (float) $current->sort_order;
                    $keepRank = $keepTier ? (float) $keepTier->min_spent_window * 1000 + (float) $keepTier->sort_order : -1;

                    if ($keepRank >= $currentRank) {
                        // Đủ giữ hạng → thoát nguy cơ nếu đang có
                        if ($customer->tier_warning_at) {
                            $customer->tier_warning_at = null;
                            $customer->tier_projected_id = null;
                            $customer->save();
                            $cleared++;
                        }
                        continue;
                    }

                    // Chưa đủ giữ → trạng thái nguy cơ
                    if (!$customer->tier_warning_at) {
                        $customer->tier_warning_at = now();
                        $customer->tier_projected_id = $keepTier?->id;
                        $customer->save();
                        $warned++;
                        continue;
                    }
                    $customer->tier_projected_id = $keepTier?->id;

                    $warnedDays = $customer->tier_warning_at->diffInDays(now());
                    if ($warnedDays < $noticeDays) {
                        $customer->save();
                        continue;
                    }
                    if ($inGrace) {
                        // Chu kỳ đầu: chỉ ghi nhận nguy cơ để tham khảo, không tụt ai
                        $customer->save();
                        continue;
                    }

                    // Tụt ĐÚNG 1 bậc: hạng ngay dưới hạng hiện tại theo thứ tự
                    $oneDown = null;
                    foreach ($tiersAsc as $t) {
                        $rank = (float) $t->min_spent_window * 1000 + (float) $t->sort_order;
                        if ($rank < $currentRank && (!$oneDown || $rank > (float) $oneDown->min_spent_window * 1000 + (float) $oneDown->sort_order)) {
                            $oneDown = $t;
                        }
                    }
                    if (!$oneDown) {
                        $customer->save();
                        continue;
                    }
                    $fromId = $customer->membership_tier_id;
                    $customer->membership_tier_id = $oneDown->id;
                    $customer->tier_warning_at = null;
                    $customer->tier_projected_id = null;
                    $customer->save();
                    CustomerTierLog::create([
                        'customer_id' => $customer->id,
                        'from_tier_id' => $fromId,
                        'to_tier_id' => $oneDown->id,
                        'reason' => 'window_drop',
                        'window_spent' => $spent,
                    ]);
                    $downgraded++;
                }
            });

        $this->info("Xét hạng đêm: {$warned} khách vào nguy cơ, {$cleared} thoát nguy cơ, {$downgraded} tụt 1 bậc" . ($inGrace ? ' (đang ân hạn chu kỳ đầu — không tụt ai)' : '') . '.');
        return 0;
    }
}
