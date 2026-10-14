<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p2: giờ mở cửa chi nhánh (JSON) để Mini App hiện trạng thái Đang mở/Đã đóng.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->json('opening_hours')->nullable()->after('phone')
                ->comment('Giờ mở cửa: {mode:all|daily, open, close, days:{0:{open,close,off}...}}');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('opening_hours');
        });
    }
};
