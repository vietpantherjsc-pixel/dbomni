<?php

namespace App\Console\Commands;

use App\Models\DeliveryLog;
use Illuminate\Console\Command;

// Gói 61b: Xóa log giao hàng cũ hơn 30 ngày (checklist #17: giữ tối thiểu 30 ngày).
// Chạy mỗi ngày lúc 02:00 qua scheduler.
class PruneDeliveryLogs extends Command
{
    protected $signature = 'delivery:prune-logs {--days=30 : Số ngày giữ log}';
    protected $description = 'Xóa log giao hàng cũ hơn N ngày';

    public function handle(): int
    {
        $days = max(1, (int) $this->option('days'));
        $count = DeliveryLog::where('created_at', '<', now()->subDays($days))->delete();
        $this->info("Đã xóa {$count} log giao hàng cũ hơn {$days} ngày.");
        return 0;
    }
}
