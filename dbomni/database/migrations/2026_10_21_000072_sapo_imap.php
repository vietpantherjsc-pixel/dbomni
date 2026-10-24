<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// =====================================================================
// Cầu nối Sapo — Phần C (2026-10-21): nhật ký kiểm tra mail IMAP.
// Mỗi mail ứng viên được ghi 1 dòng (message_uid = "folder:uid", UNIQUE chống
// xử lý trùng): imported | anchor_unmatched | expired | no_link | error.
// Cảnh báo vận hành không gắn với mail cụ thể (status = no_mail: qua khung giờ
// mà không thấy mail xuất file; error kết nối) cũng ghi vào đây để Admin thấy.
// Cấu hình IMAP lưu trong settings (key sapo_imap_*; mật khẩu mã hóa Crypt).
// =====================================================================
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('sapo_mail_logs')) {
            Schema::create('sapo_mail_logs', function (Blueprint $table) {
                $table->id();
                $table->string('message_uid', 120)->unique()->comment('folder:uid của mail, hoặc slot-YYYYMMDD-HHmm cho cảnh báo theo khung giờ');
                $table->string('subject', 255)->nullable();
                $table->string('sender', 255)->nullable();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->string('status', 30)->comment('imported | anchor_unmatched | expired | no_link | no_mail | error');
                $table->text('detail')->nullable();
                $table->foreignId('run_id')->nullable()->constrained('sapo_import_runs')->nullOnDelete();
                $table->timestamp('received_at')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sapo_mail_logs');
    }
};
