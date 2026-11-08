<?php

namespace App\Services\Delivery;

use App\Models\DeliveryLog;
use App\Models\Order;
use App\Models\Setting;
use Illuminate\Support\Facades\Log;

// Gói 60 (2026-10-17): Service điều phối giao hàng.
// Checkout/KDS/Admin chỉ gọi service này, không gọi trực tiếp từng hãng.
class DeliveryService
{
    // Trạng thái giao nội bộ (map từ webhook hai hãng — xem statusMap())
    public const ST_SEARCHING = 'searching_driver';
    public const ST_ASSIGNED = 'driver_assigned';
    public const ST_PICKED_UP = 'picked_up';
    public const ST_DELIVERING = 'delivering';
    // Spec KDS book ship mục 3.2: nấc mới của chế độ tay (cột string(30) chứa vừa)
    public const ST_ARRIVED = 'arrived';
    public const ST_DELIVERED = 'delivered';
    public const ST_FAILED = 'failed';
    public const ST_CANCELLED = 'cancelled';

    public static function labels(): array
    {
        return [
            self::ST_SEARCHING => 'Đang tìm tài xế',
            self::ST_ASSIGNED => 'Đã có tài xế',
            self::ST_PICKED_UP => 'Đã lấy hàng',
            self::ST_DELIVERING => 'Đang giao',
            self::ST_ARRIVED => 'Tài xế đã đến nơi',
            self::ST_DELIVERED => 'Giao thành công',
            self::ST_FAILED => 'Giao thất bại',
            self::ST_CANCELLED => 'Đã hủy giao',
        ];
    }

    public function providers(): array
    {
        return [
            'ahamove' => app(AhaMoveProvider::class),
            'lalamove' => app(LalamoveProvider::class),
        ];
    }

    public function provider(string $code): ?DeliveryProvider
    {
        return $this->providers()[$code] ?? null;
    }

    // ---- Cấu hình vận hành (settings — đổi trong Thiết lập, không hardcode) ----
    public function isProviderEnabled(string $code): bool
    {
        return (bool) Setting::get('delivery_' . $code . '_enabled', $code === 'ahamove' ? '1' : '1');
    }

    public function primaryProvider(): string
    {
        return Setting::get('delivery_primary', 'ahamove');
    }

    public function failoverTimeoutMinutes(): int
    {
        return max(1, (int) Setting::get('delivery_failover_timeout_minutes',
            config('delivery.failover_timeout_minutes', 5)));
    }

    /** Mức trần chênh phí failover mỗi đơn (quán chịu trong trần, vượt trần báo khách). */
    public function failoverMaxDiff(): int
    {
        return max(0, (int) Setting::get('delivery_failover_max_diff', 10000));
    }

    public function supportThreshold(): int
    {
        return max(0, (int) Setting::get('delivery_support_threshold', 150000));
    }

    public function supportAmount(): int
    {
        return max(0, (int) Setting::get('delivery_support_amount', 15000));
    }

    public function isConfigured(): bool
    {
        foreach ($this->providers() as $code => $p) {
            if ($this->isProviderEnabled($code) && $p->isConfigured()) return true;
        }
        return false;
    }

    // ---- Báo giá ----
    /**
     * Gọi tuần tự hai hãng (mỗi hãng timeout 5s → tối đa ~10s).
     * Frontend có timeout riêng 8s + hiển thị "đang tính phí ship" (checklist #2).
     */
    public function quote(array $params): array
    {
        $out = ['success' => false, 'providers' => [], 'error' => null];
        foreach ($this->providers() as $code => $provider) {
            if (!$this->isProviderEnabled($code) || !$provider->isConfigured()) {
                continue;
            }
            try {
                $r = $provider->estimateFee($params);
            } catch (\Throwable $e) {
                $r = ['success' => false, 'error' => 'Lỗi kết nối ' . $provider->label()];
            }
            $out['providers'][$code] = [
                'label' => $provider->label(),
                'success' => (bool) ($r['success'] ?? false),
                'distance_km' => $r['distance_km'] ?? null,
                'packages' => $r['packages'] ?? [],
                'error' => $r['error'] ?? null,
            ];
        }
        $ok = array_filter($out['providers'], fn($p) => $p['success'] && !empty($p['packages']));
        $out['success'] = !empty($ok);
        if (!$out['success']) {
            $out['error'] = 'Chưa giao được tới địa chỉ này. Vui lòng thử địa chỉ khác hoặc chọn nhận tại quán.';
        }
        return $out;
    }

