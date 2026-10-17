<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Gói 60 (2026-10-17): Tích hợp giao hàng AhaMove (chính) / Lalamove (dự phòng).
// Spec: ~/workspace/your_files/spec-giao-hang-ahamove-lalamove/spec-giao-hang-ahamove-lalamove.md
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('delivery_provider', 20)->nullable()->after('shipping_promotion_id')
                ->comment('Hãng đang giao: ahamove | lalamove');
            $table->string('delivery_order_id', 100)->nullable()->after('delivery_provider')
                ->comment('Mã đơn phía hãng');
            $table->string('delivery_tracking_url', 500)->nullable()->after('delivery_order_id')
                ->comment('Link theo dõi cho khách/KDS/Admin');
            $table->string('delivery_status', 30)->nullable()->after('delivery_tracking_url')
                ->comment('searching_driver|driver_assigned|picked_up|delivering|delivered|failed|cancelled');
            $table->string('delivery_package', 20)->nullable()->after('delivery_status')
                ->comment('Gói khách chọn: nhanh | sieu_toc');
            $table->decimal('delivery_fee', 12, 2)->nullable()->after('delivery_package')
                ->comment('Phí ship thực tế hãng tính');
            $table->decimal('delivery_fee_charged', 12, 2)->nullable()->after('delivery_fee')
                ->comment('Phần phí ship khách chịu (sau hỗ trợ/freeship)');
            $table->decimal('delivery_quoted_fee', 12, 2)->nullable()->after('delivery_fee_charged')
                ->comment('Phí đã báo và khóa tại thời điểm chốt đơn');
            $table->decimal('delivery_cod_amount', 12, 2)->nullable()->after('delivery_quoted_fee')
                ->comment('Số tiền COD gửi hãng (0 với đơn trả trước)');
            $table->decimal('delivery_cod_fee', 12, 2)->nullable()->after('delivery_cod_amount')
                ->comment('Phí thu hộ COD hãng tính (quán chịu)');
            $table->string('delivery_failover_from', 20)->nullable()->after('delivery_cod_fee')
                ->comment('Hãng gốc khi failover (rỗng nếu không failover)');
            $table->timestamp('delivery_failover_at')->nullable()->after('delivery_failover_from');
            $table->string('delivery_driver_name', 100)->nullable()->after('delivery_failover_at');
            $table->string('delivery_driver_phone', 20)->nullable()->after('delivery_driver_name');
            $table->string('delivery_driver_plate', 20)->nullable()->after('delivery_driver_phone');
            $table->timestamp('delivery_searching_since')->nullable()->after('delivery_driver_plate')
                ->comment('Mốc bắt đầu tìm tài xế — tính ngưỡng failover');
            // Gói 61b: tọa độ điểm giao (từ checkout) để hãng báo giá/tạo đơn chính xác
            $table->decimal('delivery_dropoff_lat', 10, 8)->nullable()->after('delivery_searching_since');
            $table->decimal('delivery_dropoff_lng', 11, 8)->nullable()->after('delivery_dropoff_lat');
            // Gói 61b: cờ hàng trả về khi giao thất bại (lọc báo cáo, thay vì nối chuỗi vào note)
            $table->boolean('delivery_returned')->default(false)->after('delivery_dropoff_lng')
                ->comment('true = giao thất bại có hàng trả về, không tính doanh thu');

            $table->index(['delivery_provider', 'delivery_status'], 'orders_delivery_provider_status_idx');
            $table->index('delivery_order_id', 'orders_delivery_order_id_idx');
        });

        Schema::create('delivery_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->string('provider', 20)->comment('ahamove | lalamove | system');
            $table->string('provider_order_id', 100)->nullable();
            $table->string('event', 50)->comment('webhook.<status> | failover | quote | create | cancel | ...');
            $table->json('payload')->nullable();
            $table->timestamps();

            $table->index('provider_order_id', 'delivery_logs_provider_order_id_idx');
            $table->index(['provider', 'event'], 'delivery_logs_provider_event_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_logs');

        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_delivery_provider_status_idx');
            $table->dropIndex('orders_delivery_order_id_idx');
            $table->dropColumn([
                'delivery_provider', 'delivery_order_id', 'delivery_tracking_url',
                'delivery_status', 'delivery_package', 'delivery_fee',
                'delivery_fee_charged', 'delivery_quoted_fee', 'delivery_cod_amount',
                'delivery_cod_fee', 'delivery_failover_from', 'delivery_failover_at',
                'delivery_driver_name', 'delivery_driver_phone', 'delivery_driver_plate',
                'delivery_searching_since', 'delivery_dropoff_lat', 'delivery_dropoff_lng',
                'delivery_returned',
            ]);
        });
    }
};
