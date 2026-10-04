<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained('branches')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade')->comment('Thu ngân mở ca');
            $table->timestamp('opened_at')->useCurrent()->comment('Thời gian mở ca');
            $table->timestamp('closed_at')->nullable()->comment('Thời gian chốt ca');
            $table->decimal('opening_cash', 12, 2)->default(0)->comment('Tiền két đầu ca');
            $table->decimal('closing_cash_actual', 12, 2)->nullable()->comment('Tiền mặt thực kiểm cuối ca');
            $table->decimal('expected_cash', 12, 2)->nullable()->comment('Tiền mặt dự kiến (Tiền đầu + Doanh thu mặt)');
            $table->decimal('cash_difference', 12, 2)->nullable()->comment('Chênh lệch tiền mặt thực tế vs dự kiến');
            $table->decimal('total_cash_sales', 12, 2)->default(0)->comment('Tổng doanh thu tiền mặt');
            $table->decimal('total_digital_sales', 12, 2)->default(0)->comment('Tổng doanh thu chuyển khoản/ZaloPay');
            $table->string('status', 20)->default('open')->comment('Trạng thái: open, closed');
            $table->text('note')->nullable()->comment('Ghi chú giải trình chênh lệch');
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('shifts');
    }
};