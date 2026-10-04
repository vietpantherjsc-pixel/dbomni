<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('subtotal_amount', 12, 2)->after('total_amount')->default(0)->comment('Tạm tính trước giảm giá');
            $table->decimal('discount_amount', 12, 2)->after('subtotal_amount')->default(0)->comment('Số tiền được giảm');
            $table->string('voucher_code', 50)->nullable()->after('discount_amount')->comment('Mã voucher đã áp dụng');
        });
    }

    public function down(): void {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['subtotal_amount', 'discount_amount', 'voucher_code']);
        });
    }
};