<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Spec KM điều kiện chống mã (2026-10-21) — Phần C: cài đặt chồng mã TỪNG chương trình.
// promotions + vouchers thêm 2 cờ (mặc định TẮT):
// - stack_with_coupon: chương trình được cộng dồn với mã coupon/voucher
// - stack_with_promotion: chương trình/mã được cộng dồn với khuyến mại khác
// Coupon ví kế thừa 2 cờ từ Promotion gốc (không cài riêng từng coupon).
return new class extends Migration
{
    public function up(): void
    {
        foreach (['promotions', 'vouchers'] as $table) {
            if (!Schema::hasTable($table)) {
                continue;
            }
            Schema::table($table, function (Blueprint $t) use ($table) {
                if (!Schema::hasColumn($table, 'stack_with_coupon')) {
                    $t->boolean('stack_with_coupon')->default(false);
                }
                if (!Schema::hasColumn($table, 'stack_with_promotion')) {
                    $t->boolean('stack_with_promotion')->default(false);
                }
            });
        }
    }

    public function down(): void
    {
        foreach (['promotions', 'vouchers'] as $table) {
            if (!Schema::hasTable($table)) {
                continue;
            }
            Schema::table($table, function (Blueprint $t) use ($table) {
                foreach (['stack_with_coupon', 'stack_with_promotion'] as $col) {
                    if (Schema::hasColumn($table, $col)) {
                        $t->dropColumn($col);
                    }
                }
            });
        }
    }
};
