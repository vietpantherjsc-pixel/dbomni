<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11ac: idempotency key chống tạo trùng đơn khi retry mạng
return new class extends Migration {
    public function up(): void {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('client_key', 64)->nullable()->unique()->after('code')
                ->comment('Idempotency key do client sinh (UUID), chống tạo trùng đơn');
        });
    }

    public function down(): void {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropUnique(['client_key']);
            $table->dropColumn('client_key');
        });
    }
};