    /**
     * Tính phần quán hỗ trợ phí ship theo ngưỡng đã chốt:
     * đơn từ 150.000đ → quán hỗ trợ 15.000đ.
     * Trả về ['support' => int, 'charged' => int].
     */
    public function applySupport(int $subtotal, int $fee): array
    {
        $support = ($subtotal >= $this->supportThreshold()) ? min($this->supportAmount(), $fee) : 0;
        return ['support' => $support, 'charged' => max(0, $fee - $support)];
    }

    // ---- Spec KDS book ship: chuẩn bị dữ kiện đặt ship ----
    /**
     * Gán delivery_cod_amount + delivery_quoted_fee — phần chuẩn bị vốn nằm ở
     * 2 điểm tự tạo đơn hãng (OnlinePaymentConfirmer + OrderController::
     * updateStatus), ĐÃ GỠ theo spec mục 1. Nay chạy ngay trước thao tác đặt
     * tại KDS (đặt hãng / bắt đầu chế độ tay / retry Admin) — công thức giữ
     * nguyên vẹn: COD = 0 nếu đơn đã trả trước, ngược lại = tổng đơn;
     * quoted_fee giữ phí gốc đã lưu, chỉ fallback khi trống.
     */
    public function prepareBookingData(Order $order): void
    {
        $order->delivery_cod_amount = $order->payment_status === 'paid'
            ? 0
            : (int) round((float) $order->total_amount);
        $order->delivery_quoted_fee = $order->delivery_quoted_fee
            ?? $order->delivery_fee_charged
            ?? $order->shipping_fee;
        $order->save();
    }

    /**
     * Hãng hệ thống SẼ dùng nếu đặt ngay lúc này — gương đúng luật trong
     * createForOrder()/createWithProvider() (chỉ ĐỌC để popup KDS đánh dấu
     * trước; đường tạo thật vẫn chạy nguyên 2 hàm đó, không đổi hành vi).
     * Trả null khi không hãng nào khả dụng.
     */
    public function resolveProviderCode(Order $order): ?string
    {
        // Thu hộ hiệu dụng: sau prepareBookingData, đơn chưa trả luôn có
        // delivery_cod_amount = tổng đơn — hai dạng dưới tương đương sau bước
        // chuẩn bị, và dạng gộp này cũng đúng khi báo phí TRƯỚC lúc chuẩn bị.
        if ((float) ($order->delivery_cod_amount ?? 0) > 0 || $order->payment_status !== 'paid') {
            $aha = $this->provider('ahamove');
            return ($this->isProviderEnabled('ahamove') && $aha && $aha->isConfigured())
                ? 'ahamove' : null;
        }
        $code = $order->delivery_provider ?: $this->primaryProvider();
        if (!$this->isProviderEnabled($code) || !$this->provider($code)?->isConfigured()) {
            $code = $this->primaryProvider();
        }
        if (!$this->isProviderEnabled($code)) {
            $code = $code === 'ahamove' ? 'lalamove' : 'ahamove';
        }
        $provider = $this->provider($code);
        if (!$provider || !$this->isProviderEnabled($code) || !$provider->isConfigured()) {
            return null;
        }
        return $code;
    }

