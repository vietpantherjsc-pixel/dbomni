<?php

use App\Models\Setting;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 30d (2026-10-09): chính sách suất ăn — giá/suất + ngưỡng giờ tự tính.
// - salary_days.meal_manual: true = người dùng chỉnh tay, false = hệ thống tự tính theo ngưỡng giờ.
// - settings: meal_price (đ/suất), meal_min_hours (giờ/ngày để tự tính 1 suất).
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('salary_days') && !Schema::hasColumn('salary_days', 'meal_manual')) {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->boolean('meal_manual')->default(false)->after('meal_count')
                    ->comment('Suất ăn chỉnh tay (true) hay tự tính theo giờ (false)');
            });
        }
        if (!Setting::where('key', 'meal_price')->exists()) {
            $old = Setting::where('key', 'meal_allowance_amount')->value('value');
            Setting::set('meal_price', $old !== null ? (float) $old : 30000);
        }
        if (!Setting::where('key', 'meal_min_hours')->exists()) {
            Setting::set('meal_min_hours', 14.5);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('salary_days') && Schema::hasColumn('salary_days', 'meal_manual')) {
            Schema::table('salary_days', function (Blueprint $table) {
                $table->dropColumn('meal_manual');
            });
        }
    }
};
