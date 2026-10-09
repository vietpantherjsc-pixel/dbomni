<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 25 (2026-10-09): ẩn/hiện mặt hàng & thực đơn theo chi nhánh.
// Quy tắc: mặc định HIỆN ở tất cả CN -> bảng chỉ lưu override ẨN.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('branch_product_hidden')) {
            Schema::create('branch_product_hidden', function (Blueprint $table) {
                $table->id();
                $table->foreignId('branch_id')->constrained('branches')->cascadeOnDelete();
                $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
                $table->unique(['branch_id', 'product_id']);
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('branch_menu_hidden')) {
            Schema::create('branch_menu_hidden', function (Blueprint $table) {
                $table->id();
                $table->foreignId('branch_id')->constrained('branches')->cascadeOnDelete();
                $table->foreignId('menu_id')->constrained('menus')->cascadeOnDelete();
                $table->unique(['branch_id', 'menu_id']);
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_product_hidden');
        Schema::dropIfExists('branch_menu_hidden');
    }
};
