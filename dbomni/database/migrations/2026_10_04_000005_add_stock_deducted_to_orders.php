<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 3b (2026-10-04): Đánh dấu đơn đã trừ kho hay chưa.
// - Đơn thanh toán ngay: stock_deducted = true (trừ kho lúc tạo đơn, như cũ).
// - Đơn tạm lưu (held): stock_deducted = false (chưa trừ kho, chỉ trừ khi bấm Thanh toán).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->boolean('stock_deducted')->default(true)->after('payment_status');
        });

        // Các đơn held cũ (nếu có) chưa từng trừ kho
        \Illuminate\Support\Facades\DB::table('orders')
            ->where('status', 'held')
            ->update(['stock_deducted' => false]);
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('stock_deducted');
        });
    }
};
