<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

// Loyalty 2.0 (2026-10-21): làm mới hạng thành viên & điểm theo spec
// spec-hang-thanh-vien-moi.md — lô điểm FIFO có HSD, hạng theo cửa sổ trượt,
// Cửa hàng điểm (đổi điểm → coupon). Migration này CHỈ tạo schema + seed cấu
// hình/hạng; việc tạo lô ân hạn cho số dư cũ do command `loyalty:migrate-lots`
// chạy tay 1 lần sau deploy (tách schema/data theo spec mục 5.3).
return new class extends Migration
{
    public function up(): void
    {
        // 1) membership_tiers: cột mới cho mô hình cửa sổ trượt + hệ số phân tầng
        Schema::table('membership_tiers', function (Blueprint $table) {
            $table->string('code', 50)->nullable()->unique()->comment('Mã nội bộ ổn định, không đổi khi sửa tên hiển thị');
            $table->decimal('min_spent_window', 12, 2)->default(0)->comment('Ngưỡng LÊN hạng: chi tiêu tối thiểu trong cửa sổ trượt');
            $table->decimal('keep_spent_window', 12, 2)->nullable()->comment('Ngưỡng GIỮ hạng trong 1 cửa sổ; null = 50% ngưỡng lên');
            $table->decimal('earn_multiplier', 4, 2)->default(1)->comment('Hệ số nhân điểm tích theo hạng');
            $table->unsignedInteger('points_discount_pct')->default(0)->comment('% giảm giá điểm khi đổi coupon cho hạng này');
            $table->json('benefits')->nullable()->comment('Cờ quyền lợi hiển thị: birthday_bonus, early_access_new_item, tier_golden_hour, double_points_day');
        });

        // Seed bộ hạng A (Đại Vương chốt 2026-10-21) cho các hạng hiện hữu theo thứ
        // tự sort_order tăng dần: chỉ 4 hạng đầu nhận bộ giá trị chốt; hạng ngoài
        // (nếu DB thật có hơn 4) giữ nguyên tên/ngưỡng, code tự sinh từ tên.
        $seed = [
            ['name' => 'Ban Mai', 'code' => 'ban_mai', 'min' => 0, 'mult' => 1.00, 'disc' => 0,
                'benefits' => ['birthday_bonus' => true, 'early_access_new_item' => false, 'tier_golden_hour' => false, 'double_points_day' => false]],
            ['name' => 'Nắng Mai', 'code' => 'nang_mai', 'min' => 300000, 'mult' => 1.50, 'disc' => 0,
                'benefits' => ['birthday_bonus' => true, 'early_access_new_item' => false, 'tier_golden_hour' => true, 'double_points_day' => false]],
            ['name' => 'Bình Minh', 'code' => 'binh_minh', 'min' => 1000000, 'mult' => 2.00, 'disc' => 10,
                'benefits' => ['birthday_bonus' => true, 'early_access_new_item' => true, 'tier_golden_hour' => true, 'double_points_day' => false]],
            ['name' => 'Rạng Đông', 'code' => 'rang_dong', 'min' => 3000000, 'mult' => 2.50, 'disc' => 15,
                'benefits' => ['birthday_bonus' => true, 'early_access_new_item' => true, 'tier_golden_hour' => true, 'double_points_day' => true]],
        ];
        $tiers = DB::table('membership_tiers')->orderBy('sort_order')->orderBy('id')->get();
        foreach ($tiers as $i => $tier) {
            if (isset($seed[$i])) {
                $s = $seed[$i];
                DB::table('membership_tiers')->where('id', $tier->id)->update([
                    'name' => $s['name'],
                    'code' => $s['code'],
                    'min_spent_window' => $s['min'],
                    'earn_multiplier' => $s['mult'],
                    'points_discount_pct' => $s['disc'],
                    'benefits' => json_encode($s['benefits']),
                    'updated_at' => now(),
                ]);
            } else {
                DB::table('membership_tiers')->where('id', $tier->id)->update([
                    'code' => Str::slug($tier->name, '_') . '_' . $tier->id,
                    'min_spent_window' => $tier->min_total_spent,
                    'updated_at' => now(),
                ]);
            }
        }

        // 2) customers: trạng thái nguy cơ tụt hạng + bảo vệ hạng gán tay
        Schema::table('customers', function (Blueprint $table) {
            $table->timestamp('tier_warning_at')->nullable()->comment('Thời điểm bắt đầu bị cảnh báo nguy cơ tụt hạng');
            $table->foreignId('tier_projected_id')->nullable()->constrained('membership_tiers')->nullOnDelete()
                ->comment('Hạng dự kiến tụt xuống nếu không mua đủ trong thời gian báo trước');
            $table->timestamp('tier_manual_until')->nullable()->comment('Hạng gán tay được bảo vệ khỏi cron tụt hạng tới thời điểm này');
        });

        // 3) point_lots: lô điểm FIFO có hạn dùng riêng
        Schema::create('point_lots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->onDelete('cascade');
            $table->string('source_type', 20)->comment('earn | adjust | referral | migration');
            $table->foreignId('source_order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->integer('points_initial');
            $table->integer('points_remaining');
            $table->timestamp('earned_at');
            $table->timestamp('expires_at');
            $table->timestamp('warned_30_at')->nullable()->comment('Đã gửi nhắc OA mốc 30 ngày trước hết hạn');
            $table->timestamp('warned_7_at')->nullable()->comment('Đã gửi nhắc OA mốc 7 ngày trước hết hạn');
            $table->timestamps();
            $table->index(['customer_id', 'expires_at']);
        });

        // 4) point_transactions: truy vết lô cho từng biến động (đổi/hoàn điểm theo lô).
        // Cột món đổi (point_exchange_item_id) thêm ở bước 6 sau khi bảng
        // point_exchange_items tồn tại.
        Schema::table('point_transactions', function (Blueprint $table) {
            $table->foreignId('point_lot_id')->nullable()->constrained('point_lots')->nullOnDelete();
        });

        // 5) point_exchange_items: món trong Cửa hàng điểm (Admin tự cài đặt theo mùa)
        Schema::create('point_exchange_items', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->string('icon', 50)->nullable();
            $table->foreignId('promotion_id')->nullable()->constrained('promotions')->nullOnDelete()
                ->comment('Mẫu coupon phát khi đổi (dùng lại định nghĩa KM); mẫu bị xóa → null, món tự ẩn khỏi Cửa hàng điểm');
            $table->integer('points_cost')->comment('Giá điểm chuẩn (trước giảm giá theo hạng)');
            $table->foreignId('min_tier_id')->nullable()->constrained('membership_tiers')->nullOnDelete();
            $table->integer('daily_limit')->nullable()->comment('Trần tổng lượt đổi/ngày toàn hệ thống');
            $table->integer('per_customer_limit')->nullable()->comment('Trần lượt đổi/khách (toàn thời gian, tính cả lượt đã thu hồi)');
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // 6) point_transactions: gắn món đổi cho transaction lượt đổi (đếm trần
        // lượt theo món — không đếm bằng nội dung note vì tên món có thể thay đổi)
        // + gắn coupon đã phát cho lượt đổi đó (hoàn điểm về đúng lô khi Admin
        // thu hồi coupon — spec 6.1, không suy đoán theo thời gian).
        Schema::table('point_transactions', function (Blueprint $table) {
            $table->foreignId('point_exchange_item_id')->nullable()->after('point_lot_id')->constrained('point_exchange_items')->nullOnDelete();
            $table->foreignId('coupon_id')->nullable()->after('point_exchange_item_id')->constrained('customer_coupons')->nullOnDelete();
        });

        // 7) customer_tier_logs: lịch sử đổi hạng
        Schema::create('customer_tier_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->onDelete('cascade');
            $table->foreignId('from_tier_id')->nullable()->constrained('membership_tiers')->nullOnDelete();
            $table->foreignId('to_tier_id')->nullable()->constrained('membership_tiers')->nullOnDelete();
            $table->string('reason', 30)->comment('earn_threshold | window_drop | manual | migration');
            $table->decimal('window_spent', 12, 2)->nullable()->comment('Chi tiêu cửa sổ tại thời điểm đổi hạng');
            $table->timestamps();
            $table->index(['customer_id', 'created_at']);
        });

        // 8) Mốc bật Loyalty 2.0 — căn ân hạn chu kỳ đầu (không tụt hạng ai trong
        // cửa sổ đầu tiên kể từ mốc này). Các key cấu hình còn lại đọc kèm giá trị
        // mặc định trong code (Setting::get) và được Admin ghi đè khi sửa.
        DB::table('settings')->updateOrInsert(
            ['key' => 'loyalty_v2_started_at'],
            ['value' => now()->toDateTimeString(), 'created_at' => now(), 'updated_at' => now()]
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_tier_logs');
        Schema::table('point_transactions', function (Blueprint $table) {
            $table->dropForeign(['point_exchange_item_id']);
            $table->dropForeign(['coupon_id']);
            $table->dropColumn(['point_exchange_item_id', 'coupon_id']);
        });
        Schema::dropIfExists('point_exchange_items');
        Schema::table('point_transactions', function (Blueprint $table) {
            $table->dropForeign(['point_lot_id']);
            $table->dropColumn('point_lot_id');
        });
        Schema::dropIfExists('point_lots');
        Schema::table('customers', function (Blueprint $table) {
            $table->dropForeign(['tier_projected_id']);
            $table->dropColumn(['tier_warning_at', 'tier_projected_id', 'tier_manual_until']);
        });
        Schema::table('membership_tiers', function (Blueprint $table) {
            $table->dropColumn(['code', 'min_spent_window', 'keep_spent_window', 'earn_multiplier', 'points_discount_pct', 'benefits']);
        });
    }
};
