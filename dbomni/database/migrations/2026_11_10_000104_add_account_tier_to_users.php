<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Cây phân quyền 3 tầng (spec đã khóa 10/11/2026 §2.0/§2.0A):
// users thêm tầng tài khoản + CN gắn cứng cho Chủ Chi Nhánh.
// Tài khoản hiện có mặc định 'owner' = Chủ Sở Hữu (không đổi dữ kiện).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('account_tier', 20)->default('owner')->after('email')
                ->comment('owner = Chủ Sở Hữu · branch_owner = Chủ Chi Nhánh');
            $table->unsignedBigInteger('owner_branch_id')->nullable()->after('account_tier')
                ->comment('CN gắn cứng của Chủ Chi Nhánh (đúng 1 CN)');
            $table->unsignedBigInteger('employee_id')->nullable()->after('owner_branch_id')
                ->comment('NV được chọn khi tạo tài khoản quản trị từ nhân viên hiện có');
            $table->boolean('must_change_password')->default(false)->after('password')
                ->comment('Buộc đổi mật khẩu ở lần đăng nhập đầu (mật khẩu tạm)');
            $table->foreign('owner_branch_id')->references('id')->on('branches')->nullOnDelete();
            $table->foreign('employee_id')->references('id')->on('employees')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['owner_branch_id']);
            $table->dropForeign(['employee_id']);
            $table->dropColumn(['account_tier', 'owner_branch_id', 'employee_id', 'must_change_password']);
        });
    }
};
