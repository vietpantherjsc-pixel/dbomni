<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Services\ZaloPaymentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

// Gói Checkout SDK (spec spec-checkout-sdk-zalopay.md §2.6): đối soát tự
// động các đơn Checkout SDK đang pending_payment đã có mã đơn phía SDK mà
// quá 15 phút chưa có notify — gọi getOrderStatus phía Zalo để kéo trạng
// thái về đúng (chống thất lạc notify). Chạy mỗi 15 phút qua scheduler
// (routes/console.php). Đơn đã 'failed' phía SDK thì thôi không quét lại.
class ReconcileSdkPayments extends Command
{
    protected $signature = 'payments:reconcile-sdk';

    protected $description = 'Đối soát đơn Checkout SDK chờ thanh toán quá 15 phút bằng getOrderStatus';

    public function handle(ZaloPaymentService $service): int
    {
        $orders = Order::where('payment_status', 'pending_payment')
            ->whereNotNull('pay_sdk_order_id')
            ->where('created_at', '<=', now()->subMinutes(15))
            ->where(function ($q) {
                $q->whereNull('pay_sdk_status')
                    ->orWhereNotIn('pay_sdk_status', ['failed']);
            })
            ->orderBy('created_at')
            ->limit(50)
            ->get();

        $done = 0;
        foreach ($orders as $order) {
            try {
                $service->reconcileOrder($order);
                $done++;
            } catch (\Throwable $e) {
                Log::warning('[ZaloPay] payments:reconcile-sdk lỗi 1 đơn', [
                    'order' => $order->code, 'msg' => $e->getMessage(),
                ]);
            }
        }

        $this->info("Đã đối soát {$done}/{$orders->count()} đơn Checkout SDK chờ thanh toán.");
        Log::info('[ZaloPay] payments:reconcile-sdk hoàn tất', ['scanned' => $orders->count(), 'done' => $done]);
        return 0;
    }
}
