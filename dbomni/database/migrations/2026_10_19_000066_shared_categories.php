<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec danh mục dùng chung (Đại Vương chốt 2026-10-19): bảng shared_categories + seed 13 tab.
// Idempotent: chạy lại không trùng code, không xóa code custom của người dùng.
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('shared_categories')) {
            Schema::create('shared_categories', function (Blueprint $table) {
                $table->id();
                $table->string('group', 50);   // mã tab danh mục
                $table->string('code', 50);    // mã giá trị
                $table->string('name', 150);   // nhãn hiển thị
                $table->integer('sort_order')->default(0);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
                $table->unique(['group', 'code']);
                $table->index(['group', 'is_active']);
            });
        }

        // Seed mặc định (chỉ thêm code thiếu, không xóa custom)
        (new \Database\Seeders\SharedCategorySeeder())->run();
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_categories');
    }
};
