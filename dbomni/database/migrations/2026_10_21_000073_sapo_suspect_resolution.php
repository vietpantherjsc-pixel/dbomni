<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// =====================================================================
// Cầu nối Sapo — Phần D (2026-10-21): trường xử lý cho hàng đợi "nghi ngờ".
// Trạng thái: pending → resolved (đã import được / xác nhận là đơn mới)
// hoặc discarded (quản lý xác nhận bỏ qua, có ghi lý do).
// resolved_by / resolved_at: ai xử lý, khi nào — chống chạy lại lần 2.
// =====================================================================
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('sapo_import_suspects', 'resolved_by')) {
            Schema::table('sapo_import_suspects', function (Blueprint $table) {
                $table->foreignId('resolved_by')->nullable()->after('resolved_order_id')
                    ->constrained('users')->nullOnDelete();
            });
        }
        if (!Schema::hasColumn('sapo_import_suspects', 'resolved_at')) {
            Schema::table('sapo_import_suspects', function (Blueprint $table) {
                $table->timestamp('resolved_at')->nullable()->after('resolved_by');
            });
        }
        if (!Schema::hasColumn('sapo_import_suspects', 'resolution')) {
            Schema::table('sapo_import_suspects', function (Blueprint $table) {
                $table->string('resolution', 255)->nullable()->after('resolved_at')
                    ->comment('Ghi chú xử lý của quản lý (lý do bỏ qua / xác nhận)');
            });
        }
    }

    public function down(): void
    {
        foreach (['resolution', 'resolved_at', 'resolved_by'] as $col) {
            if (Schema::hasColumn('sapo_import_suspects', $col)) {
                Schema::table('sapo_import_suspects', function (Blueprint $table) use ($col) {
                    $table->dropColumn($col);
                });
            }
        }
    }
};
