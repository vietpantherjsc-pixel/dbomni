<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Chương trình chỉ số 360 — Đợt 1 (spec 2026-11-15, mục TC-1): danh mục
// thu-chi cần thuộc tính loại chi phí Cố định / Biến đổi để tính điểm hòa
// vốn tháng. NULL = chưa phân loại → chỉ số hòa vốn báo "chưa đủ cấu hình"
// kèm danh sách danh mục chưa phân loại (không tự đoán). Chỉ áp cho danh
// mục loại expense; danh mục income để NULL.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transaction_categories', function (Blueprint $table) {
            $table->string('cost_type', 10)->nullable()->after('type')
                ->comment('fixed | variable | null (chưa phân loại) — hòa vốn TC-1, chỉ số 360 đợt 1');
        });
    }

    public function down(): void
    {
        Schema::table('transaction_categories', function (Blueprint $table) {
            $table->dropColumn('cost_type');
        });
    }
};
