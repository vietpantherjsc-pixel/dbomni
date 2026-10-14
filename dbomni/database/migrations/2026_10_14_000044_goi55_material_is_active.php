<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11w: trạng thái hoạt động/ngưng bán nguyên liệu
// Nguyên liệu ngưng bán không hiện trong danh sách kiểm kho
return new class extends Migration {
    public function up(): void {
        Schema::table('materials', function (Blueprint $table) {
            $table->boolean('is_active')->default(true)->after('minimum_stock')
                ->comment('true: đang hoạt động, false: ngưng bán');
        });
    }

    public function down(): void {
        Schema::table('materials', function (Blueprint $table) {
            $table->dropColumn('is_active');
        });
    }
};
