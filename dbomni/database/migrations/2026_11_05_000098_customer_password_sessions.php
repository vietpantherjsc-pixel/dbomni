<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec đăng nhập SĐT + mật khẩu (Đại Vương chốt 2026-11-05 ~14:16, BA sửa
// cuối 14:37): mật khẩu là chứng thực đăng nhập duy nhất ở đường phụ,
// member_code về vai trò định danh công khai. Số migration 000098 = số trống
// kế tiếp tại thời điểm code (spec ghi dự kiến 000094 khi cây mới tới 000093).
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('customers')) {
            Schema::table('customers', function (Blueprint $table) {
                if (!Schema::hasColumn('customers', 'password_hash')) {
                    $table->string('password_hash', 255)->nullable()->after('member_code');
                }
                if (!Schema::hasColumn('customers', 'password_set_at')) {
                    $table->timestamp('password_set_at')->nullable()->after('password_hash');
                }
                if (!Schema::hasColumn('customers', 'password_failed_attempts')) {
                    $table->unsignedSmallInteger('password_failed_attempts')->default(0)->after('password_set_at');
                }
                if (!Schema::hasColumn('customers', 'password_locked_until')) {
                    $table->timestamp('password_locked_until')->nullable()->after('password_failed_attempts');
                }
                if (!Schema::hasColumn('customers', 'email')) {
                    $table->string('email', 150)->nullable()->after('phone');
                }
                if (!Schema::hasColumn('customers', 'email_added_at')) {
                    $table->timestamp('email_added_at')->nullable()->after('email');
                }
                if (!Schema::hasColumn('customers', 'password_setup_until')) {
                    $table->timestamp('password_setup_until')->nullable()->after('email_added_at');
                }
                if (!Schema::hasColumn('customers', 'password_setup_at')) {
                    $table->timestamp('password_setup_at')->nullable()->after('password_setup_until');
                }
                if (!Schema::hasColumn('customers', 'password_setup_by_user_id')) {
                    $table->foreignId('password_setup_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                }
                if (!Schema::hasColumn('customers', 'password_setup_by_employee_id')) {
                    $table->foreignId('password_setup_by_employee_id')->nullable()->constrained('employees')->nullOnDelete();
                }
                if (!Schema::hasColumn('customers', 'member_code_rotated_at')) {
                    $table->timestamp('member_code_rotated_at')->nullable()->after('password_setup_by_employee_id');
                }
                if (!Schema::hasColumn('customers', 'member_code_rotated_by_user_id')) {
                    $table->foreignId('member_code_rotated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                }
                if (!Schema::hasColumn('customers', 'member_code_rotated_by_employee_id')) {
                    $table->foreignId('member_code_rotated_by_employee_id')->nullable()->constrained('employees')->nullOnDelete();
                }
            });
        }

        if (!Schema::hasTable('customer_sessions')) {
            Schema::create('customer_sessions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
                $table->char('token_hash', 64)->unique();
                $table->string('auth_method', 20);
                $table->string('device_label', 120)->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->string('user_agent', 255)->nullable();
                $table->timestamp('last_used_at')->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
                $table->index(['customer_id', 'revoked_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_sessions');
        if (Schema::hasTable('customers')) {
            Schema::table('customers', function (Blueprint $table) {
                $cols = [
                    'password_hash', 'password_set_at', 'password_failed_attempts',
                    'password_locked_until', 'email', 'email_added_at',
                    'password_setup_until', 'password_setup_at',
                    'password_setup_by_user_id', 'password_setup_by_employee_id',
                    'member_code_rotated_at', 'member_code_rotated_by_user_id',
                    'member_code_rotated_by_employee_id',
                ];
                // T-01: 4 cột mang FK phải bỏ ràng buộc trước khi bỏ cột,
                // nếu không MySQL lỗi 1828 khi rollback.
                foreach (['password_setup_by_user_id', 'password_setup_by_employee_id', 'member_code_rotated_by_user_id', 'member_code_rotated_by_employee_id'] as $fkCol) {
                    if (Schema::hasColumn('customers', $fkCol)) $table->dropForeign([$fkCol]);
                }
                $existing = array_values(array_filter($cols, fn ($c) => Schema::hasColumn('customers', $c)));
                if ($existing) $table->dropColumn($existing);
            });
        }
    }
};
