<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11ad (2026-10-14): nhật ký xuất kho chi tiết từng lô.
// Mỗi lần trừ kho (bán hàng, gộp đơn, finalize...) ghi 1 dòng/lô:
// batch_id + số lượng trừ + đơn giá vốn của lô đó — phục vụ truy vết & đối chiếu.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('stock_movements')) {
            Schema::create('stock_movements', function (Blueprint $table) {
                $table->id();
                $table->foreignId('branch_id')->constrained('branches');
                $table->foreignId('material_id')->constrained('materials');
                $table->foreignId('batch_id')->nullable()->constrained('batches')->nullOnDelete();
                $table->decimal('quantity', 14, 4)->comment('Số lượng trừ (dương) / nhập (âm đảo dấu khi hoàn)');
                $table->decimal('unit_cost', 14, 2)->default(0)->comment('Đơn giá vốn của lô tại thời điểm trừ');
                $table->string('reference_type', 30)->nullable()->comment('order|production|adjustment...');
                $table->unsignedBigInteger('reference_id')->nullable();
                $table->string('note', 255)->nullable();
                $table->timestamps();
                $table->index(['branch_id', 'material_id']);
                $table->index(['reference_type', 'reference_id']);
                $table->index('batch_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
    }
};
