<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->nullable()->constrained()->nullOnDelete(); // Liên kết với danh mục
            $table->string('name');
            $table->string('sku')->unique()->nullable(); // Mã quản lý nội bộ/Mã vạch
            $table->string('slug')->unique();
            $table->decimal('base_price', 15, 0)->default(0); // Giá bán cơ bản
            $table->string('image_url')->nullable(); 
            $table->text('description')->nullable();
            
            // Các cờ (Flags) điều hướng kênh bán hàng
            $table->boolean('is_active')->default(true); // Trạng thái chung
            $table->boolean('sell_on_pos')->default(true); // Cho phép bán trên máy POS
            $table->boolean('sell_on_zalo')->default(false); // Bật/tắt mặt hàng này trên Zalo Mini App
            
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};