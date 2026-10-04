<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('material_id')->constrained('materials')->onDelete('cascade')->comment('Khóa ngoại nguyên liệu');
            $table->foreignId('branch_id')->constrained('branches')->onDelete('cascade')->comment('Khóa ngoại chi nhánh sở hữu kho');
            $table->string('batch_code', 50)->comment('Mã lô hàng nhập');
            $table->decimal('initial_quantity', 10, 2)->comment('Số lượng nhập ban đầu');
            $table->decimal('current_quantity', 10, 2)->comment('Số lượng tồn hiện tại của lô');
            $table->decimal('unit_cost', 12, 2)->comment('Giá vốn trên một đơn vị nhập vào');
            $table->dateTime('expired_at')->nullable()->comment('Hạn sử dụng của lô');
            $table->string('status', 20)->default('active')->comment('Trạng thái: active (còn hàng), exhausted (hết hàng)');
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('batches');
    }
};