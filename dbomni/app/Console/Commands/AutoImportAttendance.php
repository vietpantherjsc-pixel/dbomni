<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\SalaryController;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Carbon\Carbon;

// Gói 55: tự động đổ giờ chấm công vào bảng lương (chạy hàng ngày qua scheduler)
// Quy tắc: giờ thực tế; quên chấm → để trống; nghỉ duyệt → 0h; không ghi đè nhập tay
class AutoImportAttendance extends Command
{
    protected $signature = 'salary:auto-import {--month= : Tháng YYYY-MM (mặc định tháng hiện tại)}';
    protected $description = 'Tự động đổ giờ chấm công vào bảng lương';

    public function handle(): int
    {
        $month = $this->option('month') ?: Carbon::now()->format('Y-m');
        $this->info("Đang đổ giờ công tháng {$month}...");

        $controller = app(SalaryController::class);
        $request = Request::create('/api/salary/import-attendance', 'POST', ['month' => $month]);

        try {
            $response = $controller->importAttendance($request);
            $data = json_decode($response->getContent(), true);
            $s = $data['data'] ?? [];
            $this->info("Xong: {$s['imported']} ngày đổ giờ, {$s['leave']} ngày nghỉ, {$s['incomplete']} thiếu chấm, {$s['skipped_manual']} giữ nhập tay.");
            return 0;
        } catch (\Throwable $e) {
            $this->error('Lỗi: ' . $e->getMessage());
            return 1;
        }
    }
}
