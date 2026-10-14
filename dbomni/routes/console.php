<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Gói 55: tự động đổ giờ chấm công vào bảng lương mỗi ngày lúc 23:30
Schedule::command('salary:auto-import')->dailyAt('23:30');
