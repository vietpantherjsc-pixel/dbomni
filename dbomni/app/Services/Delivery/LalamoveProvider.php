<?php

namespace App\Services\Delivery;

use App\Models\DeliveryLog;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

// Gói 60 (2026-10-17): Adapter Lalamove — hãng dự phòng (failover).
// Tài liệu: developers.lalamove.com — REST v2, xác thực HMAC-SHA256.
class LalamoveProvider implements DeliveryProvider
{
    public function code(): string { return 'lalamove'; }
    public function label(): string { return 'Lalamove'; }

    private function baseUrl(): string
    {
        return rtrim(config('delivery.lalamove.base_url', 'https://rest.sandbox.lalamove.com'), '/');
    }

    private function apiKey(): ?string
    {
        return config('delivery.lalamove.api_key') ?: null;
    }

    private function apiSecret(): ?string
    {
        return config('delivery.lalamove.api_secret') ?: null;
    }

    private function market(): string
    {
        return config('delivery.lalamove.market', 'VN');
    }

    public function isConfigured(): bool
    {
        return !empty($this->apiKey()) && !empty($this->apiSecret());
    }

    /**
     * Ký request theo chuẩn Lalamove: HMAC-SHA256(method + timestamp + path + body).
     */
    private function signedHeaders(string $method, string $path, string $body = ''): array
    {
        $timestamp = (string) (int) (microtime(true) * 1000);
        $raw = strtoupper($method) . "\n" . $timestamp . "\n" . $path . "\n" . $body;
        $signature = hash_hmac('sha256', $raw, $this->apiSecret() ?? '');
        return [
            'Authorization' => 'hmac ' . $this->apiKey() . ':' . $timestamp . ':' . $signature,
            'Market' => $this->market(),
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ];
    }

    private function call(string $method, string $path, array $body = []): \Illuminate\Http\Client\Response
    {
        $json = $body ? json_encode($body, JSON_UNESCAPED_UNICODE) : '';
        return Http::timeout(5)->withHeaders($this->signedHeaders($method, $path, $json))
            ->send($method, $this->baseUrl() . $path, $json ? ['body' => $json] : []);
    }

