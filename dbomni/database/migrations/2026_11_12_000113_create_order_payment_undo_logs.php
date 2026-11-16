<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Nút hoàn tác xác nhận thanh toán (spec-hoan-tac-xac-nhan mục 6, Đại
// Vương chốt 2026-11-12): nhật ký MỖI lượt hoàn tác của 1 đơn — ai bấm ·
// lúc nào · lý do (bắt buộc) · ảnh chụp trạng thái thanh toán TRƯỚC đảo ·
// kết quả báo ngược sang Zalo. Hệ thống chưa có log theo đơn; bảng này
// theo đúng tiền lệ log theo lĩnh vực của gói phân quyền (salary/account
// audit logs): cặp tác nhân user_id/employee_id theo khuôn ApprovalActor
// (đúng 1 trong 2 có giá trị; cả hai trống = bề mặt không có tác nhân
// đăng nhập — khi đó surface + branch_id là dấu truy vết).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('order_payment_undo_logs')) {
            Schema::create('order_payment_undo_logs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('order_id')->comment('Đơn bị hoàn tác xác nhận thanh toán');
                $table->unsignedBigInteger('user_id')->nullable()->comment('User thao tác (ApprovalActor)');
                $table->unsignedBigInteger('employee_id')->nullable()->comment('Employee thao tác (ApprovalActor)');
                $table->string('actor_label', 100)->nullable()->comment('Nhãn hiển thị người thao tác tại thời điểm bấm');
                $table->string('surface', 10)->nullable()->comment('admin | kds — bề mặt bấm nút');
                $table->unsignedBigInteger('branch_id')->nullable()->comment('Chi nhánh của đơn');
                $table->string('reason', 500)->comment('Lý do hoàn tác (bắt buộc ở API)');
                $table->string('prev_payment_status', 30)->nullable()->comment('Ảnh chụp trước đảo: payment_status');
                $table->timestamp('prev_paid_at')->nullable()->comment('Ảnh chụp trước đảo: paid_at');
                $table->string('prev_pay_channel', 10)->nullable()->comment('Ảnh chụp trước đảo: pay_channel');
                $table->string('prev_pay_sdk_status', 30)->nullable()->comment('Ảnh chụp trước đảo: pay_sdk_status');
                $table->string('zalo_result', 20)->default('not_applicable')->comment('not_applicable | success — kết quả báo updateOrderStatus −1 (chỉ đơn SDK BANK)');
                $table->timestamps();
                $table->index(['order_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('order_payment_undo_logs');
    }
};
