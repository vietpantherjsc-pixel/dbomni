<?php

namespace App\Services\Delivery;

use App\Models\DeliveryLog;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

// Gói 60 (2026-10-17): Adapter AhaMove — hãng chính.
// Tài liệu: developers.ahamove.com — REST v3, API key → token.
class AhaMoveProvider implements DeliveryProvider
{
    public function code(): string { return 'ahamove'; }
    public function label(): string { return 'AhaMove'; }

    private function baseUrl(): string
    {
        return rtrim(config('delivery.ahamove.base_url', 'https://partner-apistg.ahamove.com/v3'), '/');
    }

    private function apiKey(): ?string
    {
        return config('delivery.ahamove.api_key') ?: null;
    }

    public function isConfigured(): bool
    {
        return !empty($this->apiKey());
    }

    /**
     * Lấy token từ API key (cache 23h). AhaMove dùng token cho mọi call tiếp theo.
     */
    private function token(): ?string
    {
        $key = $this->apiKey();
        if (!$key) return null;
        return cache()->remember('delivery:ahamove:token:' . sha1($key), 23 * 3600, function () use ($key) {
            $res = Http::timeout(5)->post($this->baseUrl() . '/partners/v3/login', [
                'api_key' => $key,
            ]);
            if (!$res->successful()) {
                Log::warning('[AhaMove] login failed', ['status' => $res->status()]);
                return null;
            }
            return $res->json('token');
        });
    }

    private function client()
    {
        $token = $this->token();
        return Http::timeout(5)->withHeaders($token ? ['Authorization' => 'Bearer ' . $token] : []);
    }

