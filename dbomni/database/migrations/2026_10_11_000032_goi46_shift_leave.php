<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 46: Yêu cầu nghỉ theo ca đã đăng ký/xếp.
// - NV tạo qua link /xin-nghi (PIN), chỉ trước giờ ca ít nhất 48h.
// - Quản lý tạo trực tiếp (sát giờ) qua admin.
// - Duyệt → tự động gỡ ca khỏi work_schedules.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('shift_leave_requests')) {
            Schema::create('shift_leave_requests', function (Blueprint $table) {
                $table->id();
                $table->foreignId('employee_id')->constrained('employees')->onDelete('cascade');
                $table->date('date');
                $table->foreignId('work_shift_id')->constrained('work_shifts')->onDelete('cascade');
                $table->foreignId('work_schedule_id')->nullable()->constrained('work_schedules')->onDelete('set null');
                $table->text('reason')->nullable();
                $table->string('status', 20)->default('pending')->comment('pending/chờ duyệt, approved/đã duyệt, rejected/từ chối');
                $table->boolean('is_manager_created')->default(false)->comment('true = quản lý tạo trực tiếp (bỏ qua rule 48h)');
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('shift_leave_requests');
    }
};
