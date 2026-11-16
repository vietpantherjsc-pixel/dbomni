<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 2, N-1 (Phụ lục khóa 2026-11-15):
// ngày hẹn giao trên phiếu đặt hàng NCC, phục vụ KHO-4b (giao đủ/đúng
// hẹn). NULL = phiếu cũ / chưa hẹn → loại khỏi mẫu đúng hẹn, đếm riêng
// vào nhóm "chưa có hẹn giao" (không hồi tố dữ kiện cũ).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->date('expected_date')->nullable()->after('order_date')
                ->comment('Ngày hẹn giao NCC — KHO-4b (360 đợt 2, N-1)');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn('expected_date');
        });
    }
};
