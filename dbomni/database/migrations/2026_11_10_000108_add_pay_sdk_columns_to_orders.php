<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói Checkout SDK (spec spec-checkout-sdk-zalopay.md mục 5, Đại Vương phán
// Đ1–Đ5 2026-11-10): lưu mã đơn phía Checkout SDK + trạng thái SDK gần nhất
// trên orders — notify BANK/COD không mang mã đơn quán nên đối chiếu đơn
// qua pay_sdk_order_id; pay_sdk_status phục vụ đối soát (job
// payments:reconcile-sdk) + hiển thị ở danh sách đơn chờ phía Admin.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('pay_sdk_order_id', 100)->nullable()->index()
                ->comment('Mã đơn phía Checkout SDK (orderId trả về từ createOrder)');
            $table->string('pay_sdk_status', 30)->nullable()
                ->comment('Trạng thái phía SDK gần nhất: created|notified|processing|failed');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['pay_sdk_order_id', 'pay_sdk_status']);
        });
    }
};
