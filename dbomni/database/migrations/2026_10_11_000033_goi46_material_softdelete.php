<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 46: xóa mềm nguyên liệu/bán thành phẩm (tồn=0 mới được xóa, giữ lại lịch sử).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('materials', 'deleted_at')) {
            Schema::table('materials', function (Blueprint $table) {
                $table->softDeletes();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('materials', 'deleted_at')) {
            Schema::table('materials', function (Blueprint $table) {
                $table->dropSoftDeletes();
            });
        }
    }
};
