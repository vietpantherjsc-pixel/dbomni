<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói "Chờ duyệt trên Hub" (2026-10-21): cột ghi vết Employee duyệt song song với cột User
// + trạng thái từ chối cho transactions (rejected_at/reject_reason/rejected_by...).
// Phân loại CỘNG THÊM — chỉ thêm cột nullable, an toàn rollback code.
return new class extends Migration
{
    public function up(): void
    {
        // 1) Thu/chi: người duyệt là Employee + bộ cột từ chối (ĐÃ CHỐT — mục 4.3 spec)
        Schema::table('transactions', function (Blueprint $table) {
            $table->foreignId('approved_by_employee_id')->nullable()->after('approved_by')
                ->constrained('employees')->nullOnDelete();
            $table->timestamp('rejected_at')->nullable()->after('approved_at')
                ->comment('Thời điểm từ chối — phiếu bị từ chối là hồ sơ đóng (terminal)');
            $table->string('reject_reason', 500)->nullable()->after('rejected_at');
            $table->foreignId('rejected_by')->nullable()->after('reject_reason')
                ->constrained('users')->nullOnDelete();
            $table->foreignId('rejected_by_employee_id')->nullable()->after('rejected_by')
                ->constrained('employees')->nullOnDelete();
        });

        // 2) Xin nghỉ phép: người xử lý là Employee
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->foreignId('handled_by_employee_id')->nullable()->after('handled_by')
                ->constrained('employees')->nullOnDelete();
        });

        // 3) Điều chỉnh kiểm kê: người duyệt là Employee
        Schema::table('stocktake_adjustments', function (Blueprint $table) {
            $table->foreignId('approved_by_employee_id')->nullable()->after('approved_by_user_id')
                ->constrained('employees')->nullOnDelete();
        });

        // 4) Phiếu nhập kho: chưa có cột người duyệt → thêm cả cặp user/employee + thời điểm
        Schema::table('inbound_receipts', function (Blueprint $table) {
            $table->foreignId('approved_by_user_id')->nullable()->after('created_by_employee_id')
                ->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by_employee_id')->nullable()->after('approved_by_user_id')
                ->constrained('employees')->nullOnDelete();
            $table->timestamp('approved_at')->nullable()->after('approved_by_employee_id');
        });

        // 5) Phiếu xuất kho: chưa có cột người chốt → thêm cả cặp + thời điểm
        Schema::table('outbound_receipts', function (Blueprint $table) {
            $table->foreignId('confirmed_by')->nullable()->after('created_by')
                ->constrained('users')->nullOnDelete();
            $table->foreignId('confirmed_by_employee_id')->nullable()->after('confirmed_by')
                ->constrained('employees')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable()->after('confirmed_by_employee_id');
        });

        // 6) Chuyển kho: đã có confirmed_by (users) → thêm bản employee
        Schema::table('stock_transfers', function (Blueprint $table) {
            $table->foreignId('confirmed_by_employee_id')->nullable()->after('confirmed_by')
                ->constrained('employees')->nullOnDelete();
        });

        // 7) Đăng ký ca: hiện chưa ghi người xử lý → thêm cột employee
        Schema::table('shift_registrations', function (Blueprint $table) {
            $table->foreignId('handled_by_employee_id')->nullable()->after('employee_id')
                ->constrained('employees')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('shift_registrations', function (Blueprint $table) {
            $table->dropForeign(['handled_by_employee_id']);
            $table->dropColumn('handled_by_employee_id');
        });
        Schema::table('stock_transfers', function (Blueprint $table) {
            $table->dropForeign(['confirmed_by_employee_id']);
            $table->dropColumn('confirmed_by_employee_id');
        });
        Schema::table('outbound_receipts', function (Blueprint $table) {
            $table->dropForeign(['confirmed_by_employee_id']);
            $table->dropForeign(['confirmed_by']);
            $table->dropColumn(['confirmed_by_employee_id', 'confirmed_by', 'confirmed_at']);
        });
        Schema::table('inbound_receipts', function (Blueprint $table) {
            $table->dropForeign(['approved_by_employee_id']);
            $table->dropForeign(['approved_by_user_id']);
            $table->dropColumn(['approved_by_employee_id', 'approved_by_user_id', 'approved_at']);
        });
        Schema::table('stocktake_adjustments', function (Blueprint $table) {
            $table->dropForeign(['approved_by_employee_id']);
            $table->dropColumn('approved_by_employee_id');
        });
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropForeign(['handled_by_employee_id']);
            $table->dropColumn('handled_by_employee_id');
        });
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropForeign(['rejected_by_employee_id']);
            $table->dropForeign(['rejected_by']);
            $table->dropColumn(['rejected_at', 'reject_reason', 'rejected_by', 'rejected_by_employee_id']);
            $table->dropForeign(['approved_by_employee_id']);
            $table->dropColumn('approved_by_employee_id');
        });
    }
};
