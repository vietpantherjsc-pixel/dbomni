<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec đơn nhóm đồng bộ (2026-10-21): group_orders lưu đơn đã chốt để mọi thành viên
// trong nhóm thấy mã đơn + theo dõi, không chỉ trưởng nhóm.
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('group_orders')) {
            return;
        }
        Schema::table('group_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('group_orders', 'order_id')) {
                $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('group_orders') || !Schema::hasColumn('group_orders', 'order_id')) {
            return;
        }
        Schema::table('group_orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('order_id');
        });
    }
};
