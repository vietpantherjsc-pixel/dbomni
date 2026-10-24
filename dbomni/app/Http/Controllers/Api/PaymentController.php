<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ZaloPaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// SPEC-01: API thanh toán Zalo Mini App.
class PaymentController extends Controller
{
    /**
     * GET /api/payment/zalo-config — cấu hình kênh thanh toán cho Mini App.
     * Public (không cần auth).
     */
    public function zaloConfig(ZaloPaymentService $service): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $service->config()]);
    }

    /**
     * POST /api/online/checkout-orders — tạo đơn + trả về params mở Checkout SDK.
     * Tái dùng logic tạo đơn của OnlineOrderController@store.
     */
    public function checkoutOrders(
        Request $request,
        ZaloPaymentService $service
    ): JsonResponse {
        $v = $request->validate([
            'pay_channel' => 'required|in:BANK,COD,ZALOPAY',
        ]);

        $cfg = $service->config();

        // Kiểm tra kênh có được bật không
        $channel = $v['pay_channel'];
        if ($channel === ZaloPaymentService::CHANNEL_BANK && !$cfg['bank_enabled']) {
            return response()->json(['success' => false, 'message' => 'Kênh chuyển khoản đang tắt.'], 422);
        }
        if ($channel === ZaloPaymentService::CHANNEL_COD && !$cfg['cod_enabled']) {
            return response()->json(['success' => false, 'message' => 'Kênh trả tại quán đang tắt.'], 422);
        }
        if ($channel === ZaloPaymentService::CHANNEL_ZALOPAY && !$cfg['zalopay_enabled']) {
            return response()->json(['success' => false, 'message' => 'Kênh ZaloPay chưa được bật.'], 422);
        }

        // Quy tắc COD: chỉ mang về/hẹn giờ (nếu bật)
        if ($channel === ZaloPaymentService::CHANNEL_COD && $cfg['cod_takeaway_only']) {
            $orderType = $request->input('order_type');
            if ($orderType === 'delivery') {
                return response()->json([
                    'success' => false,
                    'message' => 'Trả tại quán chỉ áp dụng cho đơn mang về/hẹn giờ.',
                ], 422);
            }
        }

        // Spec QR 2026-10-21 — FAIL-FAST chống đơn mồ côi: kiểm cấu hình TRƯỚC khi tạo đơn.
        // BANK cần: đủ 4 trường tài khoản NH + private key ký mac. Thiếu → báo rõ, KHÔNG tạo đơn.
        if ($channel === ZaloPaymentService::CHANNEL_BANK || $channel === ZaloPaymentService::CHANNEL_ZALOPAY) {
            if (!$service->paymentKeyReady()) {
                \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Thiếu ZALO_PAYMENT_PRIVATE_KEY — chặn tạo đơn ' . $channel);
                return response()->json([
                    'success' => false,
                    'message' => 'Kênh thanh toán đang được bảo trì. Vui lòng chọn hình thức khác hoặc thử lại sau.',
                ], 422);
            }
            if ($channel === ZaloPaymentService::CHANNEL_BANK && !$service->bankInfoComplete()) {
                \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Thiếu thông tin tài khoản ngân hàng — chặn tạo đơn BANK');
                return response()->json([
                    'success' => false,
                    'message' => 'Quán chưa cấu hình tài khoản nhận chuyển khoản. Vui lòng chọn hình thức khác.',
                ], 422);
            }
        }

        // Tạo đơn qua OnlineOrderController@store (tái dùng toàn bộ logic)
        /** @var OnlineOrderController $online */
        $online = app(OnlineOrderController::class);
        $response = $online->store(
            $request,
            app(\App\Services\PromotionService::class),
            app(\App\Services\LoyaltyService::class)
        );

        if ($response->getStatusCode() !== 201) {
            $respData = $response->getData(true);
            $isDuplicate = $response->getStatusCode() === 200
                && ($respData['duplicate'] ?? false)
                && !empty($respData['data']['code']);
            if (!$isDuplicate) {
                return $response;
            }
            // Audit toàn diện 2026-10-21 🔴2: đơn TRÙNG (khách bấm lại sau timeout) —
            // KHÔNG trả nguyên body của store() (frontend đọc không được → lỗi kỹ thuật lặp).
            // Xử lý như đơn vừa tạo: nạp lại đơn cũ + tạo sdk params + trả ĐÚNG shape
            // checkout-orders kèm mã đơn để khách vào /pay-wait hoặc tra cứu.
            $order = \App\Models\Order::where('code', $respData['data']['code'])->firstOrFail();
            try {
                $sdkParams = $service->createCheckoutParams($order, $channel);
            } catch (\Exception $e) {
                // Đơn cũ vẫn còn đó — trả về kèm mã đơn + thông tin CK từ order để khách
                // vẫn tới được màn Chờ thanh toán/tra cứu, không hủy đơn đã tồn tại.
                \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Duplicate: tạo lại params thất bại cho đơn ' . $order->code . ': ' . $e->getMessage());
                $transfer = $service->transferInfoForOrder($order);
                return response()->json([
                    'success' => true,
                    'message' => 'Đơn đã được tạo trước đó.',
                    'data' => [
                        'order' => $order->fresh()->load('customer'),
                        'sdk_params' => null,
                        'bank_info' => $transfer['bank_info'],
                        'transfer_content' => $transfer['transfer_content'],
                        'vietqr_payload' => $transfer['vietqr_payload'],
                        'duplicate' => true,
                    ],
                ], 200);
            }
            return response()->json([
                'success' => true,
                'message' => 'Đơn đã được tạo trước đó.',
                'data' => [
                    'order' => $order->fresh()->load('customer'),
                    'sdk_params' => $sdkParams['sdk_params'],
                    'bank_info' => $sdkParams['bank_info'],
                    'transfer_content' => $sdkParams['transfer_content'],
                    'vietqr_payload' => $sdkParams['vietqr_payload'] ?? null,
                    'duplicate' => true,
                ],
            ], 200);
        }

        $data = $response->getData(true);
        $orderCode = $data['data']['code'] ?? null;
        if (!$orderCode) {
            return response()->json(['success' => false, 'message' => 'Không tạo được đơn hàng.'], 500);
        }

        $order = \App\Models\Order::where('code', $orderCode)->firstOrFail();

        // Tạo params mở Checkout SDK (ký mac server-side)
        try {
            $sdkParams = $service->createCheckoutParams($order, $channel);
        } catch (\Exception $e) {
            // Spec QR 2026-10-21: đã fail-fast ở trên nên lỗi tới đây là bất thường —
            // HỦY đơn vừa tạo thay vì để đơn mồ côi pending không ai biết.
            $order->update(['status' => 'cancelled', 'payment_status' => 'failed']);
            \Illuminate\Support\Facades\Log::error('[ThanhToanQR] Tạo params thất bại sau khi tạo đơn — đã hủy đơn ' . $order->code . ': ' . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Không khởi tạo được thanh toán. Đơn đã được hủy, bạn không bị trừ tiền.'], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Đã tạo đơn, mở Checkout SDK để thanh toán.',
            'data' => [
                // Audit UX 2026-10-21 (hạng 2): nạp kèm customer để Mini App lưu
                // customer_id + member_code vào profile sau đơn đầu (giống đường store()).
                'order' => $order->fresh()->load('customer'),
                'sdk_params' => $sdkParams['sdk_params'],
                'bank_info' => $sdkParams['bank_info'],
                'transfer_content' => $sdkParams['transfer_content'],
                // Spec QR 2026-10-21: chuỗi EMV VietQR cho màn "Chờ thanh toán"
                'vietqr_payload' => $sdkParams['vietqr_payload'] ?? null,
            ],
        ], 201);
    }

    /**
     * POST /api/payment/notify — nhận notify từ Zalo Checkout SDK.
     * Public (Zalo gọi). Verify mac trước khi đổi trạng thái (fail-closed).
     */
    public function notify(Request $request, ZaloPaymentService $service): JsonResponse
    {
        $result = $service->handleNotify($request->all());
        $status = $result['success'] ? 200 : 400;
        return response()->json($result, $status);
    }
}
