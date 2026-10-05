<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 3e (2026-10-04): Chiết khấu từng món (giống popup Sapo: "Giảm giá mặt hàng").
// Lưu số tiền đã giảm trên từng dòng order_items.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('discount_amount', 15, 0)->default(0)->after('total_price')
                ->comment('Số tiền giảm giá của dòng món');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('discount_amount');
        });
    }
};
