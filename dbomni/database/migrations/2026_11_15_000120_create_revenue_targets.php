<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 2, N-3 (Phụ lục khóa 2026-11-15): mục
// tiêu doanh thu tháng theo (chi nhánh × tháng), phục vụ TC-3 (dự báo
// cuối tháng + lệch mục tiêu). Chỉ theo từng CN — không nhập mục tiêu
// cho "Tất cả" (view toàn chuỗi = tổng các mục tiêu CN).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('revenue_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained('branches');
            $table->date('month')->comment('Ngày đầu tháng mục tiêu (YYYY-MM-01)');
            $table->decimal('target_amount', 15, 2);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->unique(['branch_id', 'month']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('revenue_targets');
    }
};
