<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec cài đặt danh sách (2026-10-21): Đơn vị tính thêm Nhóm / Trạng thái / Thứ tự
// để hiển thị dạng bảng L1 thay cho chip. group: count|mass|volume|other.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('units')) {
            return;
        }
        Schema::table('units', function (Blueprint $table) {
            if (!Schema::hasColumn('units', 'group')) {
                $table->string('group', 20)->default('count');
            }
            if (!Schema::hasColumn('units', 'is_active')) {
                $table->boolean('is_active')->default(true);
            }
            if (!Schema::hasColumn('units', 'sort_order')) {
                $table->integer('sort_order')->default(0);
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('units')) {
            return;
        }
        Schema::table('units', function (Blueprint $table) {
            foreach (['group', 'is_active', 'sort_order'] as $col) {
                if (Schema::hasColumn('units', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
