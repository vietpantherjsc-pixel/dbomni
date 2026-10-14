<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 55 p11ae: lưu danh tính người mở ca để kiểm tra chủ ca khi thêm chi/chốt ca
// (trước đây cashier_name là text tự do, NV bất kỳ thêm chi/chốt ca của người khác được).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->string('opened_by_name', 100)->nullable()->after('cashier_name');
        });
    }

    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropColumn('opened_by_name');
        });
    }
};
