<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// SPEC-01: Nhật ký notify từ Zalo Checkout SDK (đối soát + idempotency).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_notifies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->string('pay_channel', 20)->nullable();
            $table->string('pay_trans_id', 100)->nullable();
            $table->decimal('amount', 15, 2)->nullable();
            $table->string('status', 30)->nullable()->comment('Trạng thái từ Zalo');
            $table->boolean('mac_valid')->default(false);
            $table->boolean('processed')->default(false)->comment('Đã xử lý (idempotent)');
            $table->json('payload')->nullable()->comment('Raw notify payload');
            $table->timestamps();

            $table->index('pay_trans_id');
            $table->index('order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_notifies');
    }
};
