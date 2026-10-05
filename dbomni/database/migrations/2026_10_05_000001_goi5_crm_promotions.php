<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 5 (2026-10-05): CRM / Voucher / Khuyến mại (theo spec Sapo Đại Vương gửi).
// - membership_tiers: hạng thành viên (Thường/Bạc/Vàng/Kim cương) + tỉ lệ tích điểm từng hạng
// - customers: SĐT làm định danh, mã QR thành viên, điểm, tổng tiền tích lũy
// - point_transactions: lịch sử cộng/trừ/điều chỉnh điểm
// - promotions: khuyến mại kiểu Sapo (theo %/số tiền/đồng giá/tặng món,
//   phạm vi hóa đơn/danh mục/mặt hàng, giờ vàng theo thứ + khung giờ, đối tượng áp dụng)
// - settings: cấu hình quy đổi điểm (VD: 10 điểm = 1.000đ)
// - orders: gắn khách hàng + điểm tích/đổi + khuyến mại đã áp dụng
return new class extends Migration
{
    public function up(): void
    {
        // 1. Hạng thành viên
        Schema::create('membership_tiers', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100)->comment('Tên hạng (Thường, Bạc, Vàng, Kim cương...)');
            $table->decimal('min_total_spent', 12, 2)->default(0)->comment('Tổng tiền tích lũy tối thiểu để đạt hạng');
            $table->decimal('earn_per_amount', 12, 2)->default(10000)->comment('Cứ X đồng được Y điểm');
            $table->integer('earn_points')->default(1);
            $table->boolean('is_default')->default(false)->comment('Hạng mặc định cho khách mới');
            $table->integer('sort_order')->default(0);
            $table->timestamps();
        });

        // 2. Khách hàng
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('member_code', 20)->unique()->comment('Mã thành viên (dùng cho QR quét tích điểm)');
            $table->string('name', 150);
            $table->string('phone', 20)->unique()->comment('SĐT = mã định danh');
            $table->date('birthday')->nullable();
            $table->decimal('total_spent', 12, 2)->default(0)->comment('Tổng tiền đã mua (để xét hạng)');
            $table->integer('points')->default(0)->comment('Điểm hiện tại');
            $table->foreignId('membership_tier_id')->nullable()->constrained('membership_tiers')->nullOnDelete();
            $table->string('note', 255)->nullable();
            $table->timestamps();
            $table->index('phone');
        });

        // 3. Lịch sử điểm
        Schema::create('point_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->onDelete('cascade');
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->integer('change')->comment('Điểm thay đổi (+ cộng / - trừ)');
            $table->string('type', 20)->comment('earn: tích, redeem: đổi, adjust: điều chỉnh tay');
            $table->string('note', 255)->nullable();
            $table->timestamps();
        });

        // 4. Khuyến mại
        Schema::create('promotions', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->enum('type', ['percent', 'fixed', 'fixed_price', 'gift'])
                ->comment('percent: theo %, fixed: theo số tiền, fixed_price: đồng giá, gift: tặng món');
            $table->decimal('value', 12, 2)->nullable()->comment('% hoặc số tiền giảm hoặc giá đồng giá');
            $table->enum('scope', ['order', 'category', 'product'])->default('order')
                ->comment('Phạm vi: hóa đơn / danh mục / mặt hàng');
            $table->json('scope_ids')->nullable()->comment('IDs danh mục hoặc mặt hàng (khi scope != order)');
            $table->decimal('min_order_amount', 12, 2)->default(0)->comment('Giá trị đơn tối thiểu');
            $table->decimal('max_discount_amount', 12, 2)->nullable()->comment('Giảm tối đa (loại %)');
            $table->foreignId('gift_product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->integer('gift_quantity')->default(1);
            $table->enum('target', ['all', 'tier'])->default('all')->comment('Đối tượng: tất cả / theo hạng TV');
            $table->json('tier_ids')->nullable();
            $table->dateTime('starts_at')->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->json('days_of_week')->nullable()->comment('[0=CN..6=T7] — null = mọi ngày');
            $table->time('time_from')->nullable()->comment('Khung giờ vàng (từ)');
            $table->time('time_to')->nullable()->comment('Khung giờ vàng (đến)');
            $table->json('channels')->nullable()->comment('["pos","online"] — null = mọi kênh');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // 5. Cấu hình chung (quy đổi điểm)
        Schema::create('settings', function (Blueprint $table) {
            $table->string('key', 100)->primary();
            $table->text('value')->nullable();
            $table->timestamps();
        });
        DB::table('settings')->insert([
            ['key' => 'points_redeem_points', 'value' => '10', 'created_at' => now(), 'updated_at' => now()],
            ['key' => 'points_redeem_amount', 'value' => '1000', 'created_at' => now(), 'updated_at' => now()],
        ]);

        // 6. Hạng mặc định
        DB::table('membership_tiers')->insert([
            ['name' => 'Khách hàng thân thiết', 'min_total_spent' => 0, 'earn_per_amount' => 10000, 'earn_points' => 1, 'is_default' => true, 'sort_order' => 1, 'created_at' => now(), 'updated_at' => now()],
            ['name' => 'Thành Viên Hạng Bạc', 'min_total_spent' => 500000, 'earn_per_amount' => 10000, 'earn_points' => 1, 'is_default' => false, 'sort_order' => 2, 'created_at' => now(), 'updated_at' => now()],
            ['name' => 'Thành Viên Hạng Vàng', 'min_total_spent' => 2000000, 'earn_per_amount' => 10000, 'earn_points' => 1, 'is_default' => false, 'sort_order' => 3, 'created_at' => now(), 'updated_at' => now()],
            ['name' => 'Thành Viên Hạng Kim Cương', 'min_total_spent' => 3000000, 'earn_per_amount' => 10000, 'earn_points' => 1, 'is_default' => false, 'sort_order' => 4, 'created_at' => now(), 'updated_at' => now()],
        ]);

        // 7. Orders gắn CRM
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('customer_id')->nullable()->after('user_id')->constrained('customers')->nullOnDelete();
            $table->integer('points_earned')->default(0)->after('customer_id');
            $table->integer('points_redeemed')->default(0)->after('points_earned');
            $table->foreignId('promotion_id')->nullable()->after('points_redeemed')->constrained('promotions')->nullOnDelete();
            $table->decimal('promotion_discount', 12, 2)->default(0)->after('promotion_id');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['customer_id']);
            $table->dropForeign(['promotion_id']);
            $table->dropColumn(['customer_id', 'points_earned', 'points_redeemed', 'promotion_id', 'promotion_discount']);
        });
        DB::table('membership_tiers')->delete();
        DB::table('settings')->whereIn('key', ['points_redeem_points', 'points_redeem_amount'])->delete();
        Schema::dropIfExists('settings');
        Schema::dropIfExists('promotions');
        Schema::dropIfExists('point_transactions');
        Schema::dropIfExists('customers');
        Schema::dropIfExists('membership_tiers');
    }
};
