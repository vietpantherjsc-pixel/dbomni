<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 48: ảnh banner cho chương trình khuyến mại (hiển thị carousel trong Zalo Mini App).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('promotions', 'banner_url')) {
            Schema::table('promotions', function (Blueprint $table) {
                $table->string('banner_url', 500)->nullable()->after('is_active');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('promotions', 'banner_url')) {
            Schema::table('promotions', function (Blueprint $table) {
                $table->dropColumn('banner_url');
            });
        }
    }
};
