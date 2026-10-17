<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\DeliveryLog;
use App\Models\Order;
use App\Services\Delivery\DeliveryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 60 (2026-10-17): API giao hàng.
// - Public (Mini App checkout): POST /api/online/delivery/quote
// - Admin: retry tạo đơn hãng, xem log, báo cáo failover
class DeliveryController extends Controller
{
    /**
     * Báo giá live từ hai hãng cho checkout Mini App.
     * Không cần auth (giá công khai), nhưng rate-limit ở route.
     */
    public function quote(Request $request, DeliveryService $service): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'dropoff_address' => 'required|string|max:500',
            'dropoff_lat' => 'nullable|numeric|between:-90,90',
            'dropoff_lng' => 'nullable|numeric|between:-180,180',
            'subtotal' => 'required|numeric|min:0',
            'cod_amount' => 'nullable|numeric|min:0',
        ]);

        $branch = Branch::find($validated['branch_id']);
        if (empty($branch->latitude) || empty($branch->longitude)) {
            return response()->json([
                'success' => false,
                'message' => 'Chi nhánh chưa cấu hình tọa độ — quán sẽ xác nhận phí ship qua điện thoại.',
            ], 422);
        }

        $result = $service->quote([
            'pickup_lat' => (float) $branch->latitude,
            'pickup_lng' => (float) $branch->longitude,
            'pickup_address' => $branch->address ?? $branch->name,
            'dropoff_lat' => isset($validated['dropoff_lat']) ? (float) $validated['dropoff_lat'] : null,
            'dropoff_lng' => isset($validated['dropoff_lng']) ? (float) $validated['dropoff_lng'] : null,
            'dropoff_address' => $validated['dropoff_address'],
            'cod_amount' => (int) ($validated['cod_amount'] ?? 0),
        ]);

        if (!$result['success']) {
            return response()->json(['success' => false, 'message' => $result['error']], 422);
        }

        // Gộp gói 2 hãng → chọn gói mặc định "nhanh" rẻ nhất
        $packages = [];
        foreach ($result['providers'] as $code => $p) {
            foreach ($p['packages'] as $pkg) {
                $packages[] = array_merge($pkg, ['provider' => $code, 'provider_label' => $p['label']]);
            }
        }
        $subtotal = (int) $validated['subtotal'];
        foreach ($packages as &$pkg) {
            $support = $service->applySupport($subtotal, $pkg['fee']);
            $pkg['shop_support'] = $support['support'];
            $pkg['customer_pays'] = $support['charged'];
        }
        unset($pkg);

        return response()->json([
            'success' => true,
            'data' => [
                'packages' => $packages,
                'default_package' => 'nhanh',
                'support_threshold' => $service->supportThreshold(),
                'support_amount' => $service->supportAmount(),
                // Phí khóa tại thời điểm chốt đơn — frontend gửi lại package đã chọn
                'quote_expires_note' => 'Giá được khóa khi bấm đặt đơn',
            ],
        ]);
    }

    /** Admin thử tạo lại đơn hãng cho đơn đang chờ xử lý (checklist #11). */
    public function retry(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        if ($order->order_type !== 'delivery') {
            return response()->json(['success' => false, 'message' => 'Chỉ áp dụng cho đơn giao hàng'], 422);
        }
        $result = $service->retryCreate($order, [
            'dropoff_lat' => $request->input('dropoff_lat'),
            'dropoff_lng' => $request->input('dropoff_lng'),
        ]);
        return response()->json($result, $result['success'] ? 200 : 422);
    }

    /** Lịch sử giao hàng của 1 đơn (webhook log + failover). */
    public function logs(Order $order): JsonResponse
    {
        $logs = DeliveryLog::where('order_id', $order->id)
            ->orderBy('created_at')
            ->get(['id', 'provider', 'provider_order_id', 'event', 'created_at']);
        return response()->json(['success' => true, 'data' => $logs]);
    }

    /** Báo cáo failover theo ngày/chi nhánh (checklist #22). */
    public function failoverReport(Request $request, DeliveryService $service): JsonResponse
    {
        $validated = $request->validate([
            'from' => 'required|date',
            'to' => 'required|date|after_or_equal:from',
            'branch_id' => 'nullable|exists:branches,id',
        ]);
        return response()->json([
            'success' => true,
            'data' => $service->failoverStats(
                $validated['from'] . ' 00:00:00',
                $validated['to'] . ' 23:59:59',
                $validated['branch_id'] ?? null
            ),
        ]);
    }

    /** Cấu hình giao hàng hiện tại (cho trang Thiết lập + checkout). */
    public function config(DeliveryService $service): JsonResponse
    {
        $providers = [];
        foreach ($service->providers() as $code => $p) {
            $providers[$code] = [
                'label' => $p->label(),
                'enabled' => $service->isProviderEnabled($code),
                'configured' => $p->isConfigured(),
            ];
        }
        return response()->json(['success' => true, 'data' => [
            'providers' => $providers,
            'primary' => $service->primaryProvider(),
            'failover_timeout_minutes' => $service->failoverTimeoutMinutes(),
            'failover_max_diff' => $service->failoverMaxDiff(),
            'support_threshold' => $service->supportThreshold(),
            'support_amount' => $service->supportAmount(),
            'ready' => $service->isConfigured(),
            // Gói 61b: trạng thái webhook secret để cảnh báo đỏ khi chưa cấu hình
            'webhook_secrets' => [
                'ahamove' => !empty(config('delivery.ahamove.webhook_secret')),
                'lalamove' => !empty(config('delivery.lalamove.webhook_secret')),
            ],
        ]]);
    }
}
