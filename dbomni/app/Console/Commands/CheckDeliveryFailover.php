<?php

namespace App\Console\Commands;

use App\Services\Delivery\DeliveryService;
use Illuminate\Console\Command;

// Gói 60 (2026-10-17): Quét đơn quá ngưỡng chưa có tài xế → failover sang hãng dự phòng.
// Chạy mỗi phút qua scheduler. Mỗi đơn chỉ failover tối đa 1 lần.
class CheckDeliveryFailover extends Command
{
    protected $signature = 'delivery:check-failover';
    protected $description = 'Failover đơn giao quá ngưỡng chưa có tài xế sang hãng dự phòng';

    public function handle(DeliveryService $service): int
    {
        try {
            $count = $service->checkFailover();
            $this->info("Đã failover {$count} đơn.");
            return 0;
        } catch (\Throwable $e) {
            $this->error('Lỗi: ' . $e->getMessage());
            return 1;
        }
    }
}
