<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Audit 2026-10-23 A4-4: kỳ lương đã chốt phải có SNAPSHOT theo từng NV.
// Trước đây PayrollLock chỉ lưu 1 số tổng (net_total) — sau khi chốt, sửa
// chính sách chung/vi phạm/BHXH/phụ cấp vẫn làm số chi tiết + bảng tổng +
// phiếu PNG của kỳ đã chốt thay đổi theo. Nay khi chốt, hệ thống lưu:
// - kind='row': từng dòng bảng tổng (NV x CN) tại thời điểm chốt;
// - kind='detail': toàn bộ payload chi tiết của show() cho từng NV.
// Các bề mặt đọc (summary, show/PNG) ưu tiên đọc snapshot khi kỳ đã chốt.
// Mở khóa -> xóa lock -> snapshot tự xóa theo FK cascade.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('payroll_lock_snapshots')) {
            Schema::create('payroll_lock_snapshots', function (Blueprint $table) {
                $table->id();
                $table->foreignId('lock_id')->constrained('payroll_locks')->cascadeOnDelete();
                $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
                $table->unsignedBigInteger('branch_id')->nullable();
                $table->string('kind', 10)->comment('row|detail');
                $table->json('data');
                $table->timestamps();
                $table->index(['lock_id', 'kind']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_lock_snapshots');
    }
};
