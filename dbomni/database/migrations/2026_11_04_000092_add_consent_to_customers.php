<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec đăng ký Zalo phương án B (2026-11-04): lưu mốc đồng ý NĐ 13/2023.
// Chỉ ghi khi đang trống (mốc đầu tiên là mốc pháp lý gốc, không ghi đè về sau).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->timestamp('consent_agreed_at')->nullable()->after('avatar');
            $table->string('consent_source', 30)->nullable()->after('consent_agreed_at');
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn(['consent_agreed_at', 'consent_source']);
        });
    }
};
