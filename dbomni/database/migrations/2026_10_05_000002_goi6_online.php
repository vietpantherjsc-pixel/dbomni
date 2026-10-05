<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 6 (2026-10-05): Zalo Mini App đặt món.
// - products: cờ is_service_fee (món "Phí dịch vụ" giá thủ công)
// - orders: user_id nullable (đơn online), hẹn giờ lấy, địa chỉ giao, khoảng cách, phí ship, kênh online
// - settings: cấu hình phí ship (20.000đ < 2km, +6.000đ/km)
// - Tạo sẵn món "Phí dịch vụ"
// (branches đã có sẵn address/latitude/longitude từ migration gốc)
return new class extends Migration
{
    public function up(): void
    {
        // Gói 6: branches đã có sẵn address/latitude/longitude từ migration gốc
        // (2026_09_19_132250) nên không thêm lại ở đây.
        // LƯU Ý: MySQL không rollback DDL khi migration FAIL giữa chừng,
        // nên mọi bước đều kiểm tra tồn tại trước khi chạy (chạy lại an toàn).

        if (!Schema::hasColumn('products', 'is_service_fee')) {
            Schema::table('products', function (Blueprint $table) {
                $table->boolean('is_service_fee')->default(false)->after('is_active')
                    ->comment('Món "Phí dịch vụ" — giá nhập thủ công, không set cố định');
            });
        }

        $orderCols = [
            'online_channel' => function (Blueprint $table) {
                $table->string('online_channel', 20)->default('pos')->after('order_type')
                    ->comment('pos: tại quán, zalo: Zalo Mini App');
            },
            'scheduled_at' => function (Blueprint $table) {
                $table->dateTime('scheduled_at')->nullable()->after('note')
                    ->comment('Hẹn giờ tới lấy (đơn mang đi đặt trước)');
            },
            'delivery_address' => function (Blueprint $table) {
                $table->string('delivery_address', 255)->nullable()->after('scheduled_at');
            },
            'distance_km' => function (Blueprint $table) {
                $table->decimal('distance_km', 8, 2)->nullable()->after('delivery_address');
            },
            'shipping_fee' => function (Blueprint $table) {
                $table->decimal('shipping_fee', 12, 2)->default(0)->after('distance_km');
            },
            'zalo_user_id' => function (Blueprint $table) {
                $table->string('zalo_user_id', 100)->nullable()->after('shipping_fee');
            },
        ];
        foreach ($orderCols as $col => $def) {
            if (!Schema::hasColumn('orders', $col)) {
                Schema::table('orders', $def);
            }
        }

        foreach (['ship_base_fee' => '20000', 'ship_base_km' => '2', 'ship_per_km' => '6000'] as $key => $value) {
            DB::table('settings')->updateOrInsert(
                ['key' => $key],
                ['value' => $value, 'created_at' => now(), 'updated_at' => now()]
            );
        }

        // Đơn online không có nhân viên tạo -> user_id nullable (MySQL: phải gỡ FK trước)
        $isNullable = DB::selectOne(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'user_id'"
        )?->IS_NULLABLE === 'YES';
        if (!$isNullable) {
            DB::statement('ALTER TABLE orders DROP FOREIGN KEY orders_user_id_foreign');
            DB::statement('ALTER TABLE orders MODIFY user_id BIGINT UNSIGNED NULL');
            DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
        }

        // Tạo sẵn món "Phí dịch vụ"
        $categoryId = DB::table('categories')->orderBy('id')->value('id');
        if ($categoryId && !DB::table('products')->where('is_service_fee', true)->exists()) {
            DB::table('products')->insert([
                'category_id' => $categoryId,
                'name' => 'Phí dịch vụ',
                'slug' => 'phi-dich-vu',
                'base_price' => 0,
                'is_service_fee' => true,
                'is_active' => true,
                'sell_on_pos' => false,
                'sell_on_zalo' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('products')->where('is_service_fee', true)->delete();
        DB::table('settings')->whereIn('key', ['ship_base_fee', 'ship_base_km', 'ship_per_km'])->delete();
        DB::statement('ALTER TABLE orders DROP FOREIGN KEY orders_user_id_foreign');
        DB::statement('ALTER TABLE orders MODIFY user_id BIGINT UNSIGNED NOT NULL');
        DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['online_channel', 'scheduled_at', 'delivery_address', 'distance_km', 'shipping_fee', 'zalo_user_id']);
        });
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('is_service_fee');
        });
        // Không drop address/latitude/longitude của branches vì có sẵn từ migration gốc.
    }
};
