<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói "Chờ duyệt trên Hub" — TESTER fix 🟡d (2026-10-21): ghi vết NV hủy
// phiếu kho (nhập/xuất/chuyển draft) để hiện trong "Đã xử lý hôm nay" trên
// Hub. Migration 000080 ĐÃ ĐƯỢC DUYỆT nên giữ nguyên — cột hủy ghi ở file
// riêng này. Admin hủy → cột này null (không cần hiện ở Hub của Admin).
return new class extends Migration
{
    public function up(): void
    {
        foreach (['inbound_receipts', 'outbound_receipts', 'stock_transfers'] as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->foreignId('cancelled_by_employee_id')->nullable()->after('status')
                    ->constrained('employees')->nullOnDelete()
                    ->comment('NV hủy phiếu (gói Chờ duyệt trên Hub)');
            });
        }
    }

    public function down(): void
    {
        foreach (['inbound_receipts', 'outbound_receipts', 'stock_transfers'] as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->dropForeign(['cancelled_by_employee_id']);
                $table->dropColumn('cancelled_by_employee_id');
            });
        }
    }
};
