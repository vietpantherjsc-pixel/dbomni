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
// - Spec KDS book ship (2026-11-06): thao tác đặt ship tại KDS (báo phí theo
//   đơn · đặt hãng · hủy tìm/chuyển tay · chế độ tay · đính chính ghim)
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
        // Spec KDS book ship mục 1 (quyết phụ BA): chỉ cho tạo khi đơn ĐÃ LÀM
        // XONG — không còn đường vòng đặt ship trước khi món xong
        if ($order->status !== 'ready') {
            return response()->json(['success' => false, 'message' => 'Chỉ tạo đơn hãng khi đơn đã làm xong (đang ở cột Chờ Giao).'], 422);
        }
        $service->prepareBookingData($order);
        $result = $service->retryCreate($order->fresh(), [
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

    // ============================================================
    // Spec KDS book ship (2026-11-06): thao tác đặt ship tại KDS.
    // Mọi thao tác giao hàng chỉ mở khi đơn ở trạng thái ready (đã làm xong);
    // kiểm chi nhánh theo đúng mẫu denyOrderBranch của OrderController.
    // ============================================================

    /** Kiểm CN phân công — mirror OrderController::denyOrderBranch. */
    private function denyBranch(Request $request, $branchId): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Đơn hàng không thuộc chi nhánh bạn được phân công.'], 403);
        }
        return null;
    }

    /** Cổng chung: đơn giao hàng + đúng CN + đã làm xong (ready). */
    private function guardKdsOrder(Request $request, Order $order): ?JsonResponse
    {
        if ($order->order_type !== 'delivery') {
            return response()->json(['success' => false, 'message' => 'Chỉ áp dụng cho đơn giao hàng.'], 422);
        }
        if ($deny = $this->denyBranch($request, $order->branch_id)) return $deny;
        if ($order->status !== 'ready') {
            return response()->json(['success' => false, 'message' => 'Thao tác giao hàng chỉ mở khi đơn đã làm xong (cột Chờ Giao).'], 422);
        }
        return null;
    }

    /** Nhãn người thao tác để ghi delivery_logs. */
    private function actorMeta(Request $request): array
    {
        $actor = $request->user();
        return [
            'by' => $actor instanceof \App\Models\Employee
                ? ($actor->full_name ?: ('NV#' . $actor->id))
                : ($actor->name ?? ('Admin#' . ($actor->id ?? ''))),
            'by_id' => $actor->id ?? null,
            'by_type' => $actor instanceof \App\Models\Employee ? 'employee' : 'user',
        ];
    }

    /** Đơn còn phiên hãng đang chạy (chưa kết thúc) hay không — chốt C3. */
    private function hasActiveCarrierSession(Order $order): bool
    {
        return !empty($order->delivery_order_id)
            && !in_array($order->delivery_status, [DeliveryService::ST_FAILED, DeliveryService::ST_CANCELLED], true);
    }

    /**
     * Báo phí theo đơn cho popup Đặt Giao Hàng (mục 6b) — chỉ ĐỌC, server tự
     * dựng tham số từ đơn (điểm giao = ghim trên đơn, không geocode lại).
     */
    public function quoteForOrder(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        if ($deny = $this->guardKdsOrder($request, $order)) return $deny;
        return response()->json(['success' => true, 'data' => $service->quoteForOrder($order)]);
    }

    /**
     * Đặt Giao Hàng (chế độ hãng) — mục 3.1: tiền điều kiện + chuẩn bị dữ kiện
     * (mục 1) + createForOrder nguyên vẹn. Khóa hàng đơn trong giao dịch để
     * chốt C3 (tối đa 1 phiên tìm tài xế tại một thời điểm) ở phía server.
     */
    public function book(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        if ($deny = $this->guardKdsOrder($request, $order)) return $deny;

        $result = \Illuminate\Support\Facades\DB::transaction(function () use ($order, $service, $request) {
            $locked = Order::lockForUpdate()->findOrFail($order->id);
            if ($this->hasActiveCarrierSession($locked) || $locked->delivery_status === DeliveryService::ST_SEARCHING) {
                return ['ok' => false, 'message' => 'Đơn đang có phiên giao đang chạy — không đặt trùng được.'];
            }
            // Mục 5.3a: không có tọa độ ghim → chặn đặt tự động (chốt hậu sau popup)
            if ($locked->delivery_dropoff_lat === null || $locked->delivery_dropoff_lng === null) {
                return ['ok' => false, 'message' => 'Đơn chưa có tọa độ ghim — hãy đính chính điểm ghim hoặc chọn Quán Tự Đặt Giao Hàng.'];
            }
            $wasManual = $locked->delivery_provider === 'manual';
            $service->prepareBookingData($locked);
            $created = $service->createForOrder($locked->fresh(), []);
            if (!($created['success'] ?? false)) {
                return ['ok' => false, 'message' => $created['error'] ?? 'Không đặt được đơn hãng.'];
            }
            $fresh = $locked->fresh();
            if ($wasManual) {
                // C3: đặt lại hãng sau khi đã chuyển tay — vết đối soát (hộp
                // hỏi xác nhận nằm phía KDS trước khi gọi tới đây)
                DeliveryLog::create([
                    'order_id' => $fresh->id, 'provider' => $fresh->delivery_provider,
                    'provider_order_id' => $fresh->delivery_order_id,
                    'event' => 'book.after_manual',
                    'payload' => $this->actorMeta($request),
                ]);
            }
            // Mục 6b: vượt trần quán chịu → ghi log đối soát cuối ngày
            $fee = (int) round((float) ($fresh->delivery_fee ?? 0));
            $customerFee = (int) round((float) ($fresh->shipping_fee ?? 0));
            $share = max(0, $fee - $customerFee);
            $cap = $service->failoverMaxDiff();
            if ($fee > 0 && $share > $cap) {
                DeliveryLog::create([
                    'order_id' => $fresh->id, 'provider' => $fresh->delivery_provider,
                    'provider_order_id' => $fresh->delivery_order_id,
                    'event' => 'book.over_cap',
                    'payload' => [
                        'carrier_fee' => $fee, 'customer_fee' => $customerFee,
                        'shop_share' => $share, 'cap' => $cap,
                    ] + $this->actorMeta($request),
                ]);
            }
            return ['ok' => true, 'order' => $fresh];
        });

        if (!$result['ok']) {
            return response()->json(['success' => false, 'message' => $result['message']], 422);
        }
        return response()->json(['success' => true, 'message' => 'Đã đặt đơn hãng.', 'data' => $result['order']]);
    }

    /**
     * Hủy phiên tìm tài xế → chuyển ngay sang chế độ tay (mục 4 — dùng cho cả
     * nút Hủy khi đang tìm lẫn nút chuyển tay khi quá ngưỡng 5 phút). Phiên
     * hãng chỉ hủy khi NV thật sự bấm; hủy hãng lỗi → giữ nguyên chế độ hãng
     * (tránh trùng tài xế với ship ngoài NV tự gọi).
     */
    public function toManual(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        if ($deny = $this->guardKdsOrder($request, $order)) return $deny;
        if ($order->delivery_status !== DeliveryService::ST_SEARCHING || empty($order->delivery_order_id)) {
            return response()->json(['success' => false, 'message' => 'Đơn không ở trạng thái đang tìm tài xế.'], 422);
        }
        $provider = $service->provider((string) $order->delivery_provider);
        if ($provider) {
            $cancel = $provider->cancelOrder($order->delivery_order_id, 'NV chuyển Quán Tự Đặt tại KDS');
            DeliveryLog::create([
                'order_id' => $order->id, 'provider' => $order->delivery_provider,
                'provider_order_id' => $order->delivery_order_id,
                'event' => 'book.cancel_search',
                'payload' => ['success' => $cancel['success'] ?? false, 'cancel_fee' => $cancel['cancel_fee'] ?? 0] + $this->actorMeta($request),
            ]);
            if (!($cancel['success'] ?? false)) {
                return response()->json(['success' => false, 'message' => 'Hủy phiên hãng chưa thành công — thử lại trước khi chuyển tay để tránh trùng tài xế.'], 422);
            }
        }
        $this->enterManual($order, $service, $request, ['from_search' => true]);
        return response()->json(['success' => true, 'message' => 'Đã hủy phiên hãng và chuyển sang Quán Tự Đặt.', 'data' => $order->fresh()]);
    }

    /** Bắt đầu chế độ tay từ trạng thái chưa giao (mục 3.2). */
    public function manualStart(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        if ($deny = $this->guardKdsOrder($request, $order)) return $deny;
        if ($order->delivery_provider === 'manual' && empty($order->delivery_status)) {
            return response()->json(['success' => true, 'message' => 'Đơn đã ở chế độ Quán Tự Đặt.', 'data' => $order]);
        }
        if ($this->hasActiveCarrierSession($order)
            || in_array($order->delivery_status, [DeliveryService::ST_SEARCHING, DeliveryService::ST_ASSIGNED, DeliveryService::ST_PICKED_UP, DeliveryService::ST_DELIVERING, DeliveryService::ST_ARRIVED], true)) {
            return response()->json(['success' => false, 'message' => 'Đơn đang có phiên giao đang chạy — hãy hủy/chuyển tay trước.'], 422);
        }
        $this->enterManual($order, $service, $request, ['from_search' => false]);
        return response()->json(['success' => true, 'message' => 'Đã bắt đầu chế độ Quán Tự Đặt.', 'data' => $order->fresh()]);
    }

    /** Vào chế độ tay: phiên sạch từ đầu + chuẩn bị dữ kiện thu hộ (mục 1). */
    private function enterManual(Order $order, DeliveryService $service, Request $request, array $logPayload): void
    {
        $service->prepareBookingData($order);
        $order->update([
            'delivery_provider' => 'manual',
            'delivery_status' => null,
            'delivery_order_id' => null,
            'delivery_searching_since' => null,
            'delivery_tracking_url' => null,
            'delivery_driver_name' => null,
            'delivery_driver_phone' => null,
            'delivery_driver_plate' => null,
            'delivery_fee' => null,
            'delivery_failover_from' => null,
        ]);
        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => 'manual',
            'event' => 'manual.start',
            'payload' => $logPayload + $this->actorMeta($request),
        ]);
    }

    /**
     * Chuyển bước chế độ tay (mục 3.2) + nấc Giao thất bại kèm lý do (C2).
     * Đúng thứ tự mới qua; sai thứ tự/không ở chế độ tay → 422. Bước
     * delivering là mốc lấy hàng — đồng thời xác nhận thu hộ qua điểm xác
     * nhận chung cho đơn COD chưa trả (C1, đúng 1 lần). Bước delivered lật
     * đơn completed qua chỗ chung (mục 2). Giao thất bại: đơn KHÔNG hoàn
     * tất — ở lại cột Chờ Giao chờ quán xử lý.
     */
    public function manualAdvance(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|in:driver_assigned,delivering,arrived,delivered,failed',
            'reason' => 'nullable|string|max:255',
        ]);
        if ($deny = $this->guardKdsOrder($request, $order)) return $deny;
        if ($order->delivery_provider !== 'manual') {
            return response()->json(['success' => false, 'message' => 'Đơn không ở chế độ Quán Tự Đặt.'], 422);
        }
        $to = $validated['to'];
        $current = $order->delivery_status ?: '';
        $allowed = [
            '' => [DeliveryService::ST_ASSIGNED, DeliveryService::ST_FAILED],
            DeliveryService::ST_ASSIGNED => [DeliveryService::ST_DELIVERING, DeliveryService::ST_FAILED],
            DeliveryService::ST_DELIVERING => [DeliveryService::ST_ARRIVED, DeliveryService::ST_FAILED],
            DeliveryService::ST_ARRIVED => [DeliveryService::ST_DELIVERED, DeliveryService::ST_FAILED],
        ];
        if (!in_array($to, $allowed[$current] ?? [], true)) {
            return response()->json(['success' => false, 'message' => 'Chuyển bước không đúng thứ tự.'], 422);
        }

        if ($to === DeliveryService::ST_FAILED) {
            $reason = trim((string) ($validated['reason'] ?? ''));
            if ($reason === '') {
                return response()->json(['success' => false, 'message' => 'Cần nhập lý do giao thất bại.'], 422);
            }
            $order->update([
                'delivery_status' => DeliveryService::ST_FAILED,
                'delivery_returned' => true,
                'note' => trim(($order->note ? $order->note . ' | ' : '') . 'Giao thất bại: ' . $reason),
            ]);
            DeliveryLog::create([
                'order_id' => $order->id, 'provider' => 'manual',
                'event' => 'manual.failed',
                'payload' => ['reason' => $reason, 'from_status' => $current ?: null] + $this->actorMeta($request),
            ]);
            return response()->json(['success' => true, 'message' => 'Đã ghi nhận giao thất bại.', 'data' => $order->fresh()]);
        }

        $order->update(['delivery_status' => $to]);
        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => 'manual',
            'event' => 'manual.advance',
            'payload' => ['to' => $to, 'from_status' => $current ?: null] + $this->actorMeta($request),
        ]);
        if ($to === DeliveryService::ST_DELIVERING) {
            $service->confirmCollectionOnPickup($order->fresh()); // C1
        }
        if ($to === DeliveryService::ST_DELIVERED) {
            $service->completeIfDelivered($order->fresh()); // mục 2
        }
        return response()->json(['success' => true, 'message' => 'Đã chuyển bước giao hàng.', 'data' => $order->fresh()]);
    }

    /**
     * Đính chính điểm ghim tại KDS (mục 5.4): lưu tọa độ mới vào đơn + log
     * pin.corrected giữ ghim gốc của khách để đối soát. Phí khách đã trả
     * KHÔNG tính lại; phí hãng báo lại theo ghim mới ở lần báo phí kế tiếp.
     */
    public function correctPin(Request $request, Order $order, DeliveryService $service): JsonResponse
    {
        $validated = $request->validate([
            'lat' => 'required|numeric|between:-90,90',
            'lng' => 'required|numeric|between:-180,180',
        ]);
        if ($deny = $this->guardKdsOrder($request, $order)) return $deny;
        if ($this->hasActiveCarrierSession($order)) {
            return response()->json(['success' => false, 'message' => 'Đã đặt hãng — không sửa được điểm ghim nữa.'], 422);
        }
        $from = ['lat' => $order->delivery_dropoff_lat, 'lng' => $order->delivery_dropoff_lng];
        $order->update([
            'delivery_dropoff_lat' => (float) $validated['lat'],
            'delivery_dropoff_lng' => (float) $validated['lng'],
        ]);
        DeliveryLog::create([
            'order_id' => $order->id, 'provider' => $order->delivery_provider ?: 'system',
            'event' => 'pin.corrected',
            'payload' => [
                'from_lat' => $from['lat'] !== null ? (float) $from['lat'] : null,
                'from_lng' => $from['lng'] !== null ? (float) $from['lng'] : null,
                'to_lat' => (float) $validated['lat'],
                'to_lng' => (float) $validated['lng'],
            ] + $this->actorMeta($request),
        ]);
        return response()->json(['success' => true, 'message' => 'Đã đính chính điểm ghim.', 'data' => $order->fresh()]);
    }
}
