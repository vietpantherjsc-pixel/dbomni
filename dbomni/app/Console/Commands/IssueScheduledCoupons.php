<?php

namespace App\Console\Commands;

use App\Services\AutoIssueCouponService;
use Illuminate\Console\Command;

// SPEC-02: Cron đêm — cấp coupon CP-06 (14 ngày không đơn) + CP-07 (sinh nhật).
class IssueScheduledCoupons extends Command
{
    protected $signature = 'coupons:issue-scheduled';
    protected $description = 'Cấp coupon theo lịch: CP-06 (không đơn 14 ngày), CP-07 (sinh nhật)';

    public function handle(AutoIssueCouponService $service): int
    {
        $inactive = $service->checkInactiveCustomers();
        $birthday = $service->checkBirthdays();
        $this->info("Đã cấp: {$inactive} coupon CP-06, {$birthday} coupon CP-07.");
        return 0;
    }
}