    public function estimateFee(array $params): array
    {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Chưa cấu hình API key Lalamove'];
        }
        try {
            $body = [
                'serviceType' => 'MOTORCYCLE',
                'stops' => [
                    [
                        'coordinates' => ['lat' => (string) ($params['pickup_lat'] ?? ''), 'lng' => (string) ($params['pickup_lng'] ?? '')],
                        'address' => $params['pickup_address'] ?? '',
                    ],
                    [
                        'coordinates' => ['lat' => (string) ($params['dropoff_lat'] ?? ''), 'lng' => (string) ($params['dropoff_lng'] ?? '')],
                        'address' => $params['dropoff_address'] ?? '',
                    ],
                ],
            ];
            $res = $this->call('POST', '/v2/quotations', $body);
            if (!$res->successful()) {
                return ['success' => false, 'error' => 'Lalamove báo giá lỗi (HTTP ' . $res->status() . ')'];
            }
            $data = $res->json('data') ?? [];
            $fee = (int) round((float) ($data['priceBreakdown']['total'] ?? 0));
            $distanceM = (float) ($data['distance']['value'] ?? 0);
            return [
                'success' => $fee > 0,
                'distance_km' => $distanceM > 0 ? round($distanceM / 1000, 1) : null,
                // Lalamove quotation thường trả 1 mức xe máy; suy gói Siêu Tốc theo tỉ lệ
                'packages' => $fee > 0 ? [
                    ['code' => 'nhanh', 'name' => 'Nhanh (~90 phút)', 'fee' => $fee, 'eta_text' => '~90 phút'],
                    ['code' => 'sieu_toc', 'name' => 'Siêu Tốc (≤60 phút)', 'fee' => (int) round($fee * 1.25), 'eta_text' => '≤60 phút'],
                ] : [],
                'error' => $fee > 0 ? null : 'Lalamove không báo được giá cho địa chỉ này',
            ];
        } catch (\Throwable $e) {
            Log::warning('[Lalamove] estimateFee exception', ['msg' => $e->getMessage()]);
            return ['success' => false, 'error' => 'Không kết nối được Lalamove'];
        }
    }

    public function createOrder(Order $order, array $params): array
    {
        if (!$this->isConfigured()) {
            return ['success' => false, 'error' => 'Chưa cấu hình API key Lalamove'];
        }
        try {
            $branch = $order->branch;
            $cod = (int) ($order->delivery_cod_amount ?? 0);
            $body = [
                'serviceType' => 'MOTORCYCLE',
                'specialRequests' => [],
                'stops' => [
                    [
                        'coordinates' => ['lat' => (string) ($branch->latitude ?? ''), 'lng' => (string) ($branch->longitude ?? '')],
                        'address' => $branch->address ?? '',
                        'name' => $branch->name ?? '',
                        'phone' => $branch->phone ?? '',
                    ],
                    [
                        'coordinates' => ['lat' => (string) ($params['dropoff_lat'] ?? ''), 'lng' => (string) ($params['dropoff_lng'] ?? '')],
                        'address' => $order->delivery_address ?? '',
                        'name' => $order->customer_name ?? '',
                        'phone' => $order->customer_phone ?? '',
                    ],
                ],
                'requesterContact' => [
                    'name' => $branch->name ?? '',
                    'phone' => $branch->phone ?? '',
                ],
                'deliveries' => [
                    [
                        'toStop' => 1,
                        'toContact' => ['name' => $order->customer_name ?? '', 'phone' => $order->customer_phone ?? ''],
                        'remarks' => $order->delivery_note ?? '',
                    ],
                ],
                'isPODRequired' => false,
                'partner' => 'DBOMNI',
            ];
            if ($cod > 0) {
                $body['cod'] = ['amount' => (string) $cod, 'currency' => 'VND'];
            }
            $res = $this->call('POST', '/v2/orders', $body);
            $data = $res->json('data') ?? [];
            if (!$res->successful() || empty($data['orderId'])) {
                return ['success' => false, 'error' => $res->json('message') ?? 'Lalamove tạo đơn lỗi (HTTP ' . $res->status() . ')', 'raw' => $res->json()];
            }
            return [
                'success' => true,
                'provider_order_id' => (string) $data['orderId'],
                'tracking_url' => $data['shareLink'] ?? null,
                'fee' => isset($data['priceBreakdown']['total']) ? (int) round((float) $data['priceBreakdown']['total']) : null,
                'error' => null,
                'raw' => $data,
            ];
        } catch (\Throwable $e) {
            Log::warning('[Lalamove] createOrder exception', ['order' => $order->code, 'msg' => $e->getMessage()]);
            return ['success' => false, 'error' => 'Không kết nối được Lalamove'];
        }
    }

    public function cancelOrder(string $providerOrderId, ?string $reason = null): array
    {
        try {
            $res = $this->call('DELETE', '/v2/orders/' . $providerOrderId);
            return [
                'success' => $res->successful(),
                'cancel_fee' => 0,
                'error' => $res->successful() ? null : ($res->json('message') ?? 'Hủy đơn Lalamove lỗi'),
            ];
        } catch (\Throwable $e) {
            return ['success' => false, 'cancel_fee' => 0, 'error' => 'Không kết nối được Lalamove'];
        }
    }

    public function handleWebhook(Request $request): void
    {
        // Verify HMAC-SHA256 theo chuẩn Lalamove.
        // FAIL-CLOSED: chưa cấu hình secret → từ chối mọi webhook (chống giả mạo).
        $signature = $request->header('X-Lalamove-Signature', '');
        $secret = config('delivery.lalamove.webhook_secret', $this->apiSecret() ?? '');
        if ($secret === '') {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'lalamove',
                'provider_order_id' => $request->input('data.orderId'),
                'event' => 'webhook.rejected',
                'payload' => ['reason' => 'no_secret_configured', 'ip' => $request->ip()],
            ]);
            abort(401, 'Chưa cấu hình webhook secret');
        }
        $expected = hash_hmac('sha256', $request->getContent(), $secret);
        if (!hash_equals($expected, $signature)) {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'lalamove',
                'provider_order_id' => $request->input('data.orderId'),
                'event' => 'webhook.rejected',
                'payload' => ['reason' => 'bad_signature', 'ip' => $request->ip()],
            ]);
            abort(401, 'Chữ ký webhook không hợp lệ');
        }

        $payload = $request->all();
        $data = $payload['data'] ?? [];
        $providerOrderId = $data['orderId'] ?? null;
        $status = strtolower($data['status'] ?? '');
        if (!$providerOrderId) {
            abort(400, 'Thiếu orderId');
        }

        $eventId = $payload['eventId'] ?? ($providerOrderId . ':' . $status);
        $dup = DeliveryLog::where('provider', 'lalamove')
            ->where('provider_order_id', $providerOrderId)
            ->where('event', 'webhook.' . $eventId)
            ->exists();
        if ($dup) {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'lalamove',
                'provider_order_id' => $providerOrderId,
                'event' => 'webhook.duplicate',
                'payload' => ['event_id' => $eventId, 'note' => 'đã xử lý'],
            ]);
            return;
        }

        $order = Order::where('delivery_order_id', $providerOrderId)
            ->where('delivery_provider', 'lalamove')
            ->first();
        if (!$order) {
            DeliveryLog::create([
                'order_id' => null, 'provider' => 'lalamove',
                'provider_order_id' => $providerOrderId,
                'event' => 'webhook.orphan',
                'payload' => $payload,
            ]);
            return;
        }

        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => 'lalamove',
            'provider_order_id' => $providerOrderId,
            'event' => 'webhook.' . $eventId,
            'payload' => $payload,
        ]);

        $driver = $data['driver'] ?? [];
        app(DeliveryService::class)->applyProviderStatus($order, 'lalamove', $status, [
            'driver_name' => $driver['name'] ?? null,
            'driver_phone' => $driver['phone'] ?? null,
            'driver_plate' => $driver['plateNumber'] ?? $driver['plate'] ?? null,
            'tracking_url' => $data['shareLink'] ?? null,
        ]);
    }
}
