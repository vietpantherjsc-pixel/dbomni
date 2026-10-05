<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

// Gói 8a (2026-10-05):
// - product_options.sort_order: kéo-thả sắp xếp tùy chọn trong nhóm
// - price_lists.sort_order: sắp xếp kênh bán hàng
// - product_prices.is_active: bật/tắt bán món trên từng kênh
// - products: description, color, tax_rate (null = dùng thuế suất mặc định)
// - Seed kênh bán mặc định nếu bảng price_lists trống
return new class extends Migration {
    public function up(): void
    {
        // Gói 8a: option nhóm (size/topping) không gắn món cụ thể -> product_id nullable
        if (Schema::hasTable('recipes') && Schema::hasColumn('recipes', 'product_id')) {
            // MySQL: đổi nullable cần DBAL; dùng câu lệnh trực tiếp cho an toàn
            try {
                DB::statement('ALTER TABLE `recipes` MODIFY `product_id` BIGINT UNSIGNED NULL');
            } catch (\Exception $e) {
                // SQLite/test: bỏ qua
            }
        }

        if (Schema::hasTable('product_options') && !Schema::hasColumn('product_options', 'sort_order')) {
            Schema::table('product_options', function (Blueprint $table) {
                $table->integer('sort_order')->default(0)->after('is_required');
            });
        }

        if (Schema::hasTable('price_lists') && !Schema::hasColumn('price_lists', 'sort_order')) {
            Schema::table('price_lists', function (Blueprint $table) {
                $table->integer('sort_order')->default(0)->after('is_active');
            });
        }

        if (Schema::hasTable('product_prices') && !Schema::hasColumn('product_prices', 'is_active')) {
            Schema::table('product_prices', function (Blueprint $table) {
                $table->boolean('is_active')->default(true)->after('price');
            });
        }

        if (Schema::hasTable('products')) {
            Schema::table('products', function (Blueprint $table) {
                if (!Schema::hasColumn('products', 'description')) {
                    $table->text('description')->nullable()->after('name');
                }
                if (!Schema::hasColumn('products', 'color')) {
                    $table->string('color', 7)->nullable()->after('description');
                }
                if (!Schema::hasColumn('products', 'tax_rate')) {
                    $table->decimal('tax_rate', 5, 2)->nullable()->after('color')
                        ->comment('Thuế suất riêng của món (%), null = dùng mặc định hệ thống');
                }
            });
        }

        // Seed kênh bán mặc định (giữ code cũ để tương thích dữ liệu import)
        if (Schema::hasTable('price_lists') && DB::table('price_lists')->count() === 0) {
            $now = now();
            $channels = [
                ['code' => 'nha_hang', 'name' => 'Tại cửa hàng (POS)', 'sort_order' => 0],
                ['code' => 'online', 'name' => 'Zalo Mini App', 'sort_order' => 1],
                ['code' => 'grabfood', 'name' => 'GrabFood', 'sort_order' => 2],
                ['code' => 'shopeefood', 'name' => 'ShopeeFood', 'sort_order' => 3],
                ['code' => 'greenfood', 'name' => 'Green Food', 'sort_order' => 4],
                ['code' => 'event', 'name' => 'Sự kiện', 'sort_order' => 5],
            ];
            foreach ($channels as $c) {
                DB::table('price_lists')->insert([
                    'code' => $c['code'],
                    'name' => $c['name'],
                    'is_active' => true,
                    'sort_order' => $c['sort_order'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        // Cài đặt thuế mặc định nếu chưa có
        if (Schema::hasTable('settings')) {
            if (!DB::table('settings')->where('key', 'default_tax_rate')->exists()) {
                DB::table('settings')->insert([
                    'key' => 'default_tax_rate', 'value' => '8',
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            if (!DB::table('settings')->where('key', 'price_includes_tax')->exists()) {
                DB::table('settings')->insert([
                    'key' => 'price_includes_tax', 'value' => '1',
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        // Không drop cột để an toàn dữ liệu
    }
};
