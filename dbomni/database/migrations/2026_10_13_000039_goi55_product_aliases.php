<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55: bảng tên thay thế món — map tên cũ (từ file import/app khác) về món hiện tại
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('product_aliases')) return;
        Schema::create('product_aliases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('alias_name', 255)->comment('Tên cũ/tên khác của món');
            $table->timestamps();
            $table->unique(['product_id', 'alias_name']);
            $table->index('alias_name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_aliases');
    }
};