    public function estimateFee(array $params): array
    {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Chưa cấu hình API key AhaMove'];
        }
        try {
            $res = $this->client()->post($this->baseUrl() . '/orders/v3/estimated', [
                'pickup_address' => $params['pickup_address'] ?? '',
                'pickup_lat' => $params['pickup_lat'] ?? null,
                'pickup_lng' => $params['pickup_lng'] ?? null,
                'dropoff_address' => $params['dropoff_address'] ?? '',
                'dropoff_lat' => $params['dropoff_lat'] ?? null,
                'dropoff_lng' => $params['dropoff_lng'] ?? null,
                'cod_amount' => (int) ($params['cod_amount'] ?? 0),
            ]);
            if (!$res->successful()) {
                return ['success' => false, 'error' => 'AhaMove báo giá lỗi (HTTP ' . $res->status() . ')'];
            }
            $data = $res->json();
            $packages = [];
            foreach ($data['services'] ?? $data['estimates'] ?? [] as $svc) {
                $packages[] = [
                    'code' => $this->mapServiceCode($svc['service_id'] ?? $svc['code'] ?? ''),
                    'name' => $svc['name'] ?? '',
                    'fee' => (int) ($svc['total_price'] ?? $svc['fee'] ?? 0),
                    'eta_text' => $svc['eta_text'] ?? $svc['duration'] ?? '',
                ];
            }
            // Fallback: nếu API chỉ trả 1 mức giá chung, suy ra 2 gói theo tỉ lệ bảng giá công bố
            if (count($packages) === 1 && $packages[0]['fee'] > 0) {
                $base = $packages[0]['fee'];
                $packages = [
                    ['code' => 'nhanh', 'name' => 'Nhanh (~90 phút)', 'fee' => $base, 'eta_text' => '~90 phút'],
                    ['code' => 'sieu_toc', 'name' => 'Siêu Tốc (≤60 phút)', 'fee' => (int) round($base * 1.25), 'eta_text' => '≤60 phút'],
                ];
            }
            return [
                'success' => true,
                'distance_km' => isset($data['distance']) ? round((float) $data['distance'], 1) : null,
                'packages' => array_values(array_filter($packages, fn($p) => $p['fee'] > 0)),
                'error' => null,
            ];
        } catch (\Throwable $e) {
            Log::warning('[AhaMove] estimateFee exception', ['msg' => $e->getMessage()]);
            return ['success' => false, 'error' => 'Không kết nối được AhaMove'];
        }
    }

    private function mapServiceCode(string $svc): string
    {
        $s = strtolower($svc);
        if (str_contains($s, 'super') || str_contains($s, 'express') || str_contains($s, 'sieu')) {
            return 'sieu_toc';
        }
        return 'nhanh';
    }

    public function createOrder(Order $order, array $params): array
    {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Chưa cấu hình API key AhaMove'];
        }
        try {
            $branch = $order->branch;
            $payload = [
                'pickup_address' => $branch->address ?? '',
                'pickup_lat' => $branch->latitude ?? null,
                'pickup_lng' => $branch->longitude ?? null,
                'pickup_phone' => $branch->phone ?? '',
                'dropoff_address' => $order->delivery_address ?? '',
                'dropoff_lat' => $params['dropoff_lat'] ?? null,
                'dropoff_lng' => $params['dropoff_lng'] ?? null,
                'receiver_name' => $order->customer_name ?? '',
                'receiver_phone' => $order->customer_phone ?? '',
                'cod_amount' => (int) ($order->delivery_cod_amount ?? 0),
                'notes' => $order->delivery_note ?? '',
                'service_id' => ($order->delivery_package === 'sieu_toc') ? 'SUPER' : 'STANDARD',
                'order_id' => $order->code, // mã tham chiếu nội bộ
            ];
            $res = $this->client()->post($this->baseUrl() . '/orders/v3/create', $payload);
            $data = $res->json();
            if (!$res->successful() || empty($data['order_id'])) {
                return ['success' => false, 'error' => $data['message'] ?? 'AhaMove tạo đơn lỗi (HTTP ' . $res->status() . ')', 'raw' => $data];
            }
            return [
                'success' => true,
                'provider_order_id' => (string) $data['order_id'],
                'tracking_url' => $data['tracking_url'] ?? $data['share_url'] ?? null,
                'fee' => isset($data['total_price']) ? (int) $data['total_price'] : null,
                'error' => null,
                'raw' => $data,
            ];
        } catch (\Throwable $e) {
            Log::warning('[AhaMove] createOrder exception', ['order' => $order->code, 'msg' => $e->getMessage()]);
            return ['success' => false, 'error' => 'Không kết nối được AhaMove'];
        }
    }

    public function cancelOrder(string $providerOrderId, ?string $reason = null): array
    {
        try {
            $res = $this->client()->post($this->baseUrl() . '/orders/v3/' . $providerOrderId . '/cancel', [
                'reason' => $reason ?? 'Khách hủy',
            ]);
            $data = $res->json();
            return [
                'success' => $res->successful(),
                'cancel_fee' => (int) ($data['cancel_fee'] ?? 0),
                'error' => $res->successful() ? null : ($data['message'] ?? 'Hủy đơn AhaMove lỗi'),
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'cancel_fee' => 0, 'error' => 'Không kết nối được AhaMove'];
        }
    }

    public function handleWebhook(Request $request): void
    {
        // Verify chữ ký: AhaMove ký payload bằng token/callback secret.
        // FAIL-CLOSED: chưa cấu hình secret → từ chối mọi webhook (chống giả mạo).
        $signature = $request->header('X-Ahamove-Signature', '');
        $secret = config('delivery.ahamove.webhook_secret', '');
        if ($secret === '') {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'ahamove',
                'provider_order_id' => $request->input('order_id'),
                'event' => 'webhook.rejected',
                'payload' => ['reason' => 'no_secret_configured', 'ip' => $request->ip()],
            ]);
            abort(401, 'Chưa cấu hình webhook secret');
        }
        $expected = hash_hmac('sha256', $request->getContent(), $secret);
        if (!hash_equals($expected, $signature)) {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'ahamove',
                'provider_order_id' => $request->input('order_id'),
                'event' => 'webhook.rejected',
                'payload' => ['reason' => 'bad_signature', 'ip' => $request->ip()],
            ]);
            abort(401, 'Chữ ký webhook không hợp lệ');
        }

        $payload = $request->all();
        $providerOrderId = $payload['order_id'] ?? $payload['id'] ?? null;
        $status = strtolower($payload['status'] ?? '');
        if (!$providerOrderId) {
            abort(400, 'Thiếu order_id');
        }

        $eventId = $payload['event_id'] ?? ($providerOrderId . ':' . $status);
        // Idempotent: payload trùng chỉ xử lý 1 lần
        $dup = DeliveryLog::where('provider', 'ahamove')
            ->where('provider_order_id', $providerOrderId)
            ->where('event', 'webhook.' . $eventId)
            ->exists();
        if ($dup) {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'ahamove',
                'provider_order_id' => $providerOrderId,
                'event' => 'webhook.duplicate',
                'payload' => ['event_id' => $eventId, 'note' => 'đã xử lý'],
            ]);
            return;
        }

        $order = Order::where('delivery_order_id', $providerOrderId)
            ->where('delivery_provider', 'ahamove')
            ->first();
        if (!$order) {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'ahamove',
                'provider_order_id' => $providerOrderId,
                'event' => 'webhook.orphan',
                'payload' => $payload,
            ]);
            return;
        }

        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => 'ahamove',
            'provider_order_id' => $providerOrderId,
            'event' => 'webhook.' . $eventId,
            'payload' => $payload,
        ]);

        app(DeliveryService::class)->applyProviderStatus($order, 'ahamove', $status, [
            'driver_name' => $payload['driver_name'] ?? $payload['driver']['name'] ?? null,
            'driver_phone' => $payload['driver_phone'] ?? $payload['driver']['phone'] ?? null,
            'driver_plate' => $payload['driver_plate'] ?? $payload['driver']['plate'] ?? null,
            'tracking_url' => $payload['tracking_url'] ?? $payload['share_url'] ?? null,
        ]);
    }
}
