<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec P4-P1 (Đại Vương chốt 2026-10-19):
// - B4: chấm công đối chiếu ca (is_late, is_early_leave, outside_shift)
// - B3: phạt tiền trừ thẳng lương (salary_deductions.kind)
// - B5: đổi ca thật giữa 2 NV (shift_swap_requests)
// - B6: phụ cấp nhiều loại (allowance_types, employee_allowances)
return new class extends Migration {
    public function up(): void
    {
        // B4
        if (Schema::hasTable('attendances')) {
            Schema::table('attendances', function (Blueprint $table) {
                if (!Schema::hasColumn('attendances', 'is_late')) $table->boolean('is_late')->default(false)->after('check_out');
                if (!Schema::hasColumn('attendances', 'is_early_leave')) $table->boolean('is_early_leave')->default(false)->after('is_late');
                if (!Schema::hasColumn('attendances', 'outside_shift')) $table->boolean('outside_shift')->default(false)->after('is_early_leave');
            });
        }

        // B3
        if (Schema::hasTable('salary_deductions') && !Schema::hasColumn('salary_deductions', 'kind')) {
            Schema::table('salary_deductions', function (Blueprint $table) {
                $table->string('kind', 20)->default('other')->after('name')->comment('other|fine (phạt tiền)');
            });
        }

        // B5
        if (!Schema::hasTable('shift_swap_requests')) {
            Schema::create('shift_swap_requests', function (Blueprint $table) {
                $table->id();
                $table->foreignId('requester_id')->constrained('employees')->cascadeOnDelete()->comment('NV A tạo yêu cầu');
                $table->foreignId('target_id')->constrained('employees')->cascadeOnDelete()->comment('NV B được đề nghị đổi');
                $table->foreignId('requester_schedule_id')->constrained('work_schedules')->cascadeOnDelete()->comment('Ca của A');
                $table->foreignId('target_schedule_id')->constrained('work_schedules')->cascadeOnDelete()->comment('Ca của B');
                $table->string('status', 20)->default('pending')->comment('pending|target_confirmed|approved|rejected');
                $table->timestamp('target_confirmed_at')->nullable();
                $table->string('reject_reason', 500)->nullable();
                $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->index(['requester_id', 'status']);
                $table->index(['target_id', 'status']);
            });
        }

        // B6
        if (!Schema::hasTable('allowance_types')) {
            Schema::create('allowance_types', function (Blueprint $table) {
                $table->id();
                $table->string('code', 50)->unique();
                $table->string('name', 150);
                $table->integer('sort_order')->default(0);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
            DB::table('allowance_types')->insert([
                ['code' => 'xang_xe', 'name' => 'Xăng xe', 'sort_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
                ['code' => 'dien_thoai', 'name' => 'Điện thoại', 'sort_order' => 2, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
                ['code' => 'chuyen_can', 'name' => 'Chuyên cần', 'sort_order' => 3, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
                ['code' => 'khac', 'name' => 'Khác', 'sort_order' => 99, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()],
            ]);
        }
        if (!Schema::hasTable('employee_allowances')) {
            Schema::create('employee_allowances', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->foreignId('allowance_type_id')->constrained('allowance_types')->cascadeOnDelete();
                $table->decimal('amount', 12, 0)->default(0)->comment('Mức/tháng');
                $table->char('month', 7)->nullable()->comment('YYYY-MM; null = áp dụng mọi tháng');
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->index(['employee_id', 'month']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_allowances');
        Schema::dropIfExists('allowance_types');
        Schema::dropIfExists('shift_swap_requests');
        if (Schema::hasTable('salary_deductions') && Schema::hasColumn('salary_deductions', 'kind')) {
            Schema::table('salary_deductions', fn (Blueprint $table) => $table->dropColumn('kind'));
        }
        if (Schema::hasTable('attendances')) {
            Schema::table('attendances', function (Blueprint $table) {
                foreach (['is_late', 'is_early_leave', 'outside_shift'] as $col) {
                    if (Schema::hasColumn('attendances', $col)) $table->dropColumn($col);
                }
            });
        }
    }
};
