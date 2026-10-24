<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Audit 2026-10-23 KHO-10: độ chính xác thập phân của lô không đồng nhất —
// batches.initial_quantity/current_quantity đang decimal(10,2) trong khi
// stock_movements.quantity là decimal(14,4) và định mức cho phép lẻ tới
// 0.001 -> mỗi lần ghi lô bị làm tròn 2 số lẻ, trôi tích lũy và lệch đối
// chiếu log <-> tồn. Nới 2 cột của batches lên decimal(14,4) cho khớp.
// Migration CỘNG THÊM (chỉ đổi kiểu cột), không đụng dữ liệu.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('batches', function (Blueprint $table) {
            $table->decimal('initial_quantity', 14, 4)->change();
            $table->decimal('current_quantity', 14, 4)->change();
        });
    }

    public function down(): void
    {
        Schema::table('batches', function (Blueprint $table) {
            $table->decimal('initial_quantity', 10, 2)->change();
            $table->decimal('current_quantity', 10, 2)->change();
        });
    }
};
