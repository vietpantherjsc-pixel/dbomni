<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11ac: lưu giá vốn thực tế (FIFO) tại thời điểm trừ kho vào order_items
// để báo cáo COGS không bị thay đổi ngược thời gian
return new class extends Migration {
    public function up(): void {
        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('unit_cost', 12, 2)->nullable()->after('unit_price')
                ->comment('Giá vốn bình quân 1 đơn vị tại lúc trừ kho (FIFO)');
        });
    }

    public function down(): void {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('unit_cost');
        });
    }
};
