<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 30b (2026-10-09): tick "Áp dụng lương trách nhiệm" từng nhân viên.
// Idempotent: chỉ thêm cột khi chưa có.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('employees') && !Schema::hasColumn('employees', 'apply_responsibility')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->boolean('apply_responsibility')->default(true)->after('is_active')
                    ->comment('Áp dụng lương trách nhiệm (chính sách chung)');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('employees') && Schema::hasColumn('employees', 'apply_responsibility')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->dropColumn('apply_responsibility');
            });
        }
    }
};
