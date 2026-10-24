<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec P4-B1/B2 (Đại Vương chốt 2026-10-19): chốt + khóa kỳ lương.
// - payroll_locks: 1 dòng/tháng đã chốt (kèm tổng thực nhận + link phiếu chi tự sinh).
// - payroll_lock_logs: lịch sử chốt/mở khóa (người + lý do).
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('payroll_locks')) {
            Schema::create('payroll_locks', function (Blueprint $table) {
                $table->id();
                $table->char('month', 7)->unique()->comment('YYYY-MM');
                $table->timestamp('locked_at');
                $table->unsignedBigInteger('locked_by')->nullable();
                $table->decimal('net_total', 15, 0)->default(0)->comment('Tổng thực nhận toàn NV lúc chốt');
                $table->unsignedBigInteger('voucher_id')->nullable()->comment('Phiếu chi tự sinh (transactions.id)');
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('payroll_lock_logs')) {
            Schema::create('payroll_lock_logs', function (Blueprint $table) {
                $table->id();
                $table->char('month', 7)->comment('YYYY-MM');
                $table->string('action', 10)->comment('lock|unlock');
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('reason', 500)->nullable();
                $table->timestamp('created_at')->useCurrent();
                $table->index('month');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_lock_logs');
        Schema::dropIfExists('payroll_locks');
    }
};
