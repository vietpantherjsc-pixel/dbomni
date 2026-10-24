<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\SalaryController;
use App\Models\PayrollLock;
use App\Models\PayrollLockSnapshot;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

// Bổ sung Mảng 4 theo rà soát TESTER (A4-4 backfill): sinh snapshot cho các kỳ
// lương đã chốt TRƯỚC khi có bảng payroll_lock_snapshots (migration 000084).
// Chạy TAY 1 lần sau khi migrate: php artisan payroll:backfill-lock-snapshots
// - Số liệu lấy theo tính LIVE tại thời điểm chạy lệnh và đóng băng từ đó.
// - Idempotent: kỳ đã có snapshot thì bỏ qua, chạy lại không tạo trùng.
class BackfillPayrollLockSnapshots extends Command
{
    protected $signature = 'payroll:backfill-lock-snapshots';

    protected $description = 'Sinh snapshot lương cho các kỳ đã chốt trước migration 000084 (chạy tay 1 lần)';

    public function handle(): int
    {
        if (!Schema::hasTable('payroll_locks') || !Schema::hasTable('payroll_lock_snapshots')) {
            $this->error('Thiếu bảng payroll_locks/payroll_lock_snapshots — hãy chạy migrate trước.');
            return self::FAILURE;
        }

        $locks = PayrollLock::orderBy('month')->get();
        if ($locks->isEmpty()) {
            $this->info('Chưa có kỳ lương nào đã chốt.');
            return self::SUCCESS;
        }

        $controller = app(SalaryController::class);
        $done = [];
        $skipped = [];
        foreach ($locks as $lock) {
            $has = PayrollLockSnapshot::where('lock_id', $lock->id)->where('kind', 'detail')->exists();
            if ($has) {
                $skipped[] = $lock->month;
                continue;
            }
            [$rows] = $controller->buildPayrollData($lock->month, null);
            if (empty($rows)) {
                $this->warn("Kỳ {$lock->month}: không có dữ liệu lương để sinh snapshot, bỏ qua.");
                $skipped[] = $lock->month . ' (không dữ liệu)';
                continue;
            }
            $controller->persistLockSnapshots($lock, $lock->month, $rows, null);
            $done[] = $lock->month;
        }

        if ($done) {
            $this->info('Đã backfill snapshot cho các kỳ: ' . implode(', ', $done));
        }
        if ($skipped) {
            $this->line('Bỏ qua (đã có snapshot hoặc không dữ liệu): ' . implode(', ', $skipped));
        }
        if (!$done && !$skipped) {
            $this->info('Không có kỳ nào cần xử lý.');
        }
        return self::SUCCESS;
    }
}
