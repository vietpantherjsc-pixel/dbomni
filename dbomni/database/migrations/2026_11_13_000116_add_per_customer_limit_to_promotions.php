<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói B cụm treo cũ — RT-03 (Đại Vương phán LÀM 2026-11-13, PM xếp gói
// riêng B): KM thủ công trước đây không có giới hạn lượt dùng theo khách
// (bảng promotions không có cột, PromotionService không đếm) — khách dùng
// lại KM "1 lần/khách" bao nhiêu lần cũng được. Thêm cột trần theo khách
// noi khuôn vouchers.per_customer_limit: NULL = không giới hạn (toàn bộ
// KM hiện có giữ nguyên hành vi). Thực thi tại
// PromotionService::checkConditions (đường online, đếm đơn online chưa
// hủy của khách mang KM này).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->unsignedInteger('per_customer_limit')->nullable()->after('max_discount_amount')
                ->comment('Trần lượt dùng theo khách (RT-03 2026-11-13); null = không giới hạn');
        });
    }

    public function down(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->dropColumn('per_customer_limit');
        });
    }
};
