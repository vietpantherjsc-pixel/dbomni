<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// FIX KHẨN gói chặn tự duyệt (2026-11-06, TESTER escalation 22:16): tiền đề
// mục 2 của spec SAI — migration 000030 chỉ tạo cặp created_by_user_id /
// created_by_employee_id cho inbound_receipts; bảng stock_transfers KHÔNG
// hề có cặp này (đã đối chiếu khối create gốc + mọi ALTER về sau). Code của
// gói ghi/select 2 cột không tồn tại → tạo phiếu chuyển trả 500 cả 2 bề mặt
// và chốt phiếu chuyển nháp cũng 500 ở bước nạp nhẹ của confirm().
// Migration này bổ sung đúng cặp cột còn thiếu; khóa hasColumn/hasTable 2
// chiều như mẫu 000100. Chỉ thêm cột nullable, không backfill.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('stock_transfers') && !Schema::hasColumn('stock_transfers', 'created_by_user_id')) {
            Schema::table('stock_transfers', function (Blueprint $table) {
                $table->foreignId('created_by_user_id')->nullable()->after('requested_by')
                    ->constrained('users')->nullOnDelete()
                    ->comment('User tạo phiếu (gói chặn tự duyệt); null = NV tạo hoặc phiếu cũ không rõ');
            });
        }
        if (Schema::hasTable('stock_transfers') && !Schema::hasColumn('stock_transfers', 'created_by_employee_id')) {
            Schema::table('stock_transfers', function (Blueprint $table) {
                $table->foreignId('created_by_employee_id')->nullable()->after('created_by_user_id')
                    ->constrained('employees')->nullOnDelete()
                    ->comment('NV tạo phiếu (gói chặn tự duyệt); null = User tạo hoặc phiếu cũ không rõ');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('stock_transfers') && Schema::hasColumn('stock_transfers', 'created_by_employee_id')) {
            Schema::table('stock_transfers', function (Blueprint $table) {
                $table->dropConstrainedForeignId('created_by_employee_id');
            });
        }
        if (Schema::hasTable('stock_transfers') && Schema::hasColumn('stock_transfers', 'created_by_user_id')) {
            Schema::table('stock_transfers', function (Blueprint $table) {
                $table->dropConstrainedForeignId('created_by_user_id');
            });
        }
    }
};
