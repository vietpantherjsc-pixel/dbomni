<?php

namespace App\Services;

use App\Models\Order;
use App\Models\PaymentNotify;
use App\Models\Product;
use App\Models\Setting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

// SPEC-01 + Gói Checkout SDK (spec spec-checkout-sdk-zalopay.md, Đại Vương
// phán Đ1–Đ5 2026-11-10): tích hợp Checkout SDK đúng hợp đồng chính thức —
// đợt này CHỈ BANK + COD (Đ2: ZALOPAY giai đoạn 2, không khai/không bật).
//
// Luồng:
// 1. createCheckoutParams($order, $channel): ký mac server-side theo công
//    thức chính thức (buildMac) → frontend mở CheckoutSDK.createOrder.
// 2. handleNotify($payload): notify BANK/COD {appId, orderId, method, mac}
//    → verify fail-closed → đối chiếu đơn qua pay_sdk_order_id → đổi trạng
//    thái (idempotent).
// 3. getOrderStatus/reconcileOrder: đối soát chủ động khi notify thất lạc
//    (job payments:reconcile-sdk). updateOrderStatus: báo kết quả cuối về
//    SDK — endpoint chưa có tài liệu chính thức (needs_validation).
//
// PrivateKey chỉ nằm ở server (.env ZALO_PAYMENT_PRIVATE_KEY), không expose ra client.
class ZaloPaymentService
{
    public const CHANNEL_BANK = 'BANK';
    public const CHANNEL_COD = 'COD';
    public const CHANNEL_ZALOPAY = 'ZALOPAY'; // Giai đoạn 2 — Đ2 (2026-11-10): đợt này KHÔNG khai/không bật kênh này ở bất kỳ đâu

    /**
     * Cấu hình kênh thanh toán cho Mini App (GET /api/payment/zalo-config).
     */
    public function config(): array
    {
        $bankInfo = [
            'account_number' => Setting::get('zalo_pay_bank_account', ''),
            'account_name' => Setting::get('zalo_pay_bank_name', ''),
            'bank_name' => Setting::get('zalo_pay_bank_bank', ''),
            // Spec QR 2026-10-21: mã NH (BIN 6 số, VD 970436) để dựng VietQR
            'bank_bin' => Setting::get('zalo_pay_bank_bin', ''),
            'transfer_content_template' => Setting::get('zalo_pay_transfer_template', 'DAYBREAK {order_code}'),
        ];

        return [
            'bank_enabled' => (bool) Setting::get('zalo_pay_bank_enabled', '1'),
            'cod_enabled' => (bool) Setting::get('zalo_pay_cod_enabled', '1'),
            'zalopay_enabled' => (bool) Setting::get('zalo_pay_zalopay_enabled', '0'),
            'bank_info' => $bankInfo,
            // Quy tắc COD: chỉ mang về/hẹn giờ (mặc định BẬT)
            'cod_takeaway_only' => (bool) Setting::get('zalo_pay_cod_takeaway_only', '1'),
            // Spec phí giao một nguồn mục 5.1: công tắc THU HỘ cho đơn GIAO
            // HÀNG (mặc định TẮT — khóa chưa tồn tại = Tắt, không cần dữ liệu
            // khởi tạo). Đơn giao dùng được COD khi cả cod_enabled (kênh) lẫn
            // khóa này cùng bật.
            'delivery_cod_enabled' => (bool) Setting::get('delivery_cod_enabled', '0'),
            // Spec QR 2026-10-21: kênh BANK chỉ "sẵn sàng" khi đủ thông tin NH + private key.
            // Mini App dùng cờ này để ẨN kênh BANK khi thiếu cấu hình (tránh kênh chết/đơn mồ côi).
            'bank_available' => (bool) Setting::get('zalo_pay_bank_enabled', '1')
                && $this->bankInfoComplete($bankInfo)
                && !empty(config('services.zalo_payment.private_key')),
            // Ngưỡng cảnh báo đơn chờ tiền quá lâu (phút) cho Admin/KDS
            'wait_alert_minutes' => max(1, (int) Setting::get('zalo_pay_wait_alert_minutes', '15')),
            // Gói Checkout SDK: kênh sandbox (id phương thức thêm hậu tố
            // _SANDBOX) — đọc từ config services (env ZALO_PAYMENT_SANDBOX).
            'sdk_sandbox' => (bool) config('services.zalo_payment.sandbox', false),
        ];
    }

    /** Spec QR: đủ 4 trường bắt buộc của tài khoản nhận CK chưa? */
    public function bankInfoComplete(?array $bankInfo = null): bool
    {
        $b = $bankInfo ?? $this->config()['bank_info'];
        return trim((string) ($b['account_number'] ?? '')) !== ''
            && trim((string) ($b['account_name'] ?? '')) !== ''
            && trim((string) ($b['bank_name'] ?? '')) !== ''
            && trim((string) ($b['bank_bin'] ?? '')) !== '';
    }

