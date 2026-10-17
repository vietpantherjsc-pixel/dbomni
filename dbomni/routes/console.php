<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Gói 55: tự động đổ giờ chấm công vào bảng lương mỗi ngày lúc 23:30
Schedule::command('salary:auto-import')->dailyAt('23:30');

// Gói 60: quét đơn giao quá ngưỡng chưa có tài xế → failover hãng dự phòng (mỗi phút)
Schedule::command('delivery:check-failover')->everyMinute();

// Gói 61b: dọn log giao hàng cũ hơn 30 ngày (mỗi ngày lúc 02:00)
Schedule::command('delivery:prune-logs')->dailyAt('02:00');
