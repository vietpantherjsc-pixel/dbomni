<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11ag (2026-10-14): truy vết người hủy đơn — chống gian lận
// hủy đơn đã thanh toán rồi bỏ tiền túi.
// - cancelled_by: tên NV/admin hoặc "customer:SĐT"
// - cancelled_by_type: user|employee|customer
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('orders') && !Schema::hasColumn('orders', 'cancelled_by')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->string('cancelled_by', 100)->nullable()->after('cancelled_at')
                    ->comment('Người hủy: tên NV/admin hoặc customer:SĐT');
                $table->string('cancelled_by_type', 20)->nullable()->after('cancelled_by')
                    ->comment('user|employee|customer');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('orders') && Schema::hasColumn('orders', 'cancelled_by')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropColumn(['cancelled_by', 'cancelled_by_type']);
            });
        }
    }
};
