<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11z: phiếu XUẤT KHO (trừ kho theo FIFO khi chốt)
return new class extends Migration {
    public function up(): void {
        Schema::create('outbound_receipts', function (Blueprint $table) {
            $table->id();
            $table->string('code', 30)->unique()->comment('VD: XK-0001');
            $table->foreignId('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->string('reason', 30)->default('other')->comment('damaged: hủy hàng, internal_use: dùng nội bộ, sale: xuất bán, other: khác');
            $table->text('note')->nullable();
            $table->string('status', 20)->default('draft')->comment('draft: nháp, confirmed: đã chốt, cancelled: đã hủy');
            $table->decimal('total_quantity', 14, 2)->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['branch_id', 'status']);
        });

        Schema::create('outbound_receipt_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('outbound_receipt_id')->constrained('outbound_receipts')->cascadeOnDelete();
            $table->foreignId('material_id')->constrained('materials')->restrictOnDelete();
            $table->decimal('quantity', 14, 2);
            $table->string('unit', 20)->comment('đơn vị cơ sở của nguyên liệu tại thời điểm xuất');
            $table->text('note')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void {
        Schema::dropIfExists('outbound_receipt_items');
        Schema::dropIfExists('outbound_receipts');
    }
};
