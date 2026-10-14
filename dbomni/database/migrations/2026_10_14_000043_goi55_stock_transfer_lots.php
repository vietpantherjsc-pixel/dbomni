<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55: chi tiết từng lô của dòng phiếu chuyển kho (chống last-wins khi chốt)
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('stock_transfer_item_lots')) {
            Schema::create('stock_transfer_item_lots', function (Blueprint $table) {
                $table->id();
                $table->foreignId('stock_transfer_item_id')->constrained('stock_transfer_items')->onDelete('cascade');
                $table->foreignId('batch_id')->nullable()->constrained('batches')->nullOnDelete()
                    ->comment('Lô nguồn đã trừ');
                $table->foreignId('to_batch_id')->nullable()->constrained('batches')->nullOnDelete()
                    ->comment('Lô đích đã nhập');
                $table->decimal('quantity', 10, 2);
                $table->decimal('unit_cost', 12, 2)->default(0);
                $table->timestamps();
            });
        }
    }

    public function down(): void {
        Schema::dropIfExists('stock_transfer_item_lots');
    }
};