    /** Spec QR: private key ký mac đã cấu hình chưa (fail-fast trước khi tạo đơn)? */
    public function paymentKeyReady(): bool
    {
        return !empty(config('services.zalo_payment.private_key'));
    }

    /**
     * Spec QR: gói thông tin chuyển khoản cho 1 đơn BANK (dùng cho checkout + track).
     */
    public function transferInfoForOrder(Order $order): array
    {
        $cfg = $this->config();
        return [
            'bank_info' => $cfg['bank_info'],
            'transfer_content' => str_replace('{order_code}', $order->code, $cfg['bank_info']['transfer_content_template']),
            'amount' => (int) round((float) $order->total_amount),
        ];
    }

    /**
     * Gói Checkout SDK: công thức MAC CHÍNH THỨC của createOrder —
     * sắp xếp khóa tăng dần → nối `key=value` bằng `&` (giá trị mảng/object
     * thì JSON.stringify; phía PHP = json_encode KHÔNG thoát unicode/dấu /)
     * → HMAC-SHA256 bằng Private key. Public static để TESTER đối chiếu
     * golden vectors (checklist T-01 của spec). KHÔNG dùng http_build_query
     * (mã hóa URL làm lệch MAC ngay khi có dấu cách/tiếng Việt — lỗi bản cũ).
     */
    public static function buildMac(array $params, string $privateKey): string
    {
        ksort($params);
        $parts = [];
        foreach ($params as $key => $value) {
            if (is_array($value) || is_object($value)) {
                $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            } elseif (is_bool($value)) {
                $value = $value ? 'true' : 'false';
            }
            $parts[] = $key . '=' . $value;
        }
        return hash_hmac('sha256', implode('&', $parts), $privateKey);
    }

