<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// =====================================================================
// Gói 17 (2026-10-09): Chiết khấu kênh bán hàng (phần nền tảng thu của quán).
// - commission_rate: % chiết khấu trên doanh thu kênh.
// - commission_tax_included: true = % đã gồm thuế; false = chưa gồm, phải
//   cộng thêm thuế theo commission_tax_rate.
// - commission_tax_rate: thuế suất (%) khi chưa gồm thuế.
// Viết idempotent: kiểm tra hasColumn trước khi thêm (MySQL không rollback
// được DDL nếu migrate fail giữa chừng).
// =====================================================================
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('price_lists')) {
            return;
        }
        Schema::table('price_lists', function (Blueprint $table) {
            if (!Schema::hasColumn('price_lists', 'commission_rate')) {
                $table->decimal('commission_rate', 5, 2)->default(0)
                    ->after('is_active')
                    ->comment('% chiết khấu nền tảng thu trên doanh thu kênh');
            }
            if (!Schema::hasColumn('price_lists', 'commission_tax_included')) {
                $table->boolean('commission_tax_included')->default(true)
                    ->after('commission_rate')
                    ->comment('true = % chiết khấu đã gồm thuế');
            }
            if (!Schema::hasColumn('price_lists', 'commission_tax_rate')) {
                $table->decimal('commission_tax_rate', 5, 2)->nullable()
                    ->after('commission_tax_included')
                    ->comment('Thuế suất % cộng thêm khi chiết khấu chưa gồm thuế');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('price_lists')) {
            return;
        }
        Schema::table('price_lists', function (Blueprint $table) {
            $cols = [];
            foreach (['commission_rate', 'commission_tax_included', 'commission_tax_rate'] as $c) {
                if (Schema::hasColumn('price_lists', $c)) {
                    $cols[] = $c;
                }
            }
            if (!empty($cols)) {
                $table->dropColumn($cols);
            }
        });
    }
};
