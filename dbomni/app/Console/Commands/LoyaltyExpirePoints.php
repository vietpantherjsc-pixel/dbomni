<?php

namespace App\Console\Commands;

use App\Models\Customer;
use App\Models\PointLot;
use App\Models\PointTransaction;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

// Loyalty 2.0 (2026-10-21): cron đêm — điểm hết hạn theo lô (spec mục 5.2).
// Idempotent: lô đã về 0 thì không trừ lại. Chạy cùng khung 01:00 với
// coupons:issue-scheduled (đăng ký trong routes/console.php).
class LoyaltyExpirePoints extends Command
{
    protected $signature = 'loyalty:expire-points';
    protected $description = 'Loyalty 2.0: trừ điểm của các lô đã qua hạn dùng, ghi transaction type=expire';

    public function handle(): int
    {
        $expiredLots = 0;
        $expiredPoints = 0;

        PointLot::where('expires_at', '<', now())
            ->where('points_remaining', '>', 0)
            ->chunkById(200, function ($lots) use (&$expiredLots, &$expiredPoints) {
                foreach ($lots as $lot) {
                    DB::transaction(function () use ($lot, &$expiredLots, &$expiredPoints) {
                        $lockedLot = PointLot::lockForUpdate()->find($lot->id);
                        if (!$lockedLot || $lockedLot->points_remaining <= 0) {
                            return;
                        }
                        $amount = (int) $lockedLot->points_remaining;
                        $customer = Customer::lockForUpdate()->find($lockedLot->customer_id);
                        if ($customer) {
                            $customer->points -= $amount;
                            $customer->save();
                        }
                        PointTransaction::create([
                            'customer_id' => $lockedLot->customer_id,
                            'point_lot_id' => $lockedLot->id,
                            'change' => -$amount,
                            'type' => 'expire',
                            'note' => "Điểm hết hạn (lô #{$lockedLot->id}, tích ngày {$lockedLot->earned_at->toDateString()})",
                        ]);
                        $lockedLot->points_remaining = 0;
                        $lockedLot->save();
                        $expiredLots++;
                        $expiredPoints += $amount;
                    });
                }
            });

        $this->info("Đã hết hạn {$expiredLots} lô, tổng {$expiredPoints} điểm.");
        return 0;
    }
}
