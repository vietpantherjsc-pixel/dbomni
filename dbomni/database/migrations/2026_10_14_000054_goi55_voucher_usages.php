<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11af (2026-10-14): P0-12 — giới hạn lượt dùng voucher theo từng khách hàng.
// - Bảng voucher_usages: log mỗi lần KH dùng voucher (để đếm + truy vết, chống share mã tràn lan).
// - Cột vouchers.per_customer_limit: số lần tối đa 1 KH được dùng (null = không giới hạn).
return new class extends Migration {
    public function up(): void
    {
        Schema::create('voucher_usages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('voucher_id')->constrained('vouchers')->cascadeOnDelete();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->dateTime('used_at')->comment('Thời điểm dùng voucher');
            $table->timestamps();
            $table->index(['voucher_id', 'customer_id']);
        });

        Schema::table('vouchers', function (Blueprint $table) {
            $table->integer('per_customer_limit')->nullable()->after('usage_limit')
                ->comment('Giới hạn số lần mỗi khách hàng được dùng (null = không giới hạn)');
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropColumn('per_customer_limit');
        });
        Schema::dropIfExists('voucher_usages');
    }
};
