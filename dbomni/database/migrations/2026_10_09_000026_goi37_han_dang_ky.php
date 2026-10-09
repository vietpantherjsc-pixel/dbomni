<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Gói 37: hạn chót đăng ký ca + sức chứa ca + ghi chú lịch tuần.
return new class extends Migration
{
    public function up(): void
    {
        // Đếm lượt GỬI đăng ký của NV theo tuần (draft không tính)
        if (!Schema::hasTable('shift_reg_weeks')) {
            Schema::create('shift_reg_weeks', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->date('week_start');
                $table->unsignedInteger('submit_count')->default(0);
                $table->timestamps();
                $table->unique(['employee_id', 'week_start']);
            });
        }

        // Sức chứa tối đa theo từng ca + từng ngày trong tuần (0=Thứ 2..6=CN)
        if (!Schema::hasTable('work_shift_capacities')) {
            Schema::create('work_shift_capacities', function (Blueprint $table) {
                $table->id();
                $table->foreignId('work_shift_id')->constrained('work_shifts')->cascadeOnDelete();
                $table->unsignedTinyInteger('weekday');
                $table->unsignedInteger('max_staff')->nullable();
                $table->timestamps();
                $table->unique(['work_shift_id', 'weekday']);
            });
        }

        // Ghi chú chung của bảng lịch tuần (theo chi nhánh, null = tất cả CN)
        if (!Schema::hasTable('schedule_notes')) {
            Schema::create('schedule_notes', function (Blueprint $table) {
                $table->id();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->date('week_start');
                $table->text('note')->nullable();
                $table->timestamps();
                $table->unique(['branch_id', 'week_start']);
            });
        }

        // Cài đặt hạn chót đăng ký ca (mặc định: Thứ 7 20:00, tuần trước tuần đăng ký)
        if (Schema::hasTable('settings')) {
            foreach (['shift_reg_deadline_weekday' => '5', 'shift_reg_deadline_time' => '20:00'] as $k => $v) {
                if (!DB::table('settings')->where('key', $k)->exists()) {
                    DB::table('settings')->insert(['key' => $k, 'value' => $v, 'created_at' => now(), 'updated_at' => now()]);
                }
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('schedule_notes');
        Schema::dropIfExists('work_shift_capacities');
        Schema::dropIfExists('shift_reg_weeks');
    }
};
