<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// F5 (Đại Vương phán 2026-11-05): đơn xin nghỉ bị từ chối phải CÓ lý do như
// đơn đổi ca (shift_swap_requests.reject_reason có từ migration 000068).
// Thêm cột reject_reason cho CẢ hai họ đơn nghỉ: leave_requests (nghỉ phép)
// và shift_leave_requests (nghỉ theo ca) — hai controller riêng, cùng thiếu.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('leave_requests') && !Schema::hasColumn('leave_requests', 'reject_reason')) {
            Schema::table('leave_requests', function (Blueprint $table) {
                $table->string('reject_reason', 500)->nullable()->after('status');
            });
        }
        if (Schema::hasTable('shift_leave_requests') && !Schema::hasColumn('shift_leave_requests', 'reject_reason')) {
            Schema::table('shift_leave_requests', function (Blueprint $table) {
                $table->string('reject_reason', 500)->nullable()->after('status');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('leave_requests') && Schema::hasColumn('leave_requests', 'reject_reason')) {
            Schema::table('leave_requests', function (Blueprint $table) {
                $table->dropColumn('reject_reason');
            });
        }
        if (Schema::hasTable('shift_leave_requests') && Schema::hasColumn('shift_leave_requests', 'reject_reason')) {
            Schema::table('shift_leave_requests', function (Blueprint $table) {
                $table->dropColumn('reject_reason');
            });
        }
    }
};
