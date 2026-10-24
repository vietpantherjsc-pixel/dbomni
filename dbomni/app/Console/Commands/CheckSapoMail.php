<?php

namespace App\Console\Commands;

use App\Services\Sapo\SapoMailService;
use Illuminate\Console\Command;

// Cầu nối Sapo — Phần C (2026-10-21): quét hộp mail Sapo qua IMAP → import tự động.
// Lịch chạy khai trong routes/console.php: 13:00 / 21:30 / 23:00 (sau 3 khung giờ
// nhân viên xuất file 12:30 / 21:00 / 22:30). Chạy lịch dùng --scheduled để bật
// cảnh báo "chưa thấy mail" khi qua khung giờ mà không có mail xuất file nào.
class CheckSapoMail extends Command
{
    protected $signature = 'sapo:check-mail {--scheduled : Chạy theo lịch (bật cảnh báo khi không thấy mail)}';
    protected $description = 'Quét hộp mail Sapo (IMAP), tải file xuất và import vào DBOMNI theo chi nhánh qua anchor text';

    public function handle(SapoMailService $service): int
    {
        $summary = $service->check((bool) $this->option('scheduled'));
        if (!empty($summary['error'])) {
            $this->error($summary['error']);
            return 1;
        }
        $this->info(sprintf(
            'Đã quét %d mail, %d mail Sapo, import %d, anchor không khớp %d, hết hạn %d, lỗi %d.',
            $summary['scanned'],
            $summary['candidates'],
            $summary['imported'],
            $summary['anchor_unmatched'],
            $summary['expired'],
            $summary['errors']
        ));
        return 0;
    }
}
