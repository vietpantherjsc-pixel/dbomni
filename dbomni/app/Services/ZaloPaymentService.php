<?php

namespace App\Services;

use App\Models\Order;
use App\Models\PaymentNotify;
use App\Models\Setting;
use Illuminate\Support\Facades\Log;

// SPEC-01: Tích hợp Zalo Checkout SDK (giai đoạn 1: BANK + COD).
//
// Luồng:
// 1. createCheckoutOrder($order): tạo đơn DB (pending_payment) + ký mac server-side
//    → trả về params để frontend mở Checkout SDK.
// 2. handleNotify($payload): verify mac → cập nhật trạng thái đơn (idempotent).
//
// PrivateKey chỉ nằm ở server (.env ZALO_PAYMENT_PRIVATE_KEY), không expose ra client.
class ZaloPaymentService
{
    public const CHANNEL_BANK = 'BANK';
    public const CHANNEL_COD = 'COD';
    public const CHANNEL_ZALOPAY = 'ZALOPAY'; // Giai đoạn 2

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
            // Spec QR 2026-10-21: kênh BANK chỉ "sẵn sàng" khi đủ thông tin NH + private key.
            // Mini App dùng cờ này để ẨN kênh BANK khi thiếu cấu hình (tránh kênh chết/đơn mồ côi).
            'bank_available' => (bool) Setting::get('zalo_pay_bank_enabled', '1')
                && $this->bankInfoComplete($bankInfo)
                && !empty(config('services.zalo_payment.private_key')),
            // Ngưỡng cảnh báo đơn chờ tiền quá lâu (phút) cho Admin/KDS
            'wait_alert_minutes' => max(1, (int) Setting::get('zalo_pay_wait_alert_minutes', '15')),
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
     * Spec QR 2026-10-21: dựng chuỗi EMV VietQR (NAPAS) cho 1 đơn.
     * Trả null khi thiếu mã NH/số TK — Mini App khi đó chỉ hiện khối STK sao chép tay.
     */
    public function vietQrPayload(Order $order): ?string
    {
        $cfg = $this->config();
        $bin = preg_replace('/\D/', '', (string) $cfg['bank_info']['bank_bin']);
        $account = trim((string) $cfg['bank_info']['account_number']);
        if ($bin === '' || $account === '') {
            return null;
        }
        $content = str_replace('{order_code}', $order->code, $cfg['bank_info']['transfer_content_template']);
        $amount = (string) (int) round((float) $order->total_amount);

        $tlv = static fn (string $id, string $value): string => $id . str_pad((string) strlen($value), 2, '0', STR_PAD_LEFT) . $value;
        // Tổ chức thụ hưởng: 00 = BIN, 01 = số tài khoản; dịch vụ QRIBFTTA (chuyển nhanh NAPAS)
        $beneficiary = $tlv('00', $bin) . $tlv('01', $account);
        $merchantAccount = $tlv('38', $tlv('00', 'A000000727') . $tlv('01', $beneficiary) . $tlv('02', 'QRIBFTTA'));

        $payload = $tlv('00', '01')          // Payload Format Indicator
            . $tlv('01', '12')              // Dynamic QR (có số tiền)
            . $merchantAccount
            . $tlv('53', '704')             // VND
            . $tlv('54', $amount)
            . $tlv('58', 'VN')
            . $tlv('62', $tlv('08', $content)); // Nội dung CK
        $payload .= '6304';
        return $payload . strtoupper(str_pad(dechex($this->crc16Ccitt($payload)), 4, '0', STR_PAD_LEFT));
    }

