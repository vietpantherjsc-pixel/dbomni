<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 30 (2026-10-09): Chính sách lương lễ/tết + lương trách nhiệm theo vi phạm.
// - holidays: tạo nếu chưa có (Gói 26 đã tạo).
// - salary_records: thêm violation_count + violation_note.
// - Seed settings: resp_base_per_hour / resp_deduction_per_violation / resp_max_violations.
// Idempotent: kiểm tra hasTable/hasColumn trước khi tạo.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('holidays')) {
            Schema::create('holidays', function (Blueprint $table) {
                $table->id();
                $table->date('date')->unique()->comment('Ngày lễ/tết');
                $table->string('name', 150)->comment('Tên ngày lễ');
                $table->decimal('multiplier', 4, 2)->default(2.00)->comment('Hệ số nhân lương');
                $table->timestamps();
            });
        }

        if (Schema::hasTable('salary_records')) {
            Schema::table('salary_records', function (Blueprint $table) {
                if (!Schema::hasColumn('salary_records', 'violation_count')) {
                    $table->integer('violation_count')->default(0)->comment('Số lỗi vi phạm trong tháng');
                }
                if (!Schema::hasColumn('salary_records', 'violation_note')) {
                    $table->string('violation_note', 255)->nullable()->comment('Lý do vi phạm (vd Lỗi 3 chuyền)');
                }
            });
        }

        $defaults = [
            'resp_base_per_hour' => '2000',
            'resp_deduction_per_violation' => '500',
            'resp_max_violations' => '4',
        ];
        foreach ($defaults as $k => $v) {
            if (DB::table('settings')->where('key', $k)->count() === 0) {
                DB::table('settings')->insert(['key' => $k, 'value' => $v, 'created_at' => now(), 'updated_at' => now()]);
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('salary_records')) {
            Schema::table('salary_records', function (Blueprint $table) {
                $cols = [];
                if (Schema::hasColumn('salary_records', 'violation_count')) $cols[] = 'violation_count';
                if (Schema::hasColumn('salary_records', 'violation_note')) $cols[] = 'violation_note';
                if ($cols) $table->dropColumn($cols);
            });
        }
    }
};
