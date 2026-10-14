<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 52 (2026-10-12): phương thức thanh toán + đơn vị tính
return new class extends Migration
{
    public function up(): void
    {
        // Phương thức thanh toán: tên + loại + kênh áp dụng (pos/zalo) + bật/tắt
        if (!Schema::hasTable('payment_methods')) {
            Schema::create('payment_methods', function (Blueprint $table) {
                $table->id();
                $table->string('name', 100); // VD: Chuyển khoản Techcombank
                $table->string('type', 30)->default('transfer'); // transfer, cash, debit_card, credit_card, ewallet, other
                $table->json('channels')->nullable(); // ["pos","zalo"] — null = tất cả
                $table->boolean('is_active')->default(true);
                $table->integer('sort_order')->default(0);
                $table->timestamps();
            });
        }

        // Đơn vị tính dùng chung toàn hệ thống
        if (!Schema::hasTable('units')) {
            Schema::create('units', function (Blueprint $table) {
                $table->id();
                $table->string('name', 50)->unique(); // VD: Ly, Chai, Kg
                $table->timestamps();
            });
            // Seed đơn vị mặc định
            DB::table('units')->insert([
                ['name' => 'Ly', 'created_at' => now(), 'updated_at' => now()],
                ['name' => 'Chai', 'created_at' => now(), 'updated_at' => now()],
                ['name' => 'Kg', 'created_at' => now(), 'updated_at' => now()],
                ['name' => 'Gói', 'created_at' => now(), 'updated_at' => now()],
                ['name' => 'Hộp', 'created_at' => now(), 'updated_at' => now()],
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_methods');
        Schema::dropIfExists('units');
    }
};
