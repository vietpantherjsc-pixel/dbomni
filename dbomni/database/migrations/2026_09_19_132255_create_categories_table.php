<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique(); // Dùng để làm đường dẫn chuẩn SEO hoặc định danh cho Mini App
            $table->integer('sort_order')->default(0); // Cho phép quản lý kéo thả thứ tự
            $table->boolean('is_active')->default(true); // Bật/tắt hiển thị danh mục
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};