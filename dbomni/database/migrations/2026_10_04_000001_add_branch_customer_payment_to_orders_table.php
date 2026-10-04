<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 1 (2026-10-04): Bổ sung các cột mà OrderController đang dùng nhưng migration cũ thiếu.
// DB hiện trống nên migration chạy thẳng, không cần chuyển đổi dữ liệu.
return new class extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('branch_id')->nullable()->after('user_id')
                ->constrained('branches')->nullOnDelete()
                ->comment('Chi nhánh bán');
            $table->string('code', 50)->unique()->after('order_number')
                ->comment('Mã hóa đơn hiển thị (VD: HD-20251004-AB12C)');
            $table->string('customer_name', 100)->nullable()->after('code');
            $table->string('customer_phone', 20)->nullable()->after('customer_name');
            $table->string('payment_status', 20)->default('unpaid')->after('payment_method')
                ->comment('unpaid|paid|refunded');
            $table->text('note')->nullable()->after('payment_status');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropColumn(['branch_id', 'code', 'customer_name', 'customer_phone', 'payment_status', 'note']);
        });
    }
};
