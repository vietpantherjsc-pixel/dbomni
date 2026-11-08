<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói chặn tự duyệt (2026-11-06, spec-chan-tu-duyet-phieu mục 2): thêm cột
// người tạo phía NHÂN VIÊN cho 2 bảng chưa có — thu-chi (trước đây NV tạo ghi
// null vì không có cột) và phiếu xuất (employee_id mang nghĩa phụ trách/gán
// việc, không dùng làm người tạo cho phiếu mới). Khóa hasColumn chống trôi
// schema như 000059: DB đã có sẵn cột thì migrate vẫn chạy qua an toàn.
// Chỉ thêm cột nullable, không sửa/xóa cột nào, không backfill.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('transactions') && !Schema::hasColumn('transactions', 'created_by_employee_id')) {
            Schema::table('transactions', function (Blueprint $table) {
                $table->foreignId('created_by_employee_id')->nullable()->after('created_by')
                    ->constrained('employees')->nullOnDelete()
                    ->comment('NV tạo phiếu (gói chặn tự duyệt); null = User tạo hoặc phiếu cũ không rõ người tạo');
            });
        }
        if (Schema::hasTable('outbound_receipts') && !Schema::hasColumn('outbound_receipts', 'created_by_employee_id')) {
            Schema::table('outbound_receipts', function (Blueprint $table) {
                $table->foreignId('created_by_employee_id')->nullable()->after('created_by')
                    ->constrained('employees')->nullOnDelete()
                    ->comment('NV tạo phiếu (gói chặn tự duyệt); employee_id giữ nghĩa phụ trách/gán việc');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('transactions') && Schema::hasColumn('transactions', 'created_by_employee_id')) {
            Schema::table('transactions', function (Blueprint $table) {
                $table->dropConstrainedForeignId('created_by_employee_id');
            });
        }
        if (Schema::hasTable('outbound_receipts') && Schema::hasColumn('outbound_receipts', 'created_by_employee_id')) {
            Schema::table('outbound_receipts', function (Blueprint $table) {
                $table->dropConstrainedForeignId('created_by_employee_id');
            });
        }
    }
};
