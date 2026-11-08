<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói #102 (2026-11-07, spec-mat-khau-dang-nhap-lan-dau-nhan-vien mục 4.1):
// vòng đời mật khẩu đăng nhập Hub của nhân viên — cờ đang giữ mật khẩu tạm
// (phải đổi ở lần đăng nhập đầu) + mốc đổi mật khẩu gần nhất + dấu vết lần
// cấp lại gần nhất (2 cột tác nhân song song User/Employee theo mẫu actor
// của hệ, KHÔNG ghi auth()->id() trần vào 1 cột). Bộ đếm chống dò mật khẩu
// dùng Cache như cơ chế PIN nên không cần cột. Chỉ thêm cột, không sửa/xóa
// cột password/pin_code. Khóa hasColumn chống trôi schema như 000100.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('employees')) {
            return;
        }
        if (!Schema::hasColumn('employees', 'must_change_password')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->boolean('must_change_password')->default(false)->after('password')
                    ->comment('Đang giữ mật khẩu tạm do quản lý cấp — bắt buộc đổi ở lần đăng nhập Hub đầu (gói #102)');
            });
        }
        if (!Schema::hasColumn('employees', 'password_changed_at')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->timestamp('password_changed_at')->nullable()->after('must_change_password')
                    ->comment('Lần cuối mật khẩu được đặt/đổi (gói #102)');
            });
        }
        if (!Schema::hasColumn('employees', 'password_reset_at')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->timestamp('password_reset_at')->nullable()->after('password_changed_at')
                    ->comment('Lần cấp mật khẩu gần nhất (tạo NV hoặc cấp lại) — mốc tính hạn 72h của mật khẩu tạm (gói #102)');
            });
        }
        if (!Schema::hasColumn('employees', 'password_reset_by_user_id')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->foreignId('password_reset_by_user_id')->nullable()->after('password_reset_at')
                    ->constrained('users')->nullOnDelete()
                    ->comment('Admin (User) cấp mật khẩu gần nhất; null nếu người cấp là NV hoặc chưa từng cấp (gói #102)');
            });
        }
        if (!Schema::hasColumn('employees', 'password_reset_by_employee_id')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->foreignId('password_reset_by_employee_id')->nullable()->after('password_reset_by_user_id')
                    ->constrained('employees')->nullOnDelete()
                    ->comment('NV quản lý cấp mật khẩu gần nhất; null nếu người cấp là User hoặc chưa từng cấp (gói #102)');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('employees')) {
            return;
        }
        if (Schema::hasColumn('employees', 'password_reset_by_employee_id')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->dropConstrainedForeignId('password_reset_by_employee_id');
            });
        }
        if (Schema::hasColumn('employees', 'password_reset_by_user_id')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->dropConstrainedForeignId('password_reset_by_user_id');
            });
        }
        foreach (['password_reset_at', 'password_changed_at', 'must_change_password'] as $col) {
            if (Schema::hasColumn('employees', $col)) {
                Schema::table('employees', function (Blueprint $table) use ($col) {
                    $table->dropColumn($col);
                });
            }
        }
    }
};
