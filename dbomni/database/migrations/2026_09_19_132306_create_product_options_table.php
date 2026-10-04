<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('product_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->onDelete('cascade')->comment('Khóa ngoại liên kết món chính');
            $table->string('name', 100)->comment('Tên tùy chọn (Size L, Trân châu,...)');
            $table->decimal('additional_price', 12, 2)->default(0)->comment('Giá cộng thêm vào món chính');
            $table->boolean('is_required')->default(false)->comment('Bắt buộc chọn hay không');
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('product_options');
    }
};