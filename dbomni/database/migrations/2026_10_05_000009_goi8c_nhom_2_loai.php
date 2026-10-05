<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 8c (2026-10-05): 2 loại nhóm tùy chọn + phân biệt nguyên liệu/bao bì.
// - option_groups.quantity_mode: 'fixed' (định lượng cố định, set ở trang nhóm — VD: Topping)
//   | 'per_product' (định lượng theo món, set trong form từng món — VD: Size)
// - recipes.kind: 'ingredient' (nguyên liệu) | 'packaging' (bao bì)
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('option_groups') && !Schema::hasColumn('option_groups', 'quantity_mode')) {
            Schema::table('option_groups', function (Blueprint $table) {
                $table->string('quantity_mode', 20)->default('fixed')->after('type')
                    ->comment('fixed: định lượng cố định | per_product: định lượng theo món');
            });
        }

        if (Schema::hasTable('recipes') && !Schema::hasColumn('recipes', 'kind')) {
            Schema::table('recipes', function (Blueprint $table) {
                $table->string('kind', 20)->default('ingredient')->after('quantity')
                    ->comment('ingredient: nguyên liệu | packaging: bao bì');
            });
        }
    }

    public function down(): void
    {
        // Không drop cột để an toàn dữ liệu
    }
};
