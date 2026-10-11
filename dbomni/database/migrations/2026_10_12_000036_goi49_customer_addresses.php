<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 49: sổ địa chỉ giao hàng của khách (Mini App).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
            $table->string('label', 50)->default('Nhà')->comment('Nhãn: Nhà, Công ty...');
            $table->string('province', 100)->nullable();
            $table->string('ward', 100)->nullable();
            $table->string('street', 200)->comment('Số nhà, tên đường');
            $table->boolean('is_default')->default(false);
            $table->timestamps();
            $table->index('customer_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_addresses');
    }
};
