<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 2, N-4 (Phụ lục khóa 2026-11-15): nguồn
// điểm ghi tay — cột manual_source trên cả point_lots (lô tạo tay) và
// point_transactions (giao dịch trừ tay theo lô). Dữ kiện cũ giữ NULL
// (báo cáo gom vào nhóm "chưa phân loại", không ép hồi tố).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('point_lots', function (Blueprint $table) {
            $table->string('manual_source', 30)->nullable()->after('source_type')
                ->comment('Nguồn điểm ghi tay N-4: compensation | care_promo | balance_correction | other | null (không phải ghi tay / dữ kiện cũ)');
        });
        Schema::table('point_transactions', function (Blueprint $table) {
            $table->string('manual_source', 30)->nullable()->after('type')
                ->comment('Nguồn điểm ghi tay N-4 (cùng danh mục với point_lots.manual_source)');
        });
    }

    public function down(): void
    {
        Schema::table('point_lots', function (Blueprint $table) {
            $table->dropColumn('manual_source');
        });
        Schema::table('point_transactions', function (Blueprint $table) {
            $table->dropColumn('manual_source');
        });
    }
};
