<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 7c (2026-10-05): lưu nhiều tùy chọn / dòng món (Size + Độ ngọt + Đá + Topping).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('order_items', 'options')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->json('options')->nullable()->after('product_option_id')
                    ->comment('Gói 7c: danh sách tùy chọn [{name, price}]');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('order_items', 'options')) {
            Schema::table('order_items', function (Blueprint $table) {
                $table->dropColumn('options');
            });
        }
    }
};
