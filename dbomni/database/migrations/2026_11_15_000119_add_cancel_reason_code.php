<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 2, N-2 (Phụ lục khóa 2026-11-15): danh
// mục nguyên nhân hoàn/hủy chuẩn hóa — cột mã mới, KHÔNG tái dùng cột
// text cũ (dữ kiện cũ giữ nguyên dạng text, báo cáo gom NULL vào nhóm
// "chưa phân loại", không ép hồi tố).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('cancel_reason_code', 30)->nullable()->after('cancel_reason')
                ->comment('Mã nguyên nhân hủy N-2: wrong_item | out_of_stock_after_payment | too_slow | payment_error | customer_changed_mind | other | null (chưa phân loại)');
        });
        Schema::table('order_payment_undo_logs', function (Blueprint $table) {
            $table->string('reason_code', 30)->nullable()->after('reason')
                ->comment('Mã nguyên nhân hoàn tác N-2 (cùng danh mục hủy đơn)');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('cancel_reason_code');
        });
        Schema::table('order_payment_undo_logs', function (Blueprint $table) {
            $table->dropColumn('reason_code');
        });
    }
};
