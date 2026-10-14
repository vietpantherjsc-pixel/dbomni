<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 55: tách giờ công theo chi nhánh — thêm branch_id vào salary_days
// 1 NV làm 2 CN trong 1 ngày → 2 dòng riêng, phân bổ chi phí đúng từng CN
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('salary_days')) return;

        // Thêm branch_id (nullable để tương thích dữ liệu cũ → gán về CN chính của NV)
        if (!Schema::hasColumn('salary_days', 'branch_id')) {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->foreignId('branch_id')->nullable()->after('employee_id')
                    ->constrained('branches')->nullOnDelete();
            });

            // Dữ liệu cũ: gán branch_id = chi nhánh chính của NV
            DB::statement('
                UPDATE salary_days sd
                JOIN employees e ON e.id = sd.employee_id
                SET sd.branch_id = e.branch_id
                WHERE sd.branch_id IS NULL
            ');
        }

        // Đổi unique key: (employee_id, date) → (employee_id, date, branch_id)
        // để 1 NV có thể có nhiều dòng/ngày (mỗi CN 1 dòng)
        try {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->dropUnique(['employee_id', 'date']);
            });
        } catch (\Throwable $e) {
            // unique key có tên khác — bỏ qua, tạo mới bên dưới
        }
        // Xóa unique cũ theo tên (Laravel đặt tên salary_days_employee_id_date_unique)
        try {
            DB::statement('ALTER TABLE salary_days DROP INDEX salary_days_employee_id_date_unique');
        } catch (\Throwable $e) {}

        Schema::table('salary_days', function (Blueprint $table) {
            $table->unique(['employee_id', 'date', 'branch_id'], 'salary_days_emp_date_branch_unique');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('salary_days')) return;
        try {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->dropUnique('salary_days_emp_date_branch_unique');
            });
        } catch (\Throwable $e) {}
        // Không xóa cột branch_id để tránh mất dữ liệu khi rollback
    }
};
