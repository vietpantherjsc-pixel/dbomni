<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Nối giờ công chấm công vào bảng lương:
// - salary_days.hours_source: nguồn giờ ('attendance' = đổ từ chấm công,
//   'manual' = nhập/sửa tay, 'leave' = nghỉ được duyệt, null = dữ liệu tay cũ).
// - salary_days.hours cho phép NULL: quên chấm công (thiếu check-in/out) → để trống,
//   quản lý nhập bổ sung tay sau.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('salary_days') && !Schema::hasColumn('salary_days', 'hours_source')) {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->string('hours_source', 20)->nullable()->after('hours')
                    ->comment("Nguồn giờ: attendance|manual|leave (null = nhập tay cũ)");
            });
        }
        // Không dùng ->change() (cần doctrine/dbal) — dùng lệnh SQL trực tiếp cho MySQL
        DB::statement('ALTER TABLE `salary_days` MODIFY `hours` DECIMAL(6,2) NULL DEFAULT NULL');
    }

    public function down(): void
    {
        DB::statement('UPDATE `salary_days` SET `hours` = 0 WHERE `hours` IS NULL');
        DB::statement('ALTER TABLE `salary_days` MODIFY `hours` DECIMAL(6,2) NOT NULL DEFAULT 0');
        if (Schema::hasTable('salary_days') && Schema::hasColumn('salary_days', 'hours_source')) {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->dropColumn('hours_source');
            });
        }
    }
};
