<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// SPEC-01: Thanh toán Zalo Mini App 2 giai đoạn.
// Thêm cột theo dõi kênh thanh toán Zalo (BANK/COD/ZALOPAY) vào orders.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('pay_channel', 20)->nullable()->after('payment_method')
                ->comment('Kênh thanh toán Zalo: BANK|COD|ZALOPAY (SPEC-01)');
            $table->string('pay_trans_id', 100)->nullable()->after('pay_channel')
                ->comment('Mã giao dịch từ Zalo Checkout SDK');
            $table->timestamp('pay_notified_at')->nullable()->after('pay_trans_id')
                ->comment('Thời điểm nhận notify từ Zalo');
            $table->boolean('pay_needs_review')->default(false)->after('pay_notified_at')
                ->comment('true = số tiền notify lệch tổng đơn, cần kiểm tra tay');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['pay_channel', 'pay_trans_id', 'pay_notified_at', 'pay_needs_review']);
        });
    }
};
