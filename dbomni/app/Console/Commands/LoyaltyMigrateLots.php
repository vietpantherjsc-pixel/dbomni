<?php

namespace App\Console\Commands;

use App\Models\Customer;
use App\Models\PointLot;
use App\Services\LoyaltyService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

// Loyalty 2.0 (2026-10-21): tạo lô ân hạn cho toàn bộ số dư điểm hiện hữu —
// chạy TAY 1 lần ngay sau khi deploy gói (spec mục 5.3). Idempotent: khách
// đã có lô migration thì bỏ qua. In đối chiếu tổng điểm trước/sau để ghi
// vào MANIFEST nghiệm thu.
class LoyaltyMigrateLots extends Command
{
    protected $signature = 'loyalty:migrate-lots';
    protected $description = 'Loyalty 2.0: chuyển số dư điểm hiện hữu của mỗi khách thành 1 lô ân hạn (HSD theo cấu hình)';

    public function handle(LoyaltyService $loyalty): int
    {
        $totalBefore = (int) Customer::sum('points');
        $created = 0;
        $skippedZero = 0;
        $skippedDone = 0;
        $pointsMigrated = 0;

        Customer::where('points', '>', 0)->chunkById(200, function ($customers) use ($loyalty, &$created, &$pointsMigrated) {
            foreach ($customers as $customer) {
                DB::transaction(function () use ($customer, $loyalty, &$created, &$pointsMigrated) {
                    $locked = Customer::lockForUpdate()->find($customer->id);
                    if (!$locked || $locked->points <= 0) {
                        return;
                    }
                    $exists = PointLot::where('customer_id', $locked->id)
                        ->where('source_type', 'migration')
                        ->exists();
                    if ($exists) {
                        return;
                    }
                    $loyalty->createLot($locked, (int) $locked->points, 'migration');
                    $created++;
                    $pointsMigrated += (int) $locked->points;
                });
            }
        });

        $skippedZero = Customer::where('points', '<=', 0)->count();
        $skippedDone = PointLot::where('source_type', 'migration')->count() - $created;
        $totalAfter = (int) Customer::sum('points');

        $this->info("Tổng điểm toàn hệ thống trước: {$totalBefore}");
        $this->info("Tổng điểm toàn hệ thống sau:   {$totalAfter}");
        $this->info("Đã tạo {$created} lô ân hạn, tổng {$pointsMigrated} điểm.");
        $this->info("Bỏ qua: {$skippedZero} khách có điểm <= 0 (không tạo lô), {$skippedDone} khách đã có lô migration từ lần chạy trước.");
        if ($totalBefore !== $totalAfter) {
            $this->error('LỆCH TỔNG ĐIỂM trước/sau — kiểm tra ngay!');
            return 1;
        }
        return 0;
    }
}
