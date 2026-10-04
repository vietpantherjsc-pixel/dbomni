<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 1 - bản vá khẩn (2026-10-04):
// Migration 2026_09_20_011711 đã chạy nhầm và ghi đè bảng `recipes` về schema
// cũ (ingredient_id/amount) + tạo lại bảng `ingredients`/`inventory_logs`.
// Migration này dựng lại schema ĐÚNG theo hệ materials+batches.
// (DB trống nên drop/recreate an toàn, không mất dữ liệu.)
return new class extends Migration {
    public function up(): void
    {
        Schema::disableForeignKeyConstraints();

        Schema::dropIfExists('recipes');
        Schema::create('recipes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->onDelete('cascade')
                ->comment('Khóa ngoại liên kết món chính');
            $table->foreignId('product_option_id')->nullable()->constrained('product_options')->onDelete('cascade')
                ->comment('Khóa ngoại liên kết tùy chọn (nếu có, ví dụ size L thì cần thêm nguyên liệu)');
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade')
                ->comment('Khóa ngoại liên kết nguyên liệu cấu thành');
            $table->decimal('quantity', 10, 2)
                ->comment('Định lượng tiêu hao cho 1 đơn vị thành phẩm');
            $table->timestamps();
        });

        // Dọn nốt 2 bảng của hệ ingredients cũ (trống, không dùng tới)
        Schema::dropIfExists('inventory_logs');
        Schema::dropIfExists('ingredients');

        Schema::enableForeignKeyConstraints();
    }

    public function down(): void
    {
        Schema::dropIfExists('recipes');
    }
};