    /**
     * Tạo tham số mở Checkout SDK cho đơn hàng — ĐÚNG hợp đồng chính thức:
     * {amount, item:[{id, amount}], desc, extradata (JSON string),
     * method (JSON string {id, isCustom:false}), mac}. extradata/method khi
     * ký MAC dùng NGUYÊN VĂN chuỗi JSON; kênh sandbox thêm hậu tố _SANDBOX.
     * Ký mac bằng PrivateKey ở server — không ký ở client.
     */
    public function createCheckoutParams(Order $order, string $payChannel): array
    {
        $privateKey = config('services.zalo_payment.private_key');
        if (empty($privateKey)) {
            throw new \Exception('Chưa cấu hình Zalo Payment PrivateKey.');
        }

        $cfg = $this->config();
        $template = $cfg['bank_info']['transfer_content_template'];
        $transferContent = str_replace('{order_code}', $order->code, $template);

        // Dòng món cho SDK: id = product_id (chuỗi), amount = tiền của dòng.
        $order->loadMissing('items');
        $feeProductIds = Product::where('is_service_fee', true)->pluck('id')->map(fn ($id) => (int) $id)->all();
        $items = [];
        $hasFeeLine = false;
        foreach ($order->items as $item) {
            if (in_array((int) $item->product_id, $feeProductIds, true)) {
                $hasFeeLine = true;
            }
            $items[] = [
                'id' => (string) $item->product_id,
                'amount' => (int) round((float) $item->unit_price * (float) $item->quantity),
            ];
        }
        // F-SDK-1 (2026-11-14): đơn giao đã mang sẵn dòng "Phí dịch vụ"
        // trong items — store() (bước 6b) tự cộng dòng đó bằng đúng
        // shipping_fee đã chốt (gồm cả phí thu hộ COD), cho cả đơn thường
        // lẫn đơn nhóm (nhóm ủy quyền store()). Cộng thêm dòng SHIPPING ở
        // đây là tính phí ship 2 lần, phá bất biến tổng items = amount
        // (mẫu sống: đơn 3631 tổng dòng 79.000 trong khi amount 59.000).
        // Chỉ cộng SHIPPING khi items CHƯA có dòng phí (đường dự phòng
        // cho đơn có shipping_fee mà không qua bước 6b).
        if ((float) $order->shipping_fee > 0 && !$hasFeeLine) {
            $items[] = ['id' => 'SHIPPING', 'amount' => (int) round((float) $order->shipping_fee)];
        }
        // Giảm giá TIỀN HÀNG (KM/voucher): items giữ giá GỐC như hóa đơn,
        // amount vốn đã là tổng cuối sau giảm — KHÔNG thêm dòng âm để ép
        // tổng items = amount. Đại Vương phán 2026-11-14: bất biến đó là
        // đội tự suy từ mã mẫu, tài liệu Zalo không quy định; dòng âm là
        // giá trị không tài liệu nào xác nhận nên rủi ro hơn. (Đã từng có
        // bản thêm dòng DISCOUNT âm cùng ngày — gỡ theo phán này.)

        $methodId = $payChannel . (!empty($cfg['sdk_sandbox']) ? '_SANDBOX' : '');
        $params = [
            'amount' => (int) round((float) $order->total_amount),
            'item' => $items,
            // Gói vá sau vòng S — Mục 5 (Đại Vương phán 2026-11-11 ~17:04):
            // desc dùng CHUNG một nguồn mẫu với nội dung chuyển khoản
            // (transfer_content_template, mặc định "DAYBREAK {order_code}")
            // — lấy thẳng $transferContent đã dựng ở trên; desc nằm trong
            // chuỗi ký MAC nên fixture ký V1/V2 đã cập nhật theo mẫu mới.
            'desc' => $transferContent,
            'extradata' => json_encode(['order_code' => $order->code], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'method' => json_encode(['id' => $methodId, 'isCustom' => false], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
        $params['mac'] = self::buildMac($params, $privateKey);

        // Lưu kênh thanh toán + mốc vừa tạo params SDK vào đơn
        $order->update([
            'pay_channel' => $payChannel,
            'payment_status' => 'pending_payment',
            'pay_sdk_status' => 'created',
        ]);

        return [
            'sdk_params' => $params,
            'bank_info' => $payChannel === self::CHANNEL_BANK ? $cfg['bank_info'] : null,
            'transfer_content' => $transferContent,
        ];
    }

    /**
     * Xử lý notify từ Zalo Checkout SDK — phong bì THẬT (vật chứng log
     * 2026-11-11, đơn HD20261111000006): {"data": {method, orderId, appId,
     * extradata}, "overallMac": ..., "mac": ...} — trường nghiệp vụ nằm
     * trong 'data', tầng ngoài chỉ có data + 2 mac.
     * - mac = HMAC-SHA256(privateKey, "appId={appId}&orderId={orderId}&method={method}")
     *   trên 3 trường trong data (kiểm số học tại máy thử 2026-11-11: trùng).
     * - overallMac = HMAC-SHA256(privateKey, chuỗi sort 4 trường
     *   "appId=…&extradata={nguyên dạng url-encoded}&method=…&orderId=…") —
     *   lớp xác thực cho extradata; khi payload có overallMac thì bắt buộc khớp.
     * - Định danh đơn ƯU TIÊN qua extradata.order_code (giải mã URL → JSON)
     *   vì notify về TRƯỚC sdk-link (vật chứng: notify 17:00:43 < link
     *   17:00:58); dự phòng qua pay_sdk_order_id. extradata chỉ được tin
     *   khi overallMac đã xác thực nó. Verify fail-closed trước khi đổi
     *   trạng thái. Idempotent theo mốc đã nhận notify của đơn.
     * - F-SDK-2 (2026-11-14, hướng (c)): mã đã link khác mã notify (sau
     *   verify) = link của lượt mở khác do đua nhịp, KHÔNG loại đơn —
     *   nhận đơn theo extradata và chĩa link về mã notify sau cổng
     *   idempotent. Cổng hoàn tất (Phương án B) không đổi.
     */
    public function handleNotify(array $payload): array
    {
        $privateKey = (string) config('services.zalo_payment.private_key');
        // Bóc phong bì: đọc trường nghiệp vụ từ 'data'; payload phẳng
        // (không có 'data') vẫn đọc như cũ để tương thích ngược.
        $data = isset($payload['data']) && is_array($payload['data']) ? $payload['data'] : $payload;
        $appId = $data['appId'] ?? null;
        $sdkOrderId = $data['orderId'] ?? null;
        $methodRaw = (string) ($data['method'] ?? '');
        $extradataRaw = isset($data['extradata']) ? (string) $data['extradata'] : '';
        $amount = isset($data['amount']) ? (float) $data['amount'] : null;
        // Kênh sandbox mang hậu tố _SANDBOX (BANK_SANDBOX/COD_SANDBOX) — bỏ
        // hậu tố để về kênh gốc khi ghi sổ + đổi trạng thái.
        $channel = str_ends_with($methodRaw, '_SANDBOX')
            ? substr($methodRaw, 0, -strlen('_SANDBOX'))
            : $methodRaw;

        // Phân loại sự kiện: data mang resultCode/transId ⇒ CALLBACK HOÀN
        // TẤT (Zalo bắn ngược sau khi merchant báo updateOrderStatus) —
        // xử lý ở nhánh riêng, KHÔNG đi đường verify mac của notify
        // chọn-phương-thức bên dưới.
        if (isset($data['resultCode']) || !empty($data['transId'])) {
            return $this->handleCompletionNotify($payload, $data, $channel);
        }

        // 1. Verify mac (chuỗi 3 trường) + overallMac (chuỗi 4 trường, khi có)
        $macValid = false;
        if (!empty($privateKey) && !empty($payload['mac']) && $sdkOrderId !== null && $methodRaw !== '') {
            $expected = hash_hmac(
                'sha256',
                'appId=' . $appId . '&orderId=' . $sdkOrderId . '&method=' . $methodRaw,
                $privateKey
            );
            $macValid = hash_equals($expected, (string) $payload['mac']);
            if ($macValid && !empty($payload['overallMac'])) {
                $expectedOverall = hash_hmac(
                    'sha256',
                    'appId=' . $appId . '&extradata=' . $extradataRaw . '&method=' . $methodRaw . '&orderId=' . $sdkOrderId,
                    $privateKey
                );
                $macValid = hash_equals($expectedOverall, (string) $payload['overallMac']);
            }
        }
        // appId lệch cấu hình (chỉ kết luận khi cả hai phía cùng có giá trị)
        $cfgAppId = config('services.zalo_payment.app_id');
        if ($macValid && !empty($cfgAppId) && !empty($appId) && (string) $cfgAppId !== (string) $appId) {
            $macValid = false;
        }

        $notify = PaymentNotify::create([
            'pay_channel' => $channel !== '' ? $channel : null,
            'pay_trans_id' => $sdkOrderId,
            'amount' => $amount,
            'status' => 'notified',
            'mac_valid' => $macValid,
            'processed' => false,
            'payload' => $payload,
        ]);

        if (!$macValid) {
            Log::warning('[ZaloPay] Notify mac không hợp lệ', ['payload' => $payload]);
            return ['success' => false, 'message' => 'Chữ ký không hợp lệ.'];
        }

        // 2. Tìm đơn: ƯU TIÊN extradata.order_code — notify về trước
        //    sdk-link nên pay_sdk_order_id có thể chưa kịp gắn. extradata
        //    chỉ được tin khi overallMac (lớp ký phủ extradata) có mặt và
        //    đã verify ở bước 1; đối chiếu chéo với mã SDK đã link nếu có.
        $order = null;
        if (!empty($payload['overallMac']) && $extradataRaw !== '') {
            $extra = json_decode(urldecode($extradataRaw), true);
            $orderCode = is_array($extra) ? ($extra['order_code'] ?? null) : null;
            if ($orderCode) {
                $candidate = Order::where('code', $orderCode)->first();
                if ($candidate) {
                    if (!empty($candidate->pay_sdk_order_id)
                        && (string) $candidate->pay_sdk_order_id !== (string) $sdkOrderId) {
                        // F-SDK-2 (2026-11-14, hướng (c) PM duyệt): mã đã
                        // link khác mã notify KHÔNG còn là lý do loại đơn.
                        // Notify đã qua verify 2 lớp MAC ở bước 1 (mac
                        // phủ orderId · overallMac phủ extradata) nên mã
                        // lệch chỉ có thể là link của LƯỢT MỞ KHÁC —
                        // đường link phía client đi ≥4 chặng (PaymentDone
                        // → checkTransaction → POST sdk-link) trong khi
                        // notify đi 1 chặng server–server, notify về
                        // trước link là cấu trúc (mẫu sống §JD: 2 ca bị
                        // nuốt oan). Nhận đơn ứng viên; link được chĩa
                        // lại theo mã notify ở điểm ghi sau cổng
                        // idempotent bên dưới.
                        Log::info('[ZaloPay] Notify lệch mã link (đua nhịp lượt mở) — nhận đơn theo extradata đã xác thực', [
                            'order' => $candidate->code,
                            'linked_sdk_order_id' => $candidate->pay_sdk_order_id,
                            'notify_order_id' => $sdkOrderId,
                        ]);
                    }
                    $order = $candidate;
                }
            }
        }
        if (!$order && $sdkOrderId) {
            $order = Order::where('pay_sdk_order_id', $sdkOrderId)->first();
        }
        if (!$order) {
            Log::warning('[ZaloPay] Notify không tìm thấy đơn', ['payload' => $payload]);
            return ['success' => false, 'message' => 'Không tìm thấy đơn hàng.'];
        }
        $notify->update(['order_id' => $order->id]);

        // 3. Idempotent: đơn đã nhận notify và đã rời trạng thái chờ → bỏ qua
        if ($order->pay_notified_at && $order->payment_status !== 'pending_payment') {
            $notify->update(['processed' => true]);
            return ['success' => true, 'message' => 'Đã xử lý trước đó.'];
        }

        // F-SDK-2 — điểm ghi link, đặt SAU cổng idempotent: link đang
        // rỗng hoặc đang giữ mã của lượt mở khác → chĩa về mã của notify
        // vừa xác thực. Đặt sau bước 3 để notify trùng muộn của lượt mở
        // cũ (bị cổng idempotent trả về sớm ở trên) không chĩa link
        // ngược về mã cũ.
        if ($sdkOrderId && (string) $order->pay_sdk_order_id !== (string) $sdkOrderId) {
            $order->update(['pay_sdk_order_id' => $sdkOrderId]);
        }

        // 4. Lệch số tiền — CHỈ khi data biến thể có mang amount: quá
        // 1.000đ thì gắn cờ cần kiểm tra tay, KHÔNG đổi trạng thái tiền.
        if ($amount !== null && abs($amount - (float) $order->total_amount) > 1000) {
            $order->update([
                'pay_trans_id' => $sdkOrderId,
                'pay_notified_at' => now(),
                'pay_needs_review' => true,
            ]);
            $notify->update(['processed' => true]);
            Log::warning('[ZaloPay] Số tiền notify lệch tổng đơn', [
                'order' => $order->code,
                'notify_amount' => $amount,
                'order_total' => (float) $order->total_amount,
            ]);
            return ['success' => true, 'message' => 'Đã ghi nhận, cần kiểm tra tay (lệch số tiền).'];
        }

        // 5. Áp trạng thái theo kênh (dùng chung với đường đối soát)
        $this->applySdkPaymentConfirmed($order, $channel !== '' ? $channel : $order->pay_channel, $sdkOrderId);

        $notify->update(['processed' => true]);
        return ['success' => true, 'message' => 'Đã xử lý notify.'];
    }

    /**
     * Xử lý CALLBACK HOÀN TẤT — biến thể Zalo bắn ngược ngay khi nhận
     * updateOrderStatus thành công của merchant (vật chứng payment_notifies
     * id 6, HD20261111000007, 2026-11-11: data 9 trường có amount/transId/
     * resultCode/message/description; sinh cùng giây với log err 0 của
     * lượt báo 'paid'). Bản chất là TIẾNG VỌNG xác nhận sau hành động của
     * chính quán — Đại Vương CHỐT Phương án B (2026-11-11):
     * - Công thức ký của biến thể này CHƯA có tài liệu (38 phép đối chiếu
     *   đều lệch, kể cả chuỗi canonical của MAC Debug tool) → mac vẫn tính
     *   thật để ghi sổ (mac_valid trung thực) nhưng KHÔNG làm cổng; cổng
     *   chấp nhận là CỔNG TƯƠNG QUAN 4 điều kiện ở dưới. Mục
     *   needs_validation về công thức ký đi kèm qua PM.
     * - Idempotent theo transId: lượt bắn lại (Zalo retry mỗi 2 phút)
     *   trả returnCode 2 (đúng nghĩa "trùng transId" của tài liệu
     *   callback), không xử lý trùng.
     * - TUYỆT ĐỐI không lật trạng thái đơn/điểm/kho trong mọi trường hợp:
     *   chỉ ghi nhận; amount lệch hoặc đơn chưa paid phía quán thì gắn
     *   pay_needs_review + log để kiểm tay.
     */
    private function handleCompletionNotify(array $payload, array $data, string $channel): array
    {
        $privateKey = (string) config('services.zalo_payment.private_key');
        $appId = $data['appId'] ?? null;
        $sdkOrderId = $data['orderId'] ?? null;
        $methodRaw = (string) ($data['method'] ?? '');
        $transId = !empty($data['transId']) ? (string) $data['transId'] : null;
        $extradataRaw = isset($data['extradata']) ? (string) $data['extradata'] : '';
        $amount = isset($data['amount']) ? (float) $data['amount'] : null;
        // Khóa idempotent: transId của sự kiện; thiếu transId thì dùng
        // orderId phía SDK (vẫn an toàn vì truy vấn khoanh theo status
        // 'completed', không đụng dòng notify chọn-phương-thức 'notified').
        $idemKey = $transId ?? ($sdkOrderId !== null ? (string) $sdkOrderId : null);

        // Verify mac THẬT theo 2 khuôn tài liệu (notify 3 trường + overallMac
        // sort mọi trường hiện có) — chỉ để ghi sổ trung thực, không làm cổng.
        $macValid = false;
        if (!empty($privateKey) && !empty($payload['mac']) && $sdkOrderId !== null && $methodRaw !== '') {
            $expected = hash_hmac(
                'sha256',
                'appId=' . $appId . '&orderId=' . $sdkOrderId . '&method=' . $methodRaw,
                $privateKey
            );
            $macValid = hash_equals($expected, (string) $payload['mac']);
            if ($macValid && !empty($payload['overallMac'])) {
                $fields = $data;
                ksort($fields);
                $pairs = [];
                foreach ($fields as $k => $v) {
                    $pairs[] = $k . '=' . (is_scalar($v) ? (string) $v : json_encode($v));
                }
                $expectedOverall = hash_hmac('sha256', implode('&', $pairs), $privateKey);
                $macValid = hash_equals($expectedOverall, (string) $payload['overallMac']);
            }
        }

        // Idempotent: sự kiện hoàn tất cùng khóa đã ghi nhận + xử lý → trùng.
        if ($idemKey !== null) {
            $dupe = PaymentNotify::where('pay_trans_id', $idemKey)
                ->where('status', 'completed')
                ->where('processed', true)
                ->first();
            if ($dupe) {
                return ['success' => true, 'returnCode' => 2, 'message' => 'Đã ghi nhận trước đó.'];
            }
        }

        $notify = PaymentNotify::create([
            'pay_channel' => $channel !== '' ? $channel : null,
            'pay_trans_id' => $idemKey,
            'amount' => $amount,
            'status' => 'completed',
            'mac_valid' => $macValid,
            'processed' => false,
            'payload' => $payload,
        ]);

        // CỔNG TƯƠNG QUAN — (1) appId khớp cấu hình
        $cfgAppId = config('services.zalo_payment.app_id');
        if (empty($appId) || empty($cfgAppId) || (string) $cfgAppId !== (string) $appId) {
            Log::warning('[ZaloPay] Callback hoàn tất: appId không khớp cấu hình', ['payload' => $payload]);
            return ['success' => false, 'message' => 'appId không khớp.'];
        }
        // (2) pay_sdk_order_id khớp orderId của sự kiện VÀ extradata.order_code
        //     trỏ về CÙNG một đơn
        $order = $sdkOrderId ? Order::where('pay_sdk_order_id', $sdkOrderId)->first() : null;
        $extra = $extradataRaw !== '' ? json_decode(urldecode($extradataRaw), true) : null;
        $orderCode = is_array($extra) ? ($extra['order_code'] ?? null) : null;
        if (!$order || !$orderCode || (string) $order->code !== (string) $orderCode) {
            Log::warning('[ZaloPay] Callback hoàn tất: không đối chiếu được đơn', ['payload' => $payload]);
            return ['success' => false, 'message' => 'Không đối chiếu được đơn hàng.'];
        }
        $notify->update(['order_id' => $order->id]);

        // (3) amount lệch tổng đơn > 1.000đ → ghi nhận + cờ kiểm tay
        // (4) đơn CHƯA paid phía quán → chỉ gắn cờ + log, không tự paid
        $needsReview = false;
        if ($amount !== null && abs($amount - (float) $order->total_amount) > 1000) {
            $needsReview = true;
            Log::warning('[ZaloPay] Callback hoàn tất: số tiền lệch tổng đơn', [
                'order' => $order->code,
                'callback_amount' => $amount,
                'order_total' => (float) $order->total_amount,
            ]);
        }
        if ($order->payment_status !== 'paid') {
            $needsReview = true;
            Log::warning('[ZaloPay] Callback hoàn tất về khi đơn chưa paid phía quán', [
                'order' => $order->code,
                'payment_status' => $order->payment_status,
            ]);
        }
        if ($needsReview) {
            $order->update(['pay_needs_review' => true]);
        }

        $notify->update(['processed' => true]);
        Log::info('[ZaloPay] Đã ghi nhận callback hoàn tất (cổng tương quan)', [
            'order' => $order->code,
            'trans_id' => $transId,
            'result_code' => isset($data['resultCode']) ? (int) $data['resultCode'] : null,
            'mac_valid' => $macValid,
            'needs_review' => $needsReview,
        ]);
        return ['success' => true, 'message' => 'Đã ghi nhận hoàn tất.'];
    }

    /**
     * Áp "kênh SDK đã xác nhận" lên đơn — dùng chung cho handleNotify và
     * reconcileOrder (đối soát getOrderStatus) để 2 đường không lệch nhau:
     * - BANK: → transfer_notified (chờ NV đối chiếu sao kê như luật hiện hành)
     * - COD: → payment_status 'confirmed' + status 'pending' vào KDS.
     *   Audit toàn diện 2026-10-21 🔴3: KHÔNG đặt status 'confirmed' — trạng
     *   thái đó nằm ngoài state machine khiến đơn kẹt vĩnh viễn khỏi KDS/UI.
     */
    private function applySdkPaymentConfirmed(Order $order, ?string $channel, ?string $transId): void
    {
        if ($channel === self::CHANNEL_BANK) {
            $order->update([
                'pay_trans_id' => $transId,
                'pay_notified_at' => now(),
                'payment_status' => 'transfer_notified',
                'pay_sdk_status' => 'notified',
            ]);
        } elseif ($channel === self::CHANNEL_COD) {
            $updates = [
                'pay_trans_id' => $transId,
                'pay_notified_at' => now(),
                'payment_status' => 'confirmed',
                'pay_sdk_status' => 'notified',
            ];
            // Chỉ kéo status về 'pending' khi đơn còn ở các mốc trước pha
            // chế — tránh đối soát muộn kéo lùi đơn đã đi tiếp.
            if (in_array($order->status, ['pending', 'confirmed'], true)) {
                $updates['status'] = 'pending';
            }
            $order->update($updates);
        }
    }

    /**
     * Gói Checkout SDK: truy vấn trạng thái giao dịch phía Zalo
     * (server → Zalo) để đối soát khi notify thất lạc.
     * GET {api_base}/api/transaction/get-status?orderId&appId&mac với
     * mac = HMAC-SHA256(privateKey, "appId={appId}&orderId={orderId}&privateKey={privateKey}")
     * (chuỗi ký chứa privateKey nguyên văn — đúng tài liệu chính thức).
     * Lỗi/thiếu cấu hình → log + null (fail-soft, job bỏ qua đơn này).
     */
    public function getOrderStatus(Order $order): ?array
    {
        $privateKey = (string) config('services.zalo_payment.private_key');
        $appId = config('services.zalo_payment.app_id');
        if (empty($privateKey) || empty($appId) || empty($order->pay_sdk_order_id)) {
            Log::warning('[ZaloPay] getOrderStatus thiếu cấu hình hoặc mã SDK', ['order' => $order->code]);
            return null;
        }
        $mac = hash_hmac(
            'sha256',
            'appId=' . $appId . '&orderId=' . $order->pay_sdk_order_id . '&privateKey=' . $privateKey,
            $privateKey
        );
        $base = rtrim((string) (config('services.zalo_payment.api_base') ?: 'https://payment-mini.zalo.me'), '/');
        try {
            $res = Http::timeout(10)->get($base . '/api/transaction/get-status', [
                'orderId' => $order->pay_sdk_order_id,
                'appId' => $appId,
                'mac' => $mac,
            ]);
            if (!$res->successful()) {
                Log::warning('[ZaloPay] getOrderStatus HTTP lỗi', ['order' => $order->code, 'http' => $res->status()]);
                return null;
            }
            $data = $res->json();
            // Phản hồi THẬT có phong bì {err, msg, data: {returnCode, …}}
            // (vật chứng lượt đối soát 2026-11-11) — bóc tầng 'data' ngay
            // tại điểm trả duy nhất này để nơi tiêu thụ (reconcileOrder)
            // đọc returnCode/amount/transId đúng tầng; thân không có
            // phong bì thì trả nguyên như cũ.
            if (is_array($data) && isset($data['data']) && is_array($data['data'])) {
                return $data['data'];
            }
            return is_array($data) ? $data : null;
        } catch (\Throwable $e) {
            Log::warning('[ZaloPay] getOrderStatus lỗi', ['order' => $order->code, 'msg' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Gói Checkout SDK (spec §2.5): báo trạng thái cuối của đơn về Zalo
     * (BANK đã thu tiền → 'paid' · BANK bị từ chối/hủy → 'failed' · COD
     * hoàn tất → 'completed' · COD hủy → 'cancelled').
     *
     * Khuôn CHÍNH THỨC (Vá A 2026-11-11 — khép needs_validation cũ; nguồn:
     * trang API updateOrderStatus của Zalo, cập nhật 9/11/2026):
     * POST {api_base}/api/transaction/{appId}/{hậu tố} với hậu tố theo
     * đường tạo đơn: BANK qua createOrder → 'bank-callback-payment' ·
     * COD → 'cod-callback-payment' · đơn qua openCheckoutPopup (API
     * purchase) → 'purchase-payment' · phương thức riêng →
     * 'custom-callback-payment'. Env ZALO_PAYMENT_UPDATE_STATUS_URL có
     * giá trị thì ghi đè toàn bộ URL (đường thoát khi Zalo đổi khuôn).
     * Body {appId, orderId, resultCode, mac}: resultCode là SỐ (1 thành
     * công · 0 đã hoàn tiền · −1 thất bại); mac = HMAC-SHA256(privateKey,
     * "appId={appId}&orderId={orderId}&resultCode={resultCode}&privateKey={privateKey}").
     * Phản hồi {err: 0} mới coi là báo thành công; khác → ghi log rõ.
     * Method này FAIL-SOFT tuyệt đối: không bao giờ ném lỗi ra ngoài.
     */
    public function updateOrderStatus(Order $order, string $sdkStatus): ?array
    {
        try {
            // Ánh xạ từ vựng nội bộ → resultCode số theo hợp đồng Zalo.
            $resultCode = match ($sdkStatus) {
                'paid', 'completed' => 1,
                'refunded' => 0,
                'failed', 'cancelled' => -1,
                default => null,
            };
            if ($resultCode === null) {
                Log::warning('[ZaloPay] updateOrderStatus: trạng thái nội bộ chưa có resultCode tương ứng — bỏ qua.', [
                    'order' => $order->code, 'status' => $sdkStatus,
                ]);
                return null;
            }
            if (empty($order->pay_sdk_order_id)) {
                return null;
            }
            $privateKey = (string) config('services.zalo_payment.private_key');
            $appId = config('services.zalo_payment.app_id');
            if (empty($privateKey) || empty($appId)) {
                Log::warning('[ZaloPay] updateOrderStatus thiếu khóa/appId — bỏ qua.', ['order' => $order->code]);
                return null;
            }

            $url = $this->updateStatusUrl($order, (string) $appId);
            $mac = hash_hmac(
                'sha256',
                'appId=' . $appId . '&orderId=' . $order->pay_sdk_order_id
                    . '&resultCode=' . $resultCode . '&privateKey=' . $privateKey,
                $privateKey
            );
            $res = Http::timeout(10)->post($url, [
                'appId' => $appId,
                'orderId' => $order->pay_sdk_order_id,
                'resultCode' => $resultCode,
                'mac' => $mac,
            ]);
            $body = $res->json();
            if (is_array($body) && (int) ($body['err'] ?? -1) === 0) {
                Log::info('[ZaloPay] updateOrderStatus báo thành công', [
                    'order' => $order->code, 'status' => $sdkStatus, 'resultCode' => $resultCode, 'url' => $url,
                ]);
            } else {
                Log::warning('[ZaloPay] updateOrderStatus: Zalo không xác nhận (err khác 0 hoặc phản hồi lạ)', [
                    'order' => $order->code, 'status' => $sdkStatus, 'resultCode' => $resultCode,
                    'url' => $url, 'http' => $res->status(), 'body' => $body,
                ]);
            }
            return is_array($body) ? $body : ['http_status' => $res->status()];
        } catch (\Throwable $e) {
            Log::warning('[ZaloPay] updateOrderStatus lỗi (bỏ qua, không chặn luồng đơn)', [
                'order' => $order->code, 'status' => $sdkStatus, 'msg' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Vá A (2026-11-11): URL updateOrderStatus — env
     * ZALO_PAYMENT_UPDATE_STATUS_URL có giá trị thì dùng thẳng; không thì
     * dựng từ api_base + appId + hậu tố theo kênh/đường tạo đơn của đơn.
     * Đơn popup (Vá B) khi triển khai sẽ mang pay_channel 'POPUP' để rẽ
     * sang 'purchase-payment'; hiện chưa có đơn popup nào trong hệ thống.
     */
    private function updateStatusUrl(Order $order, string $appId): string
    {
        $override = (string) config('services.zalo_payment.update_status_url');
        if ($override !== '') {
            return $override;
        }
        $suffix = match (strtoupper((string) $order->pay_channel)) {
            self::CHANNEL_BANK => 'bank-callback-payment',
            self::CHANNEL_COD => 'cod-callback-payment',
            'POPUP' => 'purchase-payment',
            default => 'custom-callback-payment',
        };
        $base = rtrim((string) config('services.zalo_payment.api_base'), '/');
        return $base . '/api/transaction/' . $appId . '/' . $suffix;
    }

    /**
     * Gói Checkout SDK (spec §2.6): đối soát 1 đơn chờ thanh toán bằng
     * getOrderStatus — dùng bởi job payments:reconcile-sdk.
     * returnCode 1 → áp như notify thành công theo kênh của đơn (kèm đối
     * chiếu amount: lệch > 1.000đ → pay_needs_review, không đổi trạng thái
     * tiền) · −1 → pay_sdk_status 'failed' (giữ payment_status) · 0 →
     * 'processing'. Không lấy được trạng thái → giữ nguyên đơn.
     */
    public function reconcileOrder(Order $order): void
    {
        $st = $this->getOrderStatus($order);
        if ($st === null || !isset($st['returnCode'])) {
            return;
        }
        $rc = (int) $st['returnCode'];
        if ($rc === 1) {
            if (isset($st['amount']) && abs((float) $st['amount'] - (float) $order->total_amount) > 1000) {
                $order->update(['pay_needs_review' => true, 'pay_sdk_status' => 'notified']);
                Log::warning('[ZaloPay] Đối soát: số tiền phía SDK lệch tổng đơn', [
                    'order' => $order->code,
                    'sdk_amount' => (float) $st['amount'],
                    'order_total' => (float) $order->total_amount,
                ]);
                return;
            }
            $this->applySdkPaymentConfirmed($order, $order->pay_channel, $st['transId'] ?? $order->pay_sdk_order_id);
        } elseif ($rc === -1) {
            $order->update(['pay_sdk_status' => 'failed']);
        } elseif ($rc === 0) {
            $order->update(['pay_sdk_status' => 'processing']);
        }
    }
}
