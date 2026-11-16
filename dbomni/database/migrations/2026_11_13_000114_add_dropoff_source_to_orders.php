<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói geocode lai NDAMaps (spec-tich-hop-geocode-lai-ndamaps, Đại Vương
// chốt 2026-11-13): ghi nguồn điểm giao của đơn để nhân viên biết điểm
// nào cần soi lại phí — ladder (thang Nominatim) · ndamaps_place (chọn
// gợi ý NDAMaps) · ndamaps_forward (cứu cánh khi thang rỗng) · saved
// (địa chỉ đã lưu có tọa độ). Cờ là thông tin, không mang tiền: phí vẫn
// tính lại từ tọa độ như luật một nguồn. Số 000114 theo thứ tự đã chốt
// (lai 000114 · tích điểm 000115 · RT-03 000116).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('dropoff_source', 30)->nullable()->after('delivery_dropoff_lng')
                ->comment('Nguồn điểm giao (geocode lai 2026-11-13): ladder | ndamaps_place | ndamaps_forward | saved');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('dropoff_source');
        });
    }
};