    /** CRC16-CCITT (0xFFFF) theo chuẩn EMVCo cho VietQR. */
    private function crc16Ccitt(string $data): int
    {
        $crc = 0xFFFF;
        $len = strlen($data);
        for ($i = 0; $i < $len; $i++) {
            $crc ^= ord($data[$i]) << 8;
            for ($b = 0; $b < 8; $b++) {
                $crc = ($crc & 0x8000) ? (($crc << 1) ^ 0x1021) : ($crc << 1);
                $crc &= 0xFFFF;
            }
        }
        return $crc;
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
            'vietqr_payload' => $this->vietQrPayload($order),
            'amount' => (int) round((float) $order->total_amount),
        ];
    }

    /**
     * Tạo tham số mở Checkout SDK cho đơn hàng.
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

        // Dữ liệu ký mac (theo docs Zalo Checkout SDK)
        $data = [
            'app_id' => config('services.zalo_payment.app_id'),
            'order_code' => $order->code,
            'amount' => (int) round((float) $order->total_amount),
            'pay_channel' => $payChannel,
            'transfer_content' => $transferContent,
            'timestamp' => now()->timestamp,
        ];
        $data['mac'] = $this->signMac($data, $privateKey);

        // Lưu kênh thanh toán vào đơn
        $order->update([
            'pay_channel' => $payChannel,
            'payment_status' => 'pending_payment',
        ]);

        return [
            'sdk_params' => $data,
            'bank_info' => $payChannel === self::CHANNEL_BANK ? $cfg['bank_info'] : null,
            'transfer_content' => $transferContent,
            // Spec QR 2026-10-21: chuỗi EMV để Mini App sinh VietQR tại máy
            'vietqr_payload' => $payChannel === self::CHANNEL_BANK ? $this->vietQrPayload($order) : null,
        ];
    }

    /**
     * Xử lý notify từ Zalo Checkout SDK.
     * Verify mac trước khi đổi trạng thái (fail-closed). Idempotent.
     */
    public function handleNotify(array $payload): array
    {
        $privateKey = config('services.zalo_payment.private_key');

        // 1. Verify mac
        $macValid = $this->verifyMac($payload, $privateKey);

        $notify = PaymentNotify::create([
            'pay_channel' => $payload['pay_channel'] ?? null,
            'pay_trans_id' => $payload['trans_id'] ?? null,
            'amount' => isset($payload['amount']) ? (float) $payload['amount'] : null,
            'status' => $payload['status'] ?? null,
            'mac_valid' => $macValid,
            'processed' => false,
            'payload' => $payload,
        ]);

        if (!$macValid) {
            Log::warning('[ZaloPay] Notify mac không hợp lệ', ['payload' => $payload]);
            return ['success' => false, 'message' => 'Chữ ký không hợp lệ.'];
        }

        // 2. Tìm đơn hàng
        $order = Order::where('code', $payload['order_code'] ?? '')->first();
        if (!$order) {
            Log::warning('[ZaloPay] Notify không tìm thấy đơn', ['payload' => $payload]);
            return ['success' => false, 'message' => 'Không tìm thấy đơn hàng.'];
        }
        $notify->update(['order_id' => $order->id]);

        // 3. Idempotent: đã xử lý rồi thì bỏ qua
        if ($notify->processed || $order->pay_trans_id === ($payload['trans_id'] ?? null)) {
            return ['success' => true, 'message' => 'Đã xử lý trước đó.'];
        }

        // 4. Kiểm tra số tiền khớp tổng đơn
        $notifyAmount = (float) ($payload['amount'] ?? 0);
        $orderTotal = (float) $order->total_amount;
        if (abs($notifyAmount - $orderTotal) > 1000) { // lệch quá 1.000đ
            $order->update([
                'pay_trans_id' => $payload['trans_id'] ?? null,
                'pay_notified_at' => now(),
                'pay_needs_review' => true,
            ]);
            $notify->update(['processed' => true]);
            Log::warning('[ZaloPay] Số tiền notify lệch tổng đơn', [
                'order' => $order->code,
                'notify_amount' => $notifyAmount,
                'order_total' => $orderTotal,
            ]);
            return ['success' => true, 'message' => 'Đã ghi nhận, cần kiểm tra tay (lệch số tiền).'];
        }

        // 5. Cập nhật trạng thái theo kênh
        $channel = $payload['pay_channel'] ?? $order->pay_channel;
        if ($channel === self::CHANNEL_BANK) {
            // BANK: chuyển sang transfer_notified (chờ NV đối chiếu sao kê)
            $order->update([
                'pay_trans_id' => $payload['trans_id'] ?? null,
                'pay_notified_at' => now(),
                'payment_status' => 'transfer_notified',
            ]);
        } elseif ($channel === self::CHANNEL_COD) {
            // COD: Zalo đã xác nhận đơn → vào KDS như đơn thường (status 'pending',
            // đi đúng state machine pending → processing → ready → completed).
            // Audit toàn diện 2026-10-21 🔴3: KHÔNG dùng status 'confirmed' nữa —
            // trạng thái đó nằm ngoài state machine khiến đơn kẹt vĩnh viễn khỏi KDS/UI.
            // payment_status giữ 'confirmed' = kênh đã xác nhận (tiền thu khi giao hàng).
            $order->update([
                'pay_trans_id' => $payload['trans_id'] ?? null,
                'pay_notified_at' => now(),
                'payment_status' => 'confirmed',
                'status' => 'pending',
            ]);
        }

        $notify->update(['processed' => true]);
        return ['success' => true, 'message' => 'Đã xử lý notify.'];
    }

    /**
     * Ký mac HMAC-SHA256.
     */
    private function signMac(array $data, string $privateKey): string
    {
        ksort($data);
        $str = http_build_query($data);
        return hash_hmac('sha256', $str, $privateKey);
    }

    /**
     * Verify mac từ notify.
     */
    private function verifyMac(array $payload, string $privateKey): bool
    {
        if (empty($privateKey) || empty($payload['mac'])) {
            return false; // fail-closed
        }
        $mac = $payload['mac'];
        unset($payload['mac']);
        $expected = $this->signMac($payload, $privateKey);
        return hash_equals($expected, $mac);
    }
}
