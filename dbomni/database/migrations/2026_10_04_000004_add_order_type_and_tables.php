<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 3 (2026-10-04): Loại đơn hàng (mang đi / giao hàng / tại bàn) + bàn phục vụ.
return new class extends Migration
{
    public function up(): void
    {
        // 1. Thêm order_type vào orders
        Schema::table('orders', function (Blueprint $table) {
            $table->string('order_type', 20)->default('takeaway')->after('branch_id')
                ->comment('takeaway: mang đi, delivery: giao hàng, dine_in: tại bàn');
            $table->unsignedBigInteger('table_id')->nullable()->after('order_type')
                ->comment('Bàn phục vụ (chỉ khi dine_in)');
        });

        // 2. Bảng bàn
        Schema::create('tables', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('branch_id');
            $table->string('name', 50)->comment('Tên bàn: B01, B02...');
            $table->string('status', 20)->default('empty')->comment('empty: trống, occupied: có khách');
            $table->timestamps();

            $table->index('branch_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tables');
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['order_type', 'table_id']);
        });
    }
};
