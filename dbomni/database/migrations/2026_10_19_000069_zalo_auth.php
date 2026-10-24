<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec P4-P5 (khắc phục kiểm duyệt Zalo): link customer với user Zalo.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            if (!Schema::hasColumn('customers', 'zalo_id')) {
                $table->string('zalo_id', 50)->nullable()->unique()->after('phone');
            }
            if (!Schema::hasColumn('customers', 'avatar')) {
                $table->string('avatar', 500)->nullable()->after('zalo_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            if (Schema::hasColumn('customers', 'avatar')) $table->dropColumn('avatar');
            if (Schema::hasColumn('customers', 'zalo_id')) $table->dropColumn('zalo_id');
        });
    }
};
