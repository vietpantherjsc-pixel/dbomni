<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Vá lỗ hổng thu hồi coupon (Đại Vương chốt 2026-10-28): coupon phát từ
// trigger CP-01/CP-02/CP-03 trước đây không lưu đơn đã sinh ra nó, nên khi
// quán hủy đơn đó, coupon vẫn active dùng được. Thêm cột source_order_id
// (đơn nguồn phát coupon) để performCancel thu hồi đúng các coupon còn
// active của đơn bị hủy. Coupon cũ (trước migration) giữ NULL — không truy
// vết được, giữ nguyên trạng thái như hiện tại.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_coupons', function (Blueprint $table) {
            $table->foreignId('source_order_id')->nullable()->after('used_order_id')->constrained('orders')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('customer_coupons', function (Blueprint $table) {
            $table->dropConstrainedForeignId('source_order_id');
        });
    }
};
