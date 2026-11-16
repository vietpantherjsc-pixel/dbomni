<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Spec dời mốc tích điểm (Đại Vương chốt 2026-11-13, mục 4): thêm dấu
// earn orders.points_earned_at — thời điểm hệ đã chạy earnForOrder cho
// đơn. Điểm chốt duy nhất LoyaltyService::earnWhenSettled chỉ cộng điểm
// (+ total_spent + coupon) khi đơn paid + completed + CHƯA có dấu; mọi
// đường thu hồi (revokeEarn) quyết định bằng dấu này thay cho cờ
// "đã paid" cũ. Migration số 000115 theo thứ tự đã chốt (lai 000114 ·
// tích điểm 000115 · RT-03 000116).
// BACKFILL TRONG CÙNG MIGRATION (mục 4, bắt buộc): dưới luật cũ mọi đơn
// paid-có-khách đều đã chạy earn (tại xác nhận thanh toán / tạo đơn /
// claim / import) → đóng dấu points_earned_at = COALESCE(paid_at,
// updated_at) để các đơn đó KHÔNG earn lần 2 khi hoàn thành sau khi nạp
// gói. Đơn paid CHƯA có khách giữ NULL (đường claim N4 còn phải earn
// khi khách quét mã sau đó). Đơn chưa paid giữ NULL.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->timestamp('points_earned_at')->nullable()->after('points_earned')
                ->comment('Dấu earn đã chạy tại điểm chốt (spec dời mốc tích điểm 2026-11-13)');
        });

        DB::table('orders')
            ->where('payment_status', 'paid')
            ->whereNotNull('customer_id')
            ->update(['points_earned_at' => DB::raw('COALESCE(paid_at, updated_at)')]);
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('points_earned_at');
        });
    }
};
