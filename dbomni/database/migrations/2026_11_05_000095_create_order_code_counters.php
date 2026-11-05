<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Sổ #92 — C1 (2026-11-05): bảng bộ đếm mã đơn theo ngày cho Order::nextCode().
// Trước đây seq sinh bằng count() đơn trong ngày + kiểm exists() trước khi
// ghi — hai request đồng thời cùng đọc một count, cùng chọn một mã, request
// thua nổ 1062 trên index unique của orders.code. Từ nay seq lấy từ bộ đếm
// nguyên tử của bảng này (mỗi ngày một dòng), hai request không bao giờ
// nhận cùng một số. Bộ đếm tự gieo từ số đơn đã phát hành trong ngày ở mỗi
// lần cấp (GREATEST trong câu upsert phía model) nên không cần seed ở đây.
// Guard 2 chiều như lệ nhà: up() bỏ qua nếu bảng đã tồn tại, down() chỉ
// drop khi bảng còn.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('order_code_counters')) {
            return;
        }
        Schema::create('order_code_counters', function (Blueprint $table) {
            $table->id();
            $table->date('day')->unique();
            $table->unsignedBigInteger('seq')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_code_counters');
    }
};
