<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 12a (2026-10-07): mốc hoàn thành đơn để Mini App giới hạn tra cứu 24h.
// Đơn hoàn thành quá 24h: ẩn khỏi Mini App (track + lịch sử Tài khoản),
// nhưng server vẫn giữ đủ để tính điểm và hạng thành viên.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('orders') && !Schema::hasColumn('orders', 'completed_at')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dateTime('completed_at')->nullable()->after('cancelled_at')
                    ->comment('Thời điểm đơn hoàn thành (để giới hạn tra cứu Mini App 24h)');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('orders') && Schema::hasColumn('orders', 'completed_at')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropColumn('completed_at');
            });
        }
    }
};
