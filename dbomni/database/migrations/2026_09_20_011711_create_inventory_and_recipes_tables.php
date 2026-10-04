<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Tắt kiểm tra khóa ngoại để dọn dẹp sạch sẽ nếu bảng cũ bị kẹt
        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('inventory_logs');
        Schema::dropIfExists('recipes');
        Schema::dropIfExists('ingredients');
        Schema::enableForeignKeyConstraints();

        // 1. Bảng nguyên vật liệu thô
        Schema::create('ingredients', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('unit');
            $table->decimal('cost_per_unit', 10, 2)->default(0);
            $table->decimal('current_stock', 12, 2)->default(0);
            $table->decimal('min_stock_alert', 12, 2)->default(100);
            $table->timestamps();
        });

        // 2. Bảng công thức định lượng (Recipe / BOM)
        Schema::create('recipes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('ingredient_id')->constrained('ingredients')->cascadeOnDelete();
            $table->decimal('amount', 10, 2);
            $table->timestamps();
        });

        // 3. Bảng lịch sử biến động kho
        Schema::create('inventory_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ingredient_id')->constrained('ingredients')->cascadeOnDelete();
            $table->string('type'); // 'import', 'auto_order', 'waste', 'adjustment'
            $table->decimal('quantity_change', 10, 2);
            $table->decimal('stock_after', 12, 2);
            $table->string('note')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('inventory_logs');
        Schema::dropIfExists('recipes');
        Schema::dropIfExists('ingredients');
        Schema::enableForeignKeyConstraints();
    }
};