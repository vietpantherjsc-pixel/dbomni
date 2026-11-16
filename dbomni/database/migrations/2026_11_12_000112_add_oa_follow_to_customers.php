<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Nút Quan tâm OA ngay trong Mini App (Đại Vương chốt 2026-11-12,
// spec-nut-quan-tam-oa-trong-app mục 2): server giữ BẢN SAO trạng thái
// quan tâm OA của khách cho Admin dùng — nguồn sự thật vẫn là Zalo
// (followedOA phía client). oa_followed_at = mốc khách được ghi nhận
// đã quan tâm (null = chưa/không còn quan tâm); zalo_oa_uid = idByOA
// (định danh khách theo OA, chỉ có khi đã quan tâm — để dành làm định
// danh gửi tin OA sau này). Khách cũ mặc định null = chưa ghi nhận.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->timestamp('oa_followed_at')->nullable()->after('consent_source')
                ->comment('Mốc ghi nhận khách đã quan tâm OA Daybreak (bản sao từ Zalo followedOA) — spec Quan tâm OA 2026-11-12');
            $table->string('zalo_oa_uid', 100)->nullable()->after('oa_followed_at')
                ->comment('idByOA: định danh khách theo OA (chỉ có khi đã quan tâm) — spec Quan tâm OA 2026-11-12');
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn(['zalo_oa_uid', 'oa_followed_at']);
        });
    }
};
