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
        // Gói Checkout SDK (Đ2, 2026-11-10): đợt này CHỈ BANK + COD —
        // ZALOPAY (ví) để giai đoạn 2, không nhận ở validate nữa.
        $v = $request->validate([
            'pay_channel' => 'required|in:BANK,COD',
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

        // Quy tắc COD cho đơn GIAO HÀNG — spec phí giao một nguồn mục 5.1:
        // công tắc riêng delivery_cod_enabled (mặc định TẮT) quyết định, KHÔNG
        // còn do cờ cod_takeaway_only (cờ đó thu hẹp về chốt chặn ở đường dự
        // phòng trong OnlineOrderController@store). Đơn giao qua kênh COD chỉ
        // chạy khi cả kênh COD lẫn công tắc này cùng bật (kênh đã kiểm ở trên).
        if ($channel === ZaloPaymentService::CHANNEL_COD && $request->input('order_type') === 'delivery') {
            if (empty($cfg['delivery_cod_enabled'])) {
                return response()->json([
                    'success' => false,
                    'message' => 'Đơn giao hàng hiện chỉ nhận chuyển khoản. Vui lòng chọn Chuyển khoản/VietQR.',
                ], 422);
            }
        }

        // Spec QR 2026-10-21 — FAIL-FAST chống đơn mồ côi: kiểm cấu hình TRƯỚC khi tạo đơn.
        // Gói Checkout SDK (2026-11-10): mac là BẮT BUỘC cho MỌI kênh từ
        // zmp-sdk 2.45.0 → fail-fast private key áp cho CẢ BANK lẫn COD
        // (trước đây COD không cần khóa ký). BANK vẫn cần thêm đủ 4 trường
        // tài khoản NH. Thiếu → báo rõ, KHÔNG tạo đơn.
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
                // Gói Checkout SDK — Đ3 + spec §3 (2026-11-10): KHÔNG còn
                // rơi về chuyển khoản tay ngoài SDK khi tạo lại params thất
                // bại. Đơn cũ GIỮ NGUYÊN ở pending_payment chờ "Thanh toán
                // tiếp"; trả success=false kèm mã đơn để client báo rõ
                // "đơn đã lưu, thanh toán tiếp sau" thay vì mở màn CK tay.
                \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Duplicate: tạo lại params thất bại cho đơn ' . $order->code . ': ' . $e->getMessage());
                return response()->json([
                    'success' => false,
                    'message' => 'Đơn đã được lưu nhưng chưa khởi tạo được thanh toán. Bạn có thể thanh toán tiếp trong mục Đơn hàng.',
                    'data' => ['order_code' => $order->code],
                ], 422);
            }
            return response()->json([
                'success' => true,
                'message' => 'Đơn đã được tạo trước đó.',
                'data' => [
                    'order' => $order->fresh()->load('customer'),
                    'sdk_params' => $sdkParams['sdk_params'],
                    'bank_info' => $sdkParams['bank_info'],
                    'transfer_content' => $sdkParams['transfer_content'],
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
            ],
        ], 201);
    }

    /**
     * Gói Checkout SDK: tìm đơn online thuộc về CHÍNH khách đang gọi —
     * mirror 2 khuôn truy cập đơn phía khách sẵn có trong
     * OnlineOrderController: (1) phiên token → khách → customer_id của đơn
     * (khuôn customer()); (2) SĐT khớp SĐT đặt đơn, chuẩn hóa +84/84 -> 0,
     * so hash_equals (khuôn track()/cancel()). Không khớp → null (caller
     * trả 404 chung, không lộ đơn có tồn tại hay không).
     */
    private function resolveCustomerOrder(Request $request, string $code): ?\App\Models\Order
    {
        $order = \App\Models\Order::where('code', $code)
            ->where('online_channel', 'zalo')
            ->first();
        if (!$order) {
            return null;
        }
        $customer = \App\Services\CustomerSessionService::resolveFromToken($request->bearerToken());
        if ($customer && (int) $order->customer_id === (int) $customer->id) {
            return $order;
        }
        $norm = function ($p) {
            $d = preg_replace('/[^0-9]/', '', (string) $p);
            if (str_starts_with($d, '84') && strlen($d) >= 11) {
                $d = '0' . substr($d, 2);
            }
            return $d;
        };
        $reqPhone = $norm($request->input('phone', ''));
        $orderPhone = $norm($order->customer_phone);
        if ($reqPhone !== '' && $orderPhone !== '' && hash_equals($orderPhone, $reqPhone)) {
            return $order;
        }
        return null;
    }

    /**
     * POST /api/online/orders/{code}/payment/sdk-link — Gói Checkout SDK:
     * client gắn mã đơn phía SDK (orderId từ CheckoutSDK.createOrder) về
     * server để notify đối chiếu đơn qua pay_sdk_order_id (notify không
     * mang mã đơn quán). Chỉ gắn khi đơn còn pending_payment.
     */
    public function linkSdkOrder(Request $request, string $code): JsonResponse
    {
        $v = $request->validate([
            'sdk_order_id' => 'required|string|max:100',
            'phone' => 'nullable|string|max:20',
        ]);
        $order = $this->resolveCustomerOrder($request, $code);
        if (!$order) {
            return response()->json(['success' => false, 'message' => 'Không tìm thấy đơn hàng.'], 404);
        }
        if ($order->payment_status === 'pending_payment') {
            $order->update(['pay_sdk_order_id' => $v['sdk_order_id']]);
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã gắn mã đơn SDK.',
            'data' => ['code' => $order->code, 'pay_sdk_order_id' => $order->pay_sdk_order_id],
        ]);
    }

    /**
     * POST /api/online/orders/{code}/payment/repay-params — Gói Checkout
     * SDK (spec §3): server cấp LẠI tham số SDK cho chính đơn đang chờ
     * thanh toán (nút "Thanh toán tiếp" — khách thoát giữa chừng/khách
     * quay lại), KHÔNG tạo đơn mới. Kênh lấy theo pay_channel đã lưu của
     * đơn (BANK/COD); fail-fast cấu hình như checkoutOrders.
     */
    public function repayParams(Request $request, string $code, ZaloPaymentService $service): JsonResponse
    {
        $order = $this->resolveCustomerOrder($request, $code);
        if (!$order) {
            return response()->json(['success' => false, 'message' => 'Không tìm thấy đơn hàng.'], 404);
        }
        // Vá A2 (Đại Vương chốt 2026-11-13 ~00:33): cấp lại params cho cả
        // transfer_notified — notify chỉ là "đã chọn phương thức", khách
        // có thể chưa chuyển đồng nào mà tờ Zalo đã đóng, phải còn đường
        // trả lại. Đơn đã hủy/đã hoàn thành chặn ngay tại đây bằng TRẠNG
        // THÁI ĐƠN (status): hủy đơn chưa trả KHÔNG đổi payment_status
        // (chỉ đơn đã paid mới sang refunded khi hủy) nên chỉ nhìn
        // payment_status là lọt đơn đã hủy còn pending_payment.
        if (!in_array($order->payment_status, ['pending_payment', 'transfer_notified'], true)
            || in_array($order->status, ['cancelled', 'completed'], true)
            || !in_array($order->pay_channel, [ZaloPaymentService::CHANNEL_BANK, ZaloPaymentService::CHANNEL_COD], true)) {
            return response()->json(['success' => false, 'message' => 'Đơn không còn ở trạng thái chờ thanh toán.'], 422);
        }
        // Đường trả qua Zalo đã ĐÓNG (spec hoàn tác xác nhận mục 3,
        // 2026-11-12): giao dịch BANK đã bị báo −1 phía Zalo (do hoàn tác
        // xác nhận hoặc đối soát ghi failed) thì KHÔNG cấp lại tham số
        // SDK — trả lại qua SDK sẽ tạo giao dịch thứ hai trên đơn đã chốt
        // thất bại phía Zalo. Khách chuyển khoản trực tiếp cho quán, NV
        // xác nhận tay như đơn BANK thường.
        if ($order->pay_channel === ZaloPaymentService::CHANNEL_BANK && $order->pay_sdk_status === 'failed') {
            return response()->json(['success' => false, 'message' => 'Đơn này không còn thanh toán qua Zalo được nữa. Vui lòng chuyển khoản trực tiếp cho quán theo thông tin quán cung cấp, quán sẽ xác nhận khi nhận được tiền.'], 422);
        }
        if (!$service->paymentKeyReady()) {
            return response()->json(['success' => false, 'message' => 'Kênh thanh toán đang được bảo trì. Vui lòng thử lại sau.'], 422);
        }
        if ($order->pay_channel === ZaloPaymentService::CHANNEL_BANK && !$service->bankInfoComplete()) {
            return response()->json(['success' => false, 'message' => 'Quán chưa cấu hình tài khoản nhận chuyển khoản.'], 422);
        }
        // createCheckoutParams luôn đặt lại payment_status =
        // 'pending_payment' khi phát params mới. Với đơn transfer_notified
        // phải GIỮ NGUYÊN trạng thái sau khi cấp lại: hạ về pending_payment
        // là âm thầm mở lại đường hủy online mà luật hủy (chốt 2026-10-26,
        // vá A4) đã khóa cho đơn đã báo chọn chuyển khoản.
        $wasTransferNotified = $order->payment_status === 'transfer_notified';
        try {
            $sdkParams = $service->createCheckoutParams($order, $order->pay_channel);
            if ($wasTransferNotified) {
                $order->update(['payment_status' => 'transfer_notified']);
            }
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Cấp lại params thất bại cho đơn ' . $order->code . ': ' . $e->getMessage());
            return response()->json(['success' => false, 'message' => 'Không khởi tạo được thanh toán. Đơn của bạn vẫn được lưu — vui lòng thử lại sau.'], 422);
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã cấp lại tham số thanh toán.',
            'data' => [
                'order' => $order->fresh()->load('customer'),
                'sdk_params' => $sdkParams['sdk_params'],
                'bank_info' => $sdkParams['bank_info'],
                'transfer_content' => $sdkParams['transfer_content'],
            ],
        ]);
    }

    /**
     * POST /api/payment/notify — nhận notify từ Zalo Checkout SDK.
     * Public (Zalo gọi). Verify mac trước khi đổi trạng thái (fail-closed).
     */
    public function notify(Request $request, ZaloPaymentService $service): JsonResponse
    {
        $result = $service->handleNotify($request->all());
        $status = $result['success'] ? 200 : 400;
        // Hợp đồng phản hồi notify chính thức (tài liệu Checkout SDK):
        // {returnCode: 1 = thành công, giá trị khác = thất bại, returnMessage}
        // — phía Zalo chỉ tiếp tục luồng thanh toán khi nhận returnCode 1.
        // Service có thể chỉ định returnCode riêng (2 = trùng transId cho
        // lượt bắn lại của callback hoàn tất) — tôn trọng khi đã có.
        // Giữ kèm success/message cho log/đối chiếu nội bộ.
        $result['returnCode'] = $result['returnCode'] ?? ($result['success'] ? 1 : 0);
        $result['returnMessage'] = $result['message'];
        return response()->json($result, $status);
    }
}