    /**
     * Báo phí THEO ĐƠN cho popup Đặt Giao Hàng ở KDS (spec mục 6b): server tự
     * dựng tham số từ đơn (điểm giao = tọa độ ghim trên đơn, không geocode
     * lại) → phí thật tại thời điểm gọi của từng hãng khả dụng. Đơn thu hộ
     * chỉ chào AhaMove (luật createForOrder). Phần quán chịu =
     * max(0, phí hãng sẽ dùng − phí khách đã trả); trần đọc từ setting
     * delivery_failover_max_diff.
     */
    public function quoteForOrder(Order $order): array
    {
        $quote = $this->quote($this->quoteParams($order));
        $isCod = (float) ($order->delivery_cod_amount ?? 0) > 0
            || ($order->payment_status !== 'paid' && (float) $order->total_amount > 0);
        $providers = [];
        foreach ($quote['providers'] as $code => $p) {
            if ($isCod && $code !== 'ahamove') continue; // thu hộ: không chào Lalamove
            // Chọn phí gói: khớp mã gói trên đơn (mặc định 'nhanh') như failover,
            // không có gói khớp thì lấy gói đầu tiên hãng trả về
            $fee = null;
            if (!empty($p['packages'])) {
                foreach ($p['packages'] as $pkg) {
                    if (($pkg['code'] ?? null) === ($order->delivery_package ?? 'nhanh')) { $fee = (int) $pkg['fee']; break; }
                }
                $fee = $fee ?? (int) ($p['packages'][0]['fee'] ?? 0);
            }
            $providers[$code] = [
                'label' => $p['label'],
                'available' => (bool) ($p['success'] && $fee !== null),
                'fee' => $fee,
                'distance_km' => $p['distance_km'] ?? null,
                'error' => $p['success'] ? null : ($p['error'] ?? 'Không lấy được phí'),
            ];
        }
        // Hãng tắt/chưa cấu hình không xuất hiện trong quote() — bổ sung trạng
        // thái "không khả dụng" tường minh để popup không bịa số
        foreach ($this->providers() as $code => $provider) {
            if ($isCod && $code !== 'ahamove') continue;
            if (!isset($providers[$code])) {
                $providers[$code] = [
                    'label' => $provider->label(),
                    'available' => false,
                    'fee' => null,
                    'distance_km' => null,
                    'error' => !$this->isProviderEnabled($code) ? 'Hãng đang tắt trong cài đặt'
                        : (!$provider->isConfigured() ? 'Hãng chưa cấu hình' : 'Không lấy được phí'),
                ];
            }
        }

        $willUse = $this->resolveProviderCode($order);
        $chosenFee = ($willUse && ($providers[$willUse]['available'] ?? false))
            ? $providers[$willUse]['fee'] : null;
        $customerFee = (int) round((float) ($order->shipping_fee ?? 0));
        $shopShare = $chosenFee !== null ? max(0, $chosenFee - $customerFee) : null;
        $cap = $this->failoverMaxDiff();
        $branch = $order->branch;

        return [
            'providers' => $providers,
            'will_use' => $willUse,
            'chosen_fee' => $chosenFee,
            'customer_fee' => $customerFee,
            'shop_share' => $shopShare,
            'cap' => $cap,
            'over_cap' => $shopShare !== null && $shopShare > $cap,
            'is_cod' => $isCod,
            'has_pin' => $order->delivery_dropoff_lat !== null && $order->delivery_dropoff_lng !== null,
            'address' => $order->delivery_address,
            'pin_lat' => $order->delivery_dropoff_lat !== null ? (float) $order->delivery_dropoff_lat : null,
            'pin_lng' => $order->delivery_dropoff_lng !== null ? (float) $order->delivery_dropoff_lng : null,
            'distance_km' => $order->distance_km !== null ? (float) $order->distance_km : null,
            'pickup_lat' => $branch?->latitude !== null ? (float) $branch->latitude : null,
            'pickup_lng' => $branch?->longitude !== null ? (float) $branch->longitude : null,
            'failover_timeout_minutes' => $this->failoverTimeoutMinutes(),
        ];
    }

