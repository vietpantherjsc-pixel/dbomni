<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 7a (2026-10-05): Schema cho import dữ liệu chuẩn (PH2/PH3/PH6).
// - menus + menu_product: 1 món thuộc nhiều thực đơn (cột T file Excel, phân cách ;)
// - price_lists + product_prices: giá theo kênh (nhà hàng/Grab/Shopee/Green/online)
// - option_groups + product_option_group: nhóm tùy chọn (Size/Độ ngọt/Đá/Topping...)
// - products: thêm sku, unit, cost_price, tax_code, print_label
// - product_options: thêm option_group_id
// Viết idempotent (MySQL không rollback DDL khi FAIL giữa chừng).
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('menus')) {
            Schema::create('menus', function (Blueprint $table) {
                $table->id();
                $table->string('name', 150)->unique();
                $table->string('description', 255)->nullable();
                $table->boolean('is_active')->default(true);
                $table->integer('sort_order')->default(0);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('menu_product')) {
            Schema::create('menu_product', function (Blueprint $table) {
                $table->id();
                $table->foreignId('menu_id')->constrained()->cascadeOnDelete();
                $table->foreignId('product_id')->constrained()->cascadeOnDelete();
                $table->unique(['menu_id', 'product_id']);
            });
        }

        if (!Schema::hasTable('price_lists')) {
            Schema::create('price_lists', function (Blueprint $table) {
                $table->id();
                $table->string('code', 50)->unique()->comment('nha_hang|grabfood|shopeefood|greenfood|online');
                $table->string('name', 100);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('product_prices')) {
            Schema::create('product_prices', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_id')->constrained()->cascadeOnDelete();
                $table->foreignId('price_list_id')->constrained()->cascadeOnDelete();
                $table->decimal('price', 15, 0)->default(0);
                $table->unique(['product_id', 'price_list_id']);
            });
        }

        if (!Schema::hasTable('option_groups')) {
            Schema::create('option_groups', function (Blueprint $table) {
                $table->id();
                $table->string('name', 100)->comment('VD: Size, Độ Ngọt, ĐÁ, Topping');
                $table->string('code', 50)->nullable()->unique();
                $table->enum('type', ['single', 'multiple'])->default('single')->comment('single: chọn 1, multiple: chọn nhiều');
                $table->boolean('is_required')->default(false);
                $table->integer('min_select')->default(0);
                $table->integer('max_select')->nullable();
                $table->integer('sort_order')->default(0);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('product_option_group')) {
            Schema::create('product_option_group', function (Blueprint $table) {
                $table->id();
                $table->foreignId('product_id')->constrained()->cascadeOnDelete();
                $table->foreignId('option_group_id')->constrained()->cascadeOnDelete();
                $table->unique(['product_id', 'option_group_id']);
            });
        }

        // products: các cột từ file Excel
        $productCols = [
            'sku' => fn(Blueprint $t) => $t->string('sku', 100)->nullable()->after('slug'),
            'unit' => fn(Blueprint $t) => $t->string('unit', 20)->default('Ly')->after('sku'),
            'cost_price' => fn(Blueprint $t) => $t->decimal('cost_price', 15, 0)->default(0)->after('base_price'),
            'tax_code' => fn(Blueprint $t) => $t->string('tax_code', 50)->nullable()->after('cost_price'),
            'print_label' => fn(Blueprint $t) => $t->boolean('print_label')->default(true)->after('is_active'),
        ];
        foreach ($productCols as $col => $def) {
            if (!Schema::hasColumn('products', $col)) {
                Schema::table('products', $def);
            }
        }

        // product_options: gắn nhóm
        if (!Schema::hasColumn('product_options', 'option_group_id')) {
            Schema::table('product_options', function (Blueprint $table) {
                $table->foreignId('option_group_id')->nullable()->after('product_id')
                    ->constrained('option_groups')->nullOnDelete();
            });
        }
        // Option thuộc nhóm dùng chung -> product_id nullable
        $nullable = DB::selectOne(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_options' AND COLUMN_NAME = 'product_id'"
        )?->IS_NULLABLE === 'YES';
        if (!$nullable) {
            // Lấy tên FK thực tế rồi gỡ
            $fk = DB::selectOne(
                "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_options' AND COLUMN_NAME = 'product_id' AND REFERENCED_TABLE_NAME IS NOT NULL"
            )?->CONSTRAINT_NAME;
            if ($fk) {
                DB::statement("ALTER TABLE product_options DROP FOREIGN KEY `{$fk}`");
            }
            DB::statement('ALTER TABLE product_options MODIFY product_id BIGINT UNSIGNED NULL');
            DB::statement('ALTER TABLE product_options ADD CONSTRAINT product_options_product_id_foreign FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_option_group');
        Schema::dropIfExists('product_prices');
        Schema::dropIfExists('price_lists');
        Schema::dropIfExists('menu_product');
        Schema::dropIfExists('menus');
        Schema::dropIfExists('option_groups');
        if (Schema::hasColumn('product_options', 'option_group_id')) {
            Schema::table('product_options', function (Blueprint $table) {
                $table->dropConstrainedForeignId('option_group_id');
            });
        }
        foreach (['sku', 'unit', 'cost_price', 'tax_code', 'print_label'] as $col) {
            if (Schema::hasColumn('products', $col)) {
                Schema::table('products', fn(Blueprint $t) => $t->dropColumn($col));
            }
        }
    }
};
