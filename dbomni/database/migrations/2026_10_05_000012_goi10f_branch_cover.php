<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 10f (2026-10-05): cover riêng từng chi nhánh cho trang chủ Mini App.
// Chi nhánh chưa có cover riêng -> dùng cover chung (settings.shop_cover_url).
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('branches') && !Schema::hasColumn('branches', 'cover_url')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->string('cover_url', 500)->nullable()->after('longitude')
                    ->comment('Ảnh cover riêng cho Mini App (null = dùng cover chung)');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('branches') && Schema::hasColumn('branches', 'cover_url')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->dropColumn('cover_url');
            });
        }
    }
};
