<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Cây phân quyền 3 tầng (spec đã khóa 10/11/2026 §3.7, phán (e) = B):
// nhật ký lương CHỈ ghi hành động làm thay đổi (sửa · chốt/mở khóa · xuất
// phiếu), KHÔNG ghi lượt xem. Danh sách xem lại chỉ Chủ Sở Hữu xem được.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('salary_audit_logs')) {
            Schema::create('salary_audit_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('actor_user_id')->nullable()->comment('User thao tác (Chủ Sở Hữu / Chủ Chi Nhánh)');
                $table->unsignedBigInteger('actor_employee_id')->nullable()->comment('Employee thao tác (phòng thủ — tầng chức vụ không còn chạm lương)');
                $table->string('actor_tier', 20)->comment('owner | branch_owner | employee');
                $table->unsignedBigInteger('actor_branch_id')->nullable()->comment('CN của người thao tác (Chủ Chi Nhánh)');
                $table->unsignedBigInteger('employee_id')->nullable()->comment('NV bị tác động (null = thao tác toàn kỳ/cấu hình chung)');
                $table->string('action', 20)->comment('edit | money | config | lock | unlock | export');
                $table->char('month', 7)->nullable()->comment('Kỳ lương YYYY-MM (nếu có)');
                $table->string('detail', 500)->nullable();
                $table->timestamp('created_at')->useCurrent();
                $table->index(['month', 'created_at']);
                $table->index('employee_id');
                $table->index('actor_user_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_audit_logs');
    }
};
