<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('recipes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->onDelete('cascade')->comment('Khóa ngoại liên kết món chính');
            $table->foreignId('product_option_id')->nullable()->constrained('product_options')->onDelete('cascade')->comment('Khóa ngoại liên kết tùy chọn (nếu có, ví dụ size L thì cần thêm nguyên liệu)');
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade')->comment('Khóa ngoại liên kết nguyên liệu cấu thành');
            $table->decimal('quantity', 10, 2)->comment('Định lượng tiêu hao cho 1 đơn vị thành phẩm');
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('recipes');
    }
};