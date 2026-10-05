<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 7f (2026-10-05): thứ tự món trong thực đơn (kéo-thả sắp xếp).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('menu_product', 'sort_order')) {
            Schema::table('menu_product', function (Blueprint $table) {
                $table->integer('sort_order')->default(0)->after('product_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('menu_product', 'sort_order')) {
            Schema::table('menu_product', function (Blueprint $table) {
                $table->dropColumn('sort_order');
            });
        }
    }
};
