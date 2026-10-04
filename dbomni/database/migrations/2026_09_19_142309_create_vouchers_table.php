<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('vouchers', function (Blueprint $table) {
            $table->id();
            $table->string('code', 50)->unique()->comment('Mã voucher (VD: GIAM20K, CHAOBANMOI)');
            $table->string('name', 100)->comment('Tên chương trình');
            $table->enum('type', ['fixed', 'percent'])->comment('fixed: giảm tiền mặt, percent: giảm theo %');
            $table->decimal('value', 12, 2)->comment('Giá trị giảm (VD: 20000 hoặc 10)');
            $table->decimal('min_order_amount', 12, 2)->default(0)->comment('Đơn tối thiểu để áp dụng');
            $table->decimal('max_discount_amount', 12, 2)->nullable()->comment('Số tiền giảm tối đa (với loại %)');
            $table->integer('usage_limit')->nullable()->comment('Số lần dùng tối đa toàn hệ thống');
            $table->integer('used_count')->default(0)->comment('Số lần đã sử dụng');
            $table->dateTime('starts_at')->nullable()->comment('Thời gian bắt đầu');
            $table->dateTime('expires_at')->nullable()->comment('Thời hạn kết thúc');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('vouchers');
    }
};