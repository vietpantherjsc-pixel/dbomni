<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 56 (2026-10-14): snapshot phí sàn + mốc bếp sẵn sàng trên đơn hàng.
// - commission_rate / commission_amount: lưu snapshot lúc tạo/chốt đơn để phí sàn
//   thay đổi sau này không làm báo cáo cũ nhảy số (phục vụ "lãi gộp theo kênh").
// - ready_at: lúc bếp bấm "Sẵn sàng" trên KDS — tính thời gian pha chế trung bình.
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                if (!Schema::hasColumn('orders', 'commission_rate')) {
                    $table->decimal('commission_rate', 5, 2)->default(0)
                        ->after('online_channel')
                        ->comment('% phí sàn snapshot lúc tạo/chốt đơn');
                }
                if (!Schema::hasColumn('orders', 'commission_amount')) {
                    $table->decimal('commission_amount', 15, 0)->default(0)
                        ->after('commission_rate')
                        ->comment('Tiền phí sàn snapshot lúc tạo/chốt đơn');
                }
                if (!Schema::hasColumn('orders', 'ready_at')) {
                    $table->dateTime('ready_at')->nullable()
                        ->after('completed_at')
                        ->comment('Lúc bếp bấm sẵn sàng — tính thời gian pha chế');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                foreach (['ready_at', 'commission_amount', 'commission_rate'] as $col) {
                    if (Schema::hasColumn('orders', $col)) {
                        $table->dropColumn($col);
                    }
                }
            });
        }
    }
};
