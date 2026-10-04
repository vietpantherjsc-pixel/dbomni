<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->nullOnDelete();
            $table->string('product_name'); // Lưu cứng tên mặt hàng lúc bán (phòng khi sau này đổi tên/xóa món)
            $table->decimal('price', 15, 0); // Lưu giá lúc bán
            $table->integer('quantity');
            $table->decimal('subtotal', 15, 0); // Thành tiền (price * quantity)
            $table->text('note')->nullable(); // Ghi chú (VD: Ít đá, nhiều sữa)
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};