<?php

namespace App\Services\Delivery;

use App\Models\Order;
use Illuminate\Http\Request;

// Gói 60 (2026-10-17): Interface chung cho hãng giao hàng.
// Thêm hãng thứ ba sau này chỉ cần implement interface này, không sửa luồng checkout/KDS.
interface DeliveryProvider
{
    /**
     * Báo giá phí ship.
     * $params: ['pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng',
     *           'dropoff_address', 'cod_amount']
     * Trả về: ['success' => bool, 'distance_km' => float|null,
     *          'packages' => [['code' => 'nhanh'|'sieu_toc', 'name' => string,
     *                         'fee' => int, 'eta_text' => string]], 'error' => string|null]
     */
    public function estimateFee(array $params): array;

    /**
     * Tạo đơn phía hãng. Trả về:
     * ['success' => bool, 'provider_order_id' => string|null,
     *  'tracking_url' => string|null, 'fee' => int|null, 'error' => string|null,
     *  'raw' => array]
     */
    public function createOrder(Order $order, array $params): array;

    /**
     * Hủy đơn phía hãng.
     * Trả về: ['success' => bool, 'cancel_fee' => int, 'error' => string|null]
     */
    public function cancelOrder(string $providerOrderId, ?string $reason = null): array;

    /**
     * Xử lý webhook từ hãng: verify chữ ký, idempotent, cập nhật trạng thái đơn.
     * Ném exception khi chữ ký sai (controller chuyển thành 401).
     */
    public function handleWebhook(Request $request): void;

    /** Mã hãng: 'ahamove' | 'lalamove' */
    public function code(): string;

    /** Tên hiển thị: 'AhaMove' | 'Lalamove' */
    public function label(): string;
}