    /**
     * Mốc ĐÃ THU cho đơn thu hộ chưa trả — dùng chung cho webhook CIA của
     * AhaMove (tài xế lấy hàng + ứng tiền) và bước tay "Tài Xế Đang Giao
     * Hàng" (spec mục 8 C1). Cả hai đều qua ĐIỂM XÁC NHẬN CHUNG
     * OnlinePaymentConfirmer — đúng 1 lần: điều kiện ở đây + chốt chặn
     * stock_deducted bên trong điểm xác nhận. Lỗi chỉ ghi log, không ném ra
     * (trạng thái giao hàng vẫn phải tiến lên).
     */
    public function confirmCollectionOnPickup(Order $order): void
    {
        if ((float) ($order->delivery_cod_amount ?? 0) <= 0
            || $order->payment_status === 'paid'
            || $order->stock_deducted) {
            return;
        }
        try {
            app(\App\Services\OnlinePaymentConfirmer::class)->confirm($order->fresh());
            Log::info('[Delivery] Đã xác nhận thu hộ tại mốc lấy hàng', ['order' => $order->code]);
        } catch (\Throwable $e) {
            Log::warning('[Delivery] Xác nhận thu hộ tại mốc lấy hàng thất bại', [
                'order' => $order->code, 'msg' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Spec mục 2: giao thành công (webhook hãng hay nút tay) → đơn lật
     * ready → completed + completed_at (đúng ngữ nghĩa hoàn tất của
     * updateStatus). ĐÚNG 1 chỗ dùng chung cho cả 2 chế độ.
     */
    public function completeIfDelivered(Order $order): void
    {
        if ($order->delivery_status === self::ST_DELIVERED && $order->status === 'ready') {
            $order->update([
                'status' => 'completed',
                'completed_at' => $order->completed_at ?: now(),
            ]);
        }
    }

    // ---- Tạo đơn hãng cho đơn nội bộ ----
    // Gói 61b: ưu tiên hãng khách đã chọn ở checkout ($order->delivery_provider),
    // fallback về hãng chính nếu hãng đó bị tắt/chưa cấu hình.
    public function createForOrder(Order $order, array $params = []): array
    {
        // Spec phí giao một nguồn mục 5.3 + 5.5: đơn THU HỘ chưa thu
        // (delivery_cod_amount > 0) CHỈ tạo đơn qua AhaMove — Lalamove chưa
        // có kiểm chứng COD cho VN nên không được chào cho các đơn này, và
        // cấm trượt hãng dự phòng khi AhaMove chưa sẵn sàng (lỗi hiện ở
        // log/retry Admin, đơn giữ chờ thu).
        if ((float) ($order->delivery_cod_amount ?? 0) > 0) {
            $aha = $this->provider('ahamove');
            if (!$this->isProviderEnabled('ahamove') || !$aha || !$aha->isConfigured()) {
                DeliveryLog::create([
                    'order_id' => $order->id, 'provider' => 'system',
                    'event' => 'create.skipped',
                    'payload' => ['reason' => 'cod_requires_ahamove'],
                ]);
                return ['success' => false, 'error' => 'Đơn thu hộ (COD) chỉ giao qua AhaMove — hãng chưa sẵn sàng.'];
            }
            $code = 'ahamove';
            return $this->createWithProvider($order, $params, $code);
        }
        $code = $order->delivery_provider ?: $this->primaryProvider();
        return $this->createWithProvider($order, $params, $code);
    }

    /** Tạo đơn với 1 hãng đã chốt (thân cũ của createForOrder). */
    private function createWithProvider(Order $order, array $params, string $code): array
    {
        if (!$this->isProviderEnabled($code) || !$this->provider($code)?->isConfigured()) {
            $code = $this->primaryProvider();
        }
        if (!$this->isProviderEnabled($code)) {
            // Hãng chính bị tắt: thử hãng còn lại
            $code = $code === 'ahamove' ? 'lalamove' : 'ahamove';
        }
        $provider = $this->provider($code);
        if (!$provider || !$this->isProviderEnabled($code) || !$provider->isConfigured()) {
            DeliveryLog::create([
                'order_id' => $order->id, 'provider' => 'system',
                'event' => 'create.skipped',
                'payload' => ['reason' => 'no_provider_available'],
            ]);
            return ['success' => false, 'error' => 'Chưa có hãng giao hàng khả dụng'];
        }

        $result = $provider->createOrder($order, $params);
        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => $code,
            'provider_order_id' => $result['provider_order_id'] ?? null,
            'event' => $result['success'] ? 'create.ok' : 'create.failed',
            'payload' => ['error' => $result['error'] ?? null],
        ]);

        if ($result['success']) {
            $order->update([
                'delivery_provider' => $code,
                'delivery_order_id' => $result['provider_order_id'],
                'delivery_tracking_url' => $result['tracking_url'],
                'delivery_status' => self::ST_SEARCHING,
                'delivery_searching_since' => now(),
                'delivery_fee' => $result['fee'] ?? $order->delivery_quoted_fee,
            ]);
        }
        return $result;
        return $result;
    }

    /** Thử tạo lại đơn hãng cho đơn đang chờ xử lý (nút "thử lại" trên Admin). */
    public function retryCreate(Order $order, array $params = []): array
    {
        if ($order->delivery_order_id) {
            return ['success' => false, 'error' => 'Đơn đã có mã hãng, không cần tạo lại'];
        }
        return $this->createForOrder($order, $params);
    }

    // ---- Ánh xạ trạng thái webhook → trạng thái nội bộ ----
    private function statusMap(string $provider, string $raw): ?string
    {
        $raw = strtolower(trim($raw));
        $maps = [
            'ahamove' => [
                'idle' => self::ST_SEARCHING, 'assigning' => self::ST_SEARCHING,
                'accepted' => self::ST_ASSIGNED, 'in_process' => self::ST_ASSIGNED,
                'picked_up' => self::ST_PICKED_UP, 'pickup' => self::ST_PICKED_UP,
                'delivering' => self::ST_DELIVERING, 'on_the_way' => self::ST_DELIVERING,
                'completed' => self::ST_DELIVERED, 'delivered' => self::ST_DELIVERED,
                'cancelled' => self::ST_CANCELLED, 'cancel' => self::ST_CANCELLED,
                'failed' => self::ST_FAILED, 'fail' => self::ST_FAILED,
            ],
            'lalamove' => [
                'assigning_driver' => self::ST_SEARCHING, 'on_going' => self::ST_SEARCHING,
                'picked_up' => self::ST_PICKED_UP,
                'delivering' => self::ST_DELIVERING, 'on_delivery' => self::ST_DELIVERING,
                'completed' => self::ST_DELIVERED,
                'canceled' => self::ST_CANCELLED, 'cancelled' => self::ST_CANCELLED,
                'expired' => self::ST_FAILED, 'failed' => self::ST_FAILED,
            ],
        ];
        // Lalamove: driver assigned có thể đi kèm driver info
        if ($provider === 'lalamove' && in_array($raw, ['accepted', 'driver_assigned'], true)) {
            return self::ST_ASSIGNED;
        }
        return $maps[$provider][$raw] ?? null;
    }

    /**
     * Cập nhật trạng thái đơn từ webhook hãng.
     * - Đơn đã kết thúc (delivered/cancelled/failed): sự kiện cũ đến muộn bị bỏ qua.
     * - Không bao giờ lùi trạng thái (delivered không về delivering).
     */
    public function applyProviderStatus(Order $order, string $provider, string $rawStatus, array $extra = []): void
    {
        $mapped = $this->statusMap($provider, $rawStatus);
        if ($mapped === null) {
            Log::info('[Delivery] unknown provider status', ['provider' => $provider, 'raw' => $rawStatus]);
            return;
        }

        $terminal = [self::ST_DELIVERED, self::ST_CANCELLED, self::ST_FAILED];
        if (in_array($order->delivery_status, $terminal, true)) {
            // Spec KDS book ship mục 2: đơn đã delivered mà chưa lật completed
            // (đơn cũ trước gói này) thì nối mốc hoàn tất ngay tại đây
            $this->completeIfDelivered($order);
            DeliveryLog::create([
                'order_id' => $order->id, 'provider' => $provider,
                'provider_order_id' => $order->delivery_order_id,
                'event' => 'webhook.stale_ignored',
                'payload' => ['raw' => $rawStatus, 'current' => $order->delivery_status],
            ]);
            return; // đơn đã kết thúc: bỏ qua an toàn
        }

        $rank = array_flip([self::ST_SEARCHING, self::ST_ASSIGNED, self::ST_PICKED_UP, self::ST_DELIVERING, self::ST_DELIVERED]);
        $cur = $order->delivery_status;
        if ($cur && isset($rank[$cur], $rank[$mapped]) && $rank[$mapped] < $rank[$cur]
            && !in_array($mapped, $terminal, true)) {
            return; // không lùi trạng thái
        }

        $update = ['delivery_status' => $mapped];
        foreach (['driver_name' => 'delivery_driver_name', 'driver_phone' => 'delivery_driver_phone',
                  'driver_plate' => 'delivery_driver_plate', 'tracking_url' => 'delivery_tracking_url'] as $k => $col) {
            if (!empty($extra[$k])) $update[$col] = $extra[$k];
        }
        // Chốt phí ship + phí COD khi giao thành công
        if ($mapped === self::ST_DELIVERED) {
            $update['delivery_fee'] = $order->delivery_fee ?? $order->delivery_quoted_fee;
        }
        // Phí thu hộ hãng trả về (webhook AhaMove) → cột truy vết đối soát
        if (isset($extra['cod_commission_fee'])) {
            $update['delivery_cod_fee'] = (float) $extra['cod_commission_fee'];
        }
        $order->update($update);

        // Spec phí giao một nguồn mục 5.4 — chế độ CIA (ứng tiền khi lấy
        // hàng): tài xế AhaMove lấy hàng thành công + đã ứng đúng số COD
        // cho quán = mốc "ĐÃ THU" của đơn thu hộ chưa trả. Xác nhận qua
        // ĐIỂM XÁC NHẬN CHUNG (confirmCollectionOnPickup — dùng chung với
        // bước tay ở spec KDS book ship mục 8 C1, đúng 1 lần).
        if ($mapped === self::ST_PICKED_UP && $provider === 'ahamove') {
            $this->confirmCollectionOnPickup($order);
        }

        // Đơn giao thất bại có hàng trả về: đánh dấu cờ để lọc báo cáo,
        // không tính doanh thu (checklist #26). Spec KDS book ship mục 8 C2:
        // ghi thêm dòng log mang lý do (nếu hãng gửi kèm) để thẻ KDS + app
        // khách hiện thống nhất với chế độ tay (event manual.failed).
        if ($mapped === self::ST_FAILED) {
            $order->update([
                'delivery_returned' => true,
                'note' => trim(($order->note ? $order->note . ' | ' : '') . 'Giao thất bại — hàng trả về'),
            ]);
            DeliveryLog::create([
                'order_id' => $order->id, 'provider' => $provider,
                'provider_order_id' => $order->delivery_order_id,
                'event' => 'delivery.failed',
                'payload' => ['reason' => $extra['reason'] ?? $extra['failure_reason'] ?? null],
            ]);
        }

        // Spec KDS book ship mục 2: delivered → lật đơn completed (1 chỗ chung)
        if ($mapped === self::ST_DELIVERED) {
            $this->completeIfDelivered($order->fresh());
        }
    }

    // ---- Failover ----
    /**
     * Quét đơn quá ngưỡng chưa có tài xế → chuyển sang hãng dự phòng.
     * Chạy mỗi phút qua scheduler. Mỗi đơn chỉ failover tối đa 1 lần.
     */
    public function checkFailover(): int
    {
        $timeout = $this->failoverTimeoutMinutes();
        $backup = $this->primaryProvider() === 'ahamove' ? 'lalamove' : 'ahamove';
        if (!$this->isProviderEnabled($backup) || !$this->provider($backup)->isConfigured()) {
            return 0; // không có hãng dự phòng: báo rõ thay vì lỗi ngầm (checklist #28)
        }

        $orders = Order::where('delivery_status', self::ST_SEARCHING)
            ->whereNull('delivery_failover_from')
            ->where('delivery_searching_since', '<=', now()->subMinutes($timeout))
            ->whereNotNull('delivery_order_id')
            ->get();

        $count = 0;
        foreach ($orders as $order) {
            if ($this->failover($order)) $count++;
        }
        return $count;
    }

    /**
     * Failover 1 đơn: hủy hãng cũ → tạo hãng mới → giữ nguyên mã đơn nội bộ.
     * Quán chịu phần chênh trong trần; vượt trần → đánh dấu cần khách xác nhận.
     */
    public function failover(Order $order): bool
    {
        // Spec phí giao một nguồn mục 5.5: đơn THU HỘ chưa thu không được
        // trượt sang Lalamove (chưa có kiểm chứng COD cho VN) — giữ nguyên
        // hãng AhaMove chờ xử lý tay, không hủy đơn hãng hiện tại.
        if ((float) ($order->delivery_cod_amount ?? 0) > 0) {
            return false;
        }
        $from = $order->delivery_provider;
        $to = $from === 'ahamove' ? 'lalamove' : 'ahamove';
        $fromProvider = $this->provider($from);
        $toProvider = $this->provider($to);
        if (!$fromProvider || !$toProvider) return false;

        // 1. Hủy đơn hãng cũ
        $cancel = $fromProvider->cancelOrder($order->delivery_order_id, 'Failover: quá ' . $this->failoverTimeoutMinutes() . ' phút chưa có tài xế');
        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => $from,
            'provider_order_id' => $order->delivery_order_id,
            'event' => 'failover.cancel_old',
            'payload' => ['success' => $cancel['success'], 'cancel_fee' => $cancel['cancel_fee'] ?? 0],
        ]);

        // 2. Báo giá hãng mới để tính chênh
        $quote = $toProvider->estimateFee($this->quoteParams($order));
        $newFee = null;
        if ($quote['success']) {
            foreach ($quote['packages'] as $pkg) {
                if ($pkg['code'] === ($order->delivery_package ?? 'nhanh')) { $newFee = $pkg['fee']; break; }
            }
            $newFee = $newFee ?? ($quote['packages'][0]['fee'] ?? null);
        }

        $oldFee = (int) ($order->delivery_fee ?? $order->delivery_quoted_fee ?? 0);
        $diff = $newFee !== null ? max(0, $newFee - $oldFee) : 0;
        $cap = $this->failoverMaxDiff();

        // Gói 61b: vượt trần → KHÔNG tự tạo đơn hãng mới (khách không thể xác nhận
        // qua cron). Đánh dấu để quán liên hệ khách thủ công: chờ thêm / nhận tại
        // quán / hủy hoàn tiền (nhánh "cả hai hãng không có tài xế" đã chốt).
        if ($diff > $cap) {
            DeliveryLog::create([
                'order_id' => $order->id, 'provider' => $from,
                'provider_order_id' => $order->delivery_order_id,
                'event' => 'failover.over_cap',
                'payload' => ['from' => $from, 'to' => $to, 'old_fee' => $oldFee,
                    'new_fee' => $newFee, 'diff' => $diff, 'cap' => $cap],
            ]);
            $order->update([
                'delivery_status' => self::ST_FAILED,
                'note' => trim(($order->note ? $order->note . ' | ' : '')
                    . "Failover {$from}→{$to} vượt trần chênh {$diff}đ (trần {$cap}đ) — quán liên hệ khách"),
            ]);
            return true;
        }

        // 3. Tạo đơn hãng mới (trong trần: quán chịu chênh, tổng tiền khách không đổi)
        $created = $toProvider->createOrder($order, []);
        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => $to,
            'provider_order_id' => $created['provider_order_id'] ?? null,
            'event' => 'failover.create_new',
            'payload' => [
                'from' => $from, 'old_fee' => $oldFee, 'new_fee' => $newFee,
                'diff' => $diff, 'shop_bears' => $diff,
                'success' => $created['success'], 'error' => $created['error'] ?? null,
            ],
        ]);

        if (!$created['success']) {
            // Cả hai hãng đều không có tài xế → nhánh cuối (checklist #6, #21)
            $order->update(['delivery_status' => self::ST_FAILED]);
            return true;
        }

        $order->update([
            'delivery_provider' => $to,
            'delivery_order_id' => $created['provider_order_id'],
            'delivery_tracking_url' => $created['tracking_url'],
            'delivery_status' => self::ST_SEARCHING,
            'delivery_searching_since' => now(),
            'delivery_fee' => $created['fee'] ?? $newFee ?? $oldFee,
            'delivery_failover_from' => $from,
            'delivery_failover_at' => now(),
            // Tổng tiền khách trả KHÔNG đổi — phần chênh quán chịu (ghi chú để đối soát)
            'note' => trim(($order->note ? $order->note . ' | ' : '')
                . "Failover {$from}→{$to}, chênh {$diff}đ quán chịu"),
        ]);
        return true;
    }

    private function quoteParams(Order $order): array
    {
        $branch = $order->branch;
        return [
            'pickup_lat' => $branch->latitude ?? null,
            'pickup_lng' => $branch->longitude ?? null,
            'pickup_address' => $branch->address ?? '',
            'dropoff_address' => $order->delivery_address ?? '',
            // Gói 61b: dùng tọa độ điểm giao đã lưu lúc đặt đơn (không còn null)
            'dropoff_lat' => $order->delivery_dropoff_lat ?? null,
            'dropoff_lng' => $order->delivery_dropoff_lng ?? null,
            'cod_amount' => (int) ($order->delivery_cod_amount ?? 0),
        ];
    }

    // ---- Báo cáo ----
    public function failoverStats(string $from, string $to, ?int $branchId = null): array
    {
        $q = DeliveryLog::where('event', 'failover.create_new')
            ->where('created_at', '>=', $from)->where('created_at', '<=', $to);
        if ($branchId) {
            $q->whereHas('order', fn($qq) => $qq->where('branch_id', $branchId));
        }
        $logs = $q->get();
        $totalDiff = $logs->sum(fn($l) => (int) ($l->payload['diff'] ?? 0));
        return [
            'failover_count' => $logs->count(),
            'total_diff_shop_bears' => $totalDiff,
            'by_provider' => $logs->groupBy('provider')->map->count(),
        ];
    }
}
