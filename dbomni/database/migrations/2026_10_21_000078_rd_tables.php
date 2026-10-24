<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// SPEC R&D (2026-10-21, Đại Vương chốt): phân hệ R&D — món nháp + chi phí cố định.
// Bảng RIÊNG hoàn toàn (rd_*), nháp KHÔNG nằm trong products nên không thể rò ra
// POS/Mini App/thực đơn/báo cáo dù sót lọc ở bất kỳ đâu.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rd_products', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->foreignId('category_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->string('unit')->nullable();
            $table->text('description')->nullable();
            $table->string('image_url', 500)->nullable();
            $table->decimal('expected_price', 12, 2)->default(0); // Giá bán dự kiến
            $table->string('status', 20)->default('draft'); // draft | approved | discarded
            $table->foreignId('approved_product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamps();
        });

        Schema::create('rd_recipes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rd_product_id')->constrained('rd_products')->cascadeOnDelete();
            $table->foreignId('product_option_id')->nullable()->constrained('product_options')->nullOnDelete();
            $table->foreignId('material_id')->constrained('materials')->cascadeOnDelete();
            $table->decimal('quantity', 10, 2);
            $table->string('kind', 20)->default('ingredient'); // ingredient | packaging (như recipes)
            $table->timestamps();
        });

        Schema::create('rd_product_option_group', function (Blueprint $table) {
            $table->foreignId('rd_product_id')->constrained('rd_products')->cascadeOnDelete();
            $table->foreignId('option_group_id')->constrained('option_groups')->cascadeOnDelete();
            $table->primary(['rd_product_id', 'option_group_id']);
        });

        Schema::create('rd_product_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rd_product_id')->constrained('rd_products')->cascadeOnDelete();
            $table->foreignId('price_list_id')->constrained('price_lists')->cascadeOnDelete();
            $table->decimal('price', 12, 2)->default(0);
            $table->unique(['rd_product_id', 'price_list_id']);
            $table->timestamps();
        });

        Schema::create('rd_fixed_costs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->cascadeOnDelete(); // null = toàn hệ thống
            $table->string('name');
            $table->decimal('amount', 14, 2)->default(0);
            $table->string('source', 20)->default('manual'); // manual | auto_salary | auto_rent | auto_utilities
            $table->string('source_note')->nullable(); // ghi rõ kỳ tính/nguồn số
            $table->boolean('is_overridden')->default(false); // đã sửa tay đè → ngừng tự cập nhật
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rd_fixed_costs');
        Schema::dropIfExists('rd_product_prices');
        Schema::dropIfExists('rd_product_option_group');
        Schema::dropIfExists('rd_recipes');
        Schema::dropIfExists('rd_products');
    }
};
