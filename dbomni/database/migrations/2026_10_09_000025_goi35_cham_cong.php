<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 35 (2026-10-09): Full chấm công — ca làm việc, đăng ký ca, xếp ca, chấm công QR, yêu cầu nghỉ.
return new class extends Migration
{
    public function up(): void
    {
        // 1. Ca làm việc (KHÁC bảng `shifts` của ca thu ngân Gói 1)
        if (!Schema::hasTable('work_shifts')) {
            Schema::create('work_shifts', function (Blueprint $table) {
                $table->id();
                $table->foreignId('branch_id')->nullable()->constrained('branches')->onDelete('cascade')->comment('null = dùng chung mọi chi nhánh');
                $table->string('name')->comment('VD: Ca sáng');
                $table->time('start_time');
                $table->time('end_time');
                $table->integer('sort_order')->default(0);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        // 2. Đăng ký ca của nhân viên (được đăng ký nhiều ca/ngày)
        if (!Schema::hasTable('shift_registrations')) {
            Schema::create('shift_registrations', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->onDelete('cascade');
                $table->foreignId('work_shift_id')->constrained('work_shifts')->onDelete('cascade');
                $table->date('date');
                $table->string('status', 20)->default('draft')->comment('draft=submitted');
                $table->timestamps();
                $table->unique(['employee_id', 'work_shift_id', 'date'], 'uniq_reg_emp_shift_date');
            });
        }

        // 3. Xếp ca (quản lý gán + điều chỉnh giờ vào/ra riêng từng NV)
        if (!Schema::hasTable('work_schedules')) {
            Schema::create('work_schedules', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->onDelete('cascade');
                $table->foreignId('work_shift_id')->constrained('work_shifts')->onDelete('cascade');
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->date('date');
                $table->time('custom_start_time')->nullable()->comment('Giờ vào điều chỉnh riêng (null = theo ca mẫu)');
                $table->time('custom_end_time')->nullable()->comment('Giờ ra điều chỉnh riêng (null = theo ca mẫu)');
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                $table->unique(['employee_id', 'work_shift_id', 'date'], 'uniq_sched_emp_shift_date');
            });
        }

        // 4. Chấm công (1 dòng / NV / chi nhánh / ngày)
        if (!Schema::hasTable('attendances')) {
            Schema::create('attendances', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->onDelete('cascade');
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
                $table->date('date');
                $table->dateTime('check_in')->nullable();
                $table->dateTime('check_out')->nullable();
                $table->timestamps();
                $table->unique(['employee_id', 'branch_id', 'date'], 'uniq_att_emp_branch_date');
            });
        }

        // 5. Yêu cầu nghỉ / đổi ca
        if (!Schema::hasTable('leave_requests')) {
            Schema::create('leave_requests', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->onDelete('cascade');
                $table->string('type', 20)->default('nghi')->comment('nghi|doica|khac');
                $table->date('date_from');
                $table->date('date_to')->nullable();
                $table->text('reason')->nullable();
                $table->string('status', 20)->default('pending')->comment('pending|approved|rejected');
                $table->foreignId('handled_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }

        // 6. QR token chấm công cố định theo chi nhánh
        if (!Schema::hasColumn('branches', 'attendance_qr_token')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->string('attendance_qr_token', 64)->nullable()->unique()->after('address');
            });
        }
        // Backfill token cho chi nhánh chưa có
        foreach (DB::table('branches')->whereNull('attendance_qr_token')->get() as $b) {
            DB::table('branches')->where('id', $b->id)->update(['attendance_qr_token' => Str::random(32)]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_requests');
        Schema::dropIfExists('attendances');
        Schema::dropIfExists('work_schedules');
        Schema::dropIfExists('shift_registrations');
        Schema::dropIfExists('work_shifts');
        if (Schema::hasColumn('branches', 'attendance_qr_token')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->dropColumn('attendance_qr_token');
            });
        }
    }
};
