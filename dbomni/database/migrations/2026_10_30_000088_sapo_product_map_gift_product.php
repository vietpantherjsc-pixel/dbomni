<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Đợt tối ưu import Sapo (2026-10-30, phương án 3 tầng + combo đã chốt):
// thêm cột gift_product_id vào sapo_product_map — dòng map có gift_product_id
// = định nghĩa combo Mua 1 Tặng 1 (product_id = món chính, gift_product_id =
// món tặng); import bung dòng combo thành 2 dòng đơn. Thuần THÊM cột khóa
// ngoại mới (nullable, nullOnDelete như các FK khác của hệ) — không đụng
// index/FK hiện hữu nên không có rủi ro kiểu MySQL 1553 của 000083.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sapo_product_map', function (Blueprint $table) {
            $table->foreignId('gift_product_id')
                ->nullable()
                ->after('product_id')
                ->constrained('products')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('sapo_product_map', function (Blueprint $table) {
            $table->dropConstrainedForeignId('gift_product_id');
        });
    }
};
