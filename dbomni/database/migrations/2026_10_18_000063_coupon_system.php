<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// SPEC-02: Bộ coupon CP-01→CP-10.
// Bảng ví coupon cá nhân + referral + tích tem + nhật ký OA.
return new class extends Migration
{
    public function up(): void
    {
        // Ví ưu đãi cá nhân (quy tắc: coupon gắn customer_id, không mã chung)
        Schema::create('customer_coupons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
            $table->foreignId('promotion_id')->constrained('promotions')->cascadeOnDelete();
            $table->string('code', 50)->unique()->comment('Mã coupon duy nhất/khách');
            $table->string('status', 20)->default('active')->comment('active|used|expired');
            $table->timestamp('issued_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('used_at')->nullable();
            $table->foreignId('used_order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->string('issue_trigger', 50)->nullable()->comment('Trigger cấp: first_login, referral, stamp, inactive_14d, birthday, new_product, next_order, manual');
            $table->timestamps();

            $table->index(['customer_id', 'status']);
            $table->index('promotion_id');
        });

        // Referral: link/mã giới thiệu
        Schema::create('referrals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('referrer_id')->constrained('customers')->cascadeOnDelete();
            $table->foreignId('referred_id')->constrained('customers')->cascadeOnDelete();
            $table->string('code', 20);
            $table->string('status', 20)->default('pending')->comment('pending|completed|fraud');
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['referrer_id', 'referred_id']);
            $table->index('code');
        });

        // Tích tem CP-03
        Schema::create('stamps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->timestamp('stamped_at')->useCurrent();
            $table->timestamps();

            $table->index('customer_id');
        });

        // Nhật ký gửi tin OA
        Schema::create('oa_message_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->string('template_code', 50)->nullable();
            $table->string('message_type', 20)->default('one_to_one')->comment('broadcast|one_to_one');
            $table->text('content')->nullable();
            $table->string('status', 20)->default('sent')->comment('sent|failed|skipped');
            $table->text('error')->nullable();
            $table->timestamps();

            $table->index(['message_type', 'created_at']);
        });

        // Cột mới cho customers và promotions
        Schema::table('customers', function (Blueprint $table) {
            $table->string('referral_code', 20)->nullable()->unique()->after('member_code');
        });

        Schema::table('promotions', function (Blueprint $table) {
            $table->string('code', 20)->nullable()->unique()->after('name')
                ->comment('Mã coupon CP-01..CP-10');
            $table->json('auto_config')->nullable()->after('code')
                ->comment('Cấu hình trigger tự động + tham số (SPEC-02)');
            $table->string('coupon_type', 20)->nullable()->after('auto_config')
                ->comment('Loại coupon mở rộng: bogo|stamp|gift (ngoài percent/fixed)');
        });
    }

    public function down(): void
    {
        Schema::table('promotions', function (Blueprint $table) {
            $table->dropColumn(['code', 'auto_config', 'coupon_type']);
        });
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('referral_code');
        });
        Schema::dropIfExists('oa_message_logs');
        Schema::dropIfExists('stamps');
        Schema::dropIfExists('referrals');
        Schema::dropIfExists('customer_coupons');
    }
};
