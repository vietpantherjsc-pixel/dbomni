<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec Thanh toán QR (2026-10-21) — phương án A (NV xác nhận tay):
// orders.customer_notified_at: mốc khách bấm "Tôi đã chuyển khoản" trên Mini App.
// NV dựa vào cờ này + thời gian chờ (setting zalo_pay_wait_alert_minutes) để đối chiếu sao kê.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'customer_notified_at')) {
                $table->timestamp('customer_notified_at')->nullable()->after('pay_notified_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'customer_notified_at')) {
                $table->dropColumn('customer_notified_at');
            }
        });
    }
};
