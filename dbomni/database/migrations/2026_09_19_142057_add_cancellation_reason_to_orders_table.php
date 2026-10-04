<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('cancel_reason')->nullable()->after('status')->comment('Lý do hủy đơn hàng');
            $table->timestamp('cancelled_at')->nullable()->after('cancel_reason')->comment('Thời gian hủy đơn');
        });
    }

    public function down(): void {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['cancel_reason', 'cancelled_at']);
        });
    }
};