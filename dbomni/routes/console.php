<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Gói 55: tự động đổ giờ chấm công vào bảng lương mỗi ngày lúc 23:30
Schedule::command('salary:auto-import')->dailyAt('23:30');

// Spec KDS book ship mục 4 (2026-11-06): failover TỰ ĐỘNG đã TẮT — quá
// ngưỡng chưa có tài xế thì KDS cảnh báo và NV quyết chuyển tay tại quầy,
// hệ thống không tự hủy hãng cũ/tạo hãng mới nữa. Lệnh delivery:check-failover
// + code failover + báo cáo failover GIỮ NGUYÊN để đối soát lịch sử, chỉ gỡ
// điểm chạy theo lịch này.

// Gói 61b: dọn log giao hàng cũ hơn 30 ngày (mỗi ngày lúc 02:00)
Schedule::command('delivery:prune-logs')->dailyAt('02:00');

// SPEC-02: cấp coupon theo lịch (CP-06, CP-07) — mỗi đêm lúc 01:00
Schedule::command('coupons:issue-scheduled')->dailyAt('01:00');

// Loyalty 2.0 (2026-10-21): trừ điểm hết hạn theo lô + xét xuống hạng theo
// cửa sổ trượt — cùng khung 01:00. (loyalty:migrate-lots chạy TAY 1 lần sau
// deploy, không đăng ký lịch.)
Schedule::command('loyalty:expire-points')->dailyAt('01:00');
Schedule::command('loyalty:evaluate-tiers')->dailyAt('01:00');

// Minigame (2026-11-01): dọn ảnh thẻ chia sẻ kết quả quá 30 ngày
Schedule::command('minigame:clean-share-cards')->dailyAt('02:30');

// Cầu nối Sapo — Phần C: quét mail xuất file sau 3 khung giờ nhân viên xuất
// (12:30 / 21:00 / 22:30) → 13:00 / 21:30 / 23:00, import theo anchor text → chi nhánh
Schedule::command('sapo:check-mail --scheduled')->dailyAt('13:00');
Schedule::command('sapo:check-mail --scheduled')->dailyAt('21:30');
Schedule::command('sapo:check-mail --scheduled')->dailyAt('23:00');
