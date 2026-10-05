<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Gói 9 (2026-10-05): giao diện Mini App kiểu GrabFood.
// - products.is_favorite: món yêu thích (tim đỏ trong admin, lưới "Dành cho bạn")
// - group_orders + group_order_items: đặt đơn nhóm
// - orders.referred_by / customers.referred_by: link giới thiệu affiliate
// - settings seed: shop_cover_url, ref_bonus_points
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('products', 'is_favorite')) {
            Schema::table('products', function (Blueprint $table) {
                $table->boolean('is_favorite')->default(false)->after('is_active');
            });
        }

        if (!Schema::hasTable('group_orders')) {
            Schema::create('group_orders', function (Blueprint $table) {
                $table->id();
                $table->string('code', 12)->unique(); // mã nhóm để share link
                $table->foreignId('branch_id')->constrained('branches');
                $table->string('leader_name', 100);
                $table->string('status', 20)->default('open'); // open|ordered|cancelled
                $table->timestamp('expires_at')->nullable();
                $table->timestamps();
                $table->index('code');
            });
        }

        if (!Schema::hasTable('group_order_items')) {
            Schema::create('group_order_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('group_order_id')->constrained('group_orders')->cascadeOnDelete();
                $table->json('member_names'); // ["An","Bình"] — ai đặt món này
                $table->foreignId('product_id')->constrained('products');
                $table->string('product_name', 255); // snapshot
                $table->json('option_ids')->nullable();
                $table->json('option_names')->nullable(); // snapshot tên tùy chọn
                $table->decimal('unit_price', 15, 2);
                $table->integer('quantity')->default(1);
                $table->string('note', 255)->nullable(); // ghi chú riêng của thành viên
                $table->timestamps();
            });
        }

        if (!Schema::hasColumn('orders', 'referred_by')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->string('referred_by', 20)->nullable()->after('customer_id');
            });
        }
        if (!Schema::hasColumn('customers', 'referred_by')) {
            Schema::table('customers', function (Blueprint $table) {
                $table->string('referred_by', 20)->nullable()->after('member_code');
            });
        }

        foreach (['shop_cover_url' => '', 'ref_bonus_points' => '100'] as $k => $v) {
            if (!DB::table('settings')->where('key', $k)->exists()) {
                DB::table('settings')->insert(['key' => $k, 'value' => $v]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('group_order_items');
        Schema::dropIfExists('group_orders');
        foreach (['is_favorite', ] as $col) {
            if (Schema::hasColumn('products', $col)) {
                Schema::table('products', fn(Blueprint $t) => $t->dropColumn($col));
            }
        }
        if (Schema::hasColumn('orders', 'referred_by')) {
            Schema::table('orders', fn(Blueprint $t) => $t->dropColumn('referred_by'));
        }
        if (Schema::hasColumn('customers', 'referred_by')) {
            Schema::table('customers', fn(Blueprint $t) => $t->dropColumn('referred_by'));
        }
    }
};
