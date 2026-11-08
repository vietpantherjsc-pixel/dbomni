<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Order;
use Exception;
use Illuminate\Support\Facades\DB;

// Điểm xác nhận thanh toán DUY NHẤT cho đơn online (kênh zalo).
// Thân nghiệp vụ tách nguyên vẹn từ OnlineOrderController::confirmPayment()
// (trừ kho + ghi paid/processing + tích điểm + trigger coupon tự động) để
// dùng chung 2 cửa vào:
// - NV bấm xác nhận ở Admin/Hub (OnlineOrderController::confirmPayment —
//   kiểm CN phân công vẫn nằm ở controller trước khi gọi vào đây);
// - Hệ thống tự xác nhận theo mốc CIA của hãng giao hàng: tài xế AhaMove
//   đã lấy hàng + ứng tiền thu hộ (spec phí giao một nguồn mục 5.4 —
//   DeliveryService::applyProviderStatus gọi vào đây, KHÔNG dựng luồng
//   xác nhận tiền thứ hai).
class OnlinePaymentConfirmer
{
    public function __construct(
        private InventoryService $inventoryService,
        private LoyaltyService $loyaltyService,
    ) {
    }

    public function confirm(Order $order): Order
    {
        $confirmed = DB::transaction(function () use ($order) {
            $order = Order::with('items')->lockForUpdate()->findOrFail($order->id);

            if ($order->online_channel !== 'zalo') {
                throw new Exception('Chỉ xác nhận được đơn online.');
            }
            if ($order->status === 'cancelled') {
                throw new Exception('Đơn đã bị hủy.');
            }
            if ($order->stock_deducted) {
                throw new Exception('Đơn đã được xác nhận trước đó.');
            }

            // Trừ kho (món "Phí dịch vụ" không có BOM nên tự bỏ qua)
            // Gói 8a: trừ định mức cơ bản + định mức từng tùy chọn đã chọn
            // Gói 55 p11ac: lưu giá vốn vào order_items
            // Gói 55 p11ad: log xuất kho kèm order_id
            $matCosts = $this->inventoryService->deductStock(
                $order->branch_id,
                $order->items->map(fn($item) => [
                    'product_id' => $item->product_id,
                    'product_option_id' => $item->product_option_id,
                    'option_ids' => $item->options ? array_keys((array) $item->options) : [],
                    'quantity' => $item->quantity,
                ])->toArray(),
                ['type' => 'order', 'id' => $order->id, 'note' => 'Xác nhận thanh toán online']
            );
            foreach ($order->items as $item) {
                // Gói 55 p11ac: giá vốn NL của món (đã gồm định mức tùy chọn) —
                // dùng ĐÚNG hàm của OnlineOrderController (đã mở public cho
                // điểm xác nhận chung này dùng lại, không chép công thức).
                $item->update(['unit_cost' => app(\App\Http\Controllers\Api\OnlineOrderController::class)->calcItemUnitCost($item, $matCosts)]);
            }

            $order->payment_status = 'paid';
            // Gói 11: xác nhận xong vào thẳng "Đang Pha Chế" (KDS đã thu tiền).
            // Vá delta KDS book ship (§BJ): điểm xác nhận chung này còn chạy ở
            // bước tay delivering (C1) và webhook CIA picked_up — khi đó đơn
            // có thể ĐÃ ở 'ready'; không kéo lùi đơn đã làm xong về processing.
            if ($order->status !== 'ready') {
                $order->status = 'processing';
            }
            $order->stock_deducted = true;
            $order->save();

            // Tích điểm
            if ($order->customer_id) {
                $customer = Customer::find($order->customer_id);
                if ($customer) {
                    $order->points_earned = $this->loyaltyService->earnForOrder($customer, $order, (float) $order->total_amount);
                    $order->save();
                }
            }

            // SPEC-02: trigger coupon tự động sau khi xác nhận thanh toán
            if ($order->customer_id) {
                try {
                    $couponService = app(AutoIssueCouponService::class);
                    $customer = $order->customer;
                    if ($customer) {
                        // CP-01: đơn đầu tiên (truyền đơn nguồn để ghi source_order_id)
                        $couponService->onFirstOrder($customer, $order);
                        // CP-02: referral (cả 2 bên)
                        $couponService->onReferralFirstOrder($order);
                        // CP-03: tích tem
                        $couponService->onOrderStamp($customer, $order);
                        // CP-10: coupon đơn tiếp theo (chỉ Mini App)
                        $couponService->onNextOrderCoupon($customer, $order);
                    }
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('[Coupon] Auto-issue failed', [
                        'order' => $order->code, 'msg' => $e->getMessage(),
                    ]);
                }
            }

            return $order->load(['items.product', 'customer']);
        });

        // Spec KDS book ship mục 1 (2026-11-06): KHÔNG còn tự tạo đơn hãng tại
        // điểm xác nhận thanh toán — điểm đặt ship đã dời về KDS (NV bấm Đặt
        // Giao Hàng khi đơn làm xong). Phần chuẩn bị delivery_cod_amount /
        // delivery_quoted_fee chuyển vào DeliveryService::prepareBookingData,
        // chạy ở thao tác đặt. Xác nhận thanh toán chỉ còn: trừ kho + paid/
        // processing + tích điểm + coupon như thân giao dịch ở trên.

        return $confirmed;
    }
}
