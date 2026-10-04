<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->comment('Nhân viên thu ngân');
            $table->string('order_number')->unique(); // Mã đơn hàng (VD: ORD-20260921-001)
            $table->decimal('total_amount', 15, 0)->default(0); // Tổng tiền
            $table->string('status')->default('pending'); // Trạng thái: pending (chờ), completed (hoàn thành), cancelled (hủy)
            $table->string('payment_method')->nullable(); // cash (tiền mặt), transfer (chuyển khoản)
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};