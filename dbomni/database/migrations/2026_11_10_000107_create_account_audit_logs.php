<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Cây phân quyền 3 tầng (spec đã khóa 10/11/2026 §2.0 khóa #6): mọi thao tác
// thêm/thu hồi Chủ Sở Hữu (và Chủ Chi Nhánh) đều ghi nhật ký — danh sách
// chỉ Chủ Sở Hữu xem. Không ghi lượt xem.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('account_audit_logs')) {
            Schema::create('account_audit_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('actor_user_id')->nullable()->comment('Chủ Sở Hữu thao tác');
                $table->unsignedBigInteger('target_user_id')->nullable()->comment('Tài khoản bị thêm/thu hồi (null nếu đã xóa)');
                $table->string('target_email', 190)->comment('Email tài khoản đích (giữ lại sau khi xóa)');
                $table->string('action', 30)->comment('owner_created | owner_revoked | branch_owner_created | branch_owner_revoked');
                $table->string('detail', 500)->nullable();
                $table->timestamp('created_at')->useCurrent();
                $table->index(['action', 'created_at']);
                $table->index('actor_user_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('account_audit_logs');
    }
};
