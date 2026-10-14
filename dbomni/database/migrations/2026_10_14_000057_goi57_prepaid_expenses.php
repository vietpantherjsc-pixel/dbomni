<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 57 (2026-10-14): bảng prepaid_expenses — chi phí trả trước & CAPEX phân bổ đều theo tháng.
// VD: tiền thuê trả 6 tháng → chia đều 6 kỳ; máy pha cà phê khấu hao 36 tháng.
// P&L đọc bảng này để cộng chi phí phân bổ của từng tháng, thay vì dồn 1 cục vào tháng chi tiền.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('prepaid_expenses')) {
            return;
        }

        Schema::create('prepaid_expenses', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('branch_id')->nullable()->comment('null = áp dụng toàn hệ thống');
            $table->string('name', 150)->comment('VD: Tiền thuê Q4, Máy pha cà phê');
            $table->string('category', 20)->default('other')->comment('rent|capex|software|other');
            $table->decimal('total_amount', 15, 0)->comment('Tổng số tiền đã chi');
            $table->date('start_date')->comment('Tháng bắt đầu phân bổ');
            $table->integer('months')->comment('Số tháng phân bổ đều');
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prepaid_expenses');
    }
};
