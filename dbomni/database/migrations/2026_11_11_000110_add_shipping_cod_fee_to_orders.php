<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói Mở COD giao hàng + phí thu hộ phẳng (Đại Vương chốt 2026-11-11,
// spec-mo-cod-giao-hang-phi-thu-ho mục 5): snapshot khoản phí thu hộ COD
// đã cộng vào shipping_fee tại thời điểm chốt đơn. Snapshot thay vì tính
// lại từ setting ship_cod_fee để cấu hình đổi sau này không viết lại
// lịch sử đơn cũ. Mặc định 0 = đơn không có khoản thu hộ (mọi đơn trước
// gói này + đơn không phải giao+COD).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('shipping_cod_fee', 12, 2)->default(0)->after('shipping_fee')
                ->comment('Snapshot phí thu hộ COD đã cộng vào shipping_fee lúc chốt đơn — gói mở COD giao hàng 2026-11-11');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('shipping_cod_fee');
        });
    }
};
