<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Gói 10c (2026-10-05):
// 1. products.price_on_demand — món "giá nhập khi chọn món" (VD: Phí dịch vụ):
//    POS bắt buộc nhập giá, ẩn khỏi Zalo Mini App.
// 2. promotions.type thêm 'shipping' — KM giảm/miễn phí vận chuyển theo tổng tiền.
// 3. orders.shipping_discount + shipping_promotion_id — lưu vết KM phí ship.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('products') && !Schema::hasColumn('products', 'price_on_demand')) {
            Schema::table('products', function (Blueprint $table) {
                $table->boolean('price_on_demand')->default(false)
                    ->after('is_service_fee')
                    ->comment('true: giá nhập khi chọn món trên POS, ẩn trên Mini App');
            });
        }

        if (Schema::hasTable('orders')) {
            if (!Schema::hasColumn('orders', 'shipping_discount')) {
                Schema::table('orders', function (Blueprint $table) {
                    $table->decimal('shipping_discount', 12, 2)->default(0)->after('shipping_fee');
                });
            }
            if (!Schema::hasColumn('orders', 'shipping_promotion_id')) {
                Schema::table('orders', function (Blueprint $table) {
                    $table->foreignId('shipping_promotion_id')->nullable()
                        ->after('shipping_discount')
                        ->constrained('promotions')->nullOnDelete();
                });
            }
        }

        // Thêm 'shipping' vào enum promotions.type (MySQL không sửa enum qua Schema builder)
        if (Schema::hasTable('promotions')) {
            DB::statement(
                "ALTER TABLE `promotions` MODIFY COLUMN `type` " .
                "ENUM('percent','fixed','fixed_price','gift','shipping') NOT NULL " .
                "COMMENT 'percent: theo %, fixed: theo số tiền, fixed_price: đồng giá, gift: tặng món, shipping: giảm/miễn phí ship'"
            );
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('orders') && Schema::hasColumn('orders', 'shipping_promotion_id')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropForeign(['shipping_promotion_id']);
                $table->dropColumn('shipping_promotion_id');
            });
        }
        if (Schema::hasTable('orders') && Schema::hasColumn('orders', 'shipping_discount')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropColumn('shipping_discount');
            });
        }
        if (Schema::hasTable('products') && Schema::hasColumn('products', 'price_on_demand')) {
            Schema::table('products', function (Blueprint $table) {
                $table->dropColumn('price_on_demand');
            });
        }
        // Không revert enum (an toàn dữ liệu nếu đã có KM shipping).
    }
};
