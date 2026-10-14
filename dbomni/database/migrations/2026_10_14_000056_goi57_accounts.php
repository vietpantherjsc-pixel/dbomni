<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 57 (2026-10-14): bảng accounts — quỹ/tài khoản tiền (tiền mặt quầy, két sắt, ngân hàng, ví điện tử).
// Dùng cho phân hệ Thu-Chi: mỗi phiếu thu/chi gắn với 1 quỹ, tính running balance theo quỹ.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('accounts')) {
            return;
        }

        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            if (Schema::hasTable('branches')) {
                $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            } else {
                $table->unsignedBigInteger('branch_id')->nullable();
            }
            $table->string('name', 100)->comment('VD: Tiền mặt quầy, Két sắt, Vietcombank');
            $table->string('type', 20)->default('cash')->comment('cash|safe|bank|ewallet');
            $table->decimal('opening_balance', 15, 0)->default(0)->comment('Số dư đầu kỳ');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('accounts');
    }
};
