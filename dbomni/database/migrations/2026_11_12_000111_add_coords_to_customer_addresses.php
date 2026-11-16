<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói Đơn giao bắt buộc ghim vị trí (Đại Vương chốt Phương án 1,
// 2026-11-12, spec-don-giao-bat-buoc-ghim-vi-tri mục 5): địa chỉ đã lưu
// mang theo TỌA ĐỘ GHIM để lần sau chọn là qua cổng ngay. Nullable —
// toàn bộ địa chỉ tạo trước gói này có tọa độ null (ghim bổ sung một
// lần khi dùng lại, client lưu ngay lúc ghim thành công).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->decimal('lat', 10, 8)->nullable()->after('street')
                ->comment('Vĩ độ điểm giao đã ghim — gói bắt buộc ghim vị trí 2026-11-12');
            $table->decimal('lng', 11, 8)->nullable()->after('lat')
                ->comment('Kinh độ điểm giao đã ghim — gói bắt buộc ghim vị trí 2026-11-12');
        });
    }

    public function down(): void
    {
        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->dropColumn(['lat', 'lng']);
        });
    }
};
