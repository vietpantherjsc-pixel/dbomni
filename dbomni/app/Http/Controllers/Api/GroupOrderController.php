<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GroupOrder;
use App\Models\GroupOrderItem;
use App\Models\Product;
use App\Models\ProductOption;
use App\Services\LoyaltyService;
use App\Services\PromotionService;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 9 (2026-10-05): Đặt đơn nhóm cho Zalo Mini App.
// - Trưởng nhóm tạo nhóm -> nhận link /g/{code} -> share cho mọi người.
// - Mỗi người vào link, nhập tên, chọn món như bình thường.
// - Cùng món (cùng tùy chọn) -> gộp 1 dòng, tên người đặt tự nối vào ghi chú.
// - Trưởng nhóm xem tổng + chốt đơn -> chuyển thành đơn online bình thường.
class GroupOrderController extends Controller
{
    // Tạo nhóm mới
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'leader_name' => 'required|string|max:100',
        ]);

        do {
            $code = strtoupper(Str::random(6));
        } while (GroupOrder::where('code', $code)->exists());

        $group = GroupOrder::create([
            'code' => $code,
            'branch_id' => $v['branch_id'],
            'leader_name' => trim($v['leader_name']),
            'status' => 'open',
            'expires_at' => now()->addHours(6),
        ]);

        return response()->json(['success' => true, 'data' => $group], 201);
    }

    // Xem nhóm (ai có link cũng xem được)
    public function show(string $code): JsonResponse
    {
        $group = GroupOrder::with(['items.product', 'branch'])
            ->where('code', strtoupper($code))
            ->firstOrFail();

        return response()->json(['success' => true, 'data' => $this->serialize($group)]);
    }

    // Thêm món vào nhóm (tự gộp khi trùng món + trùng tùy chọn)
    public function addItem(string $code, Request $request): JsonResponse
    {
        try {
            $group = $this->openGroup($code);
            $v = $request->validate([
                'member_name' => 'required|string|max:100',
                'product_id' => 'required|exists:products,id',
                'option_ids' => 'nullable|array',
                'option_ids.*' => 'exists:product_options,id',
                'quantity' => 'required|integer|min:1|max:20',
                'note' => 'nullable|string|max:255',
            ]);

            $item = DB::transaction(function () use ($group, $v) {
                $product = Product::with(['prices.priceList', 'categoryPrices'])->findOrFail($v['product_id']);
                if ($product->is_service_fee || !$product->is_active) {
                    throw new Exception('Món không khả dụng.');
                }
                $groupOpts = !empty($v['option_ids'])
                    ? ProductOption::whereIn('id', $v['option_ids'])->get()
                    : collect();
                // Gói 55 p11ac: dùng online_price (giá kênh Zalo) thay vì base_price cho đồng nhất với đơn thường
                // Gói 55 p11ad: GIÁ GỐC, không áp KM ở cấp dòng — KM chỉ áp 1 lần khi trưởng nhóm checkout
                $unitPrice = (float) $product->online_price
                    + $groupOpts->sum(fn($o) => (float) $o->additional_price);

                $optionIds = $groupOpts->pluck('id')->sort()->values()->all();
                $memberName = trim($v['member_name']);

                // Tìm dòng trùng món + trùng bộ tùy chọn -> gộp
                $existing = $group->items()
                    ->where('product_id', $product->id)
                    ->get()
                    ->first(function ($it) use ($optionIds) {
                        return collect($it->option_ids ?? [])->sort()->values()->all() === $optionIds;
                    });

                if ($existing) {
                    // Giữ tên người đặt trùng (không array_unique) theo yêu cầu nghiệp vụ
                    $names = array_merge(
                        $existing->member_names ?? [],
                        [$memberName]
                    );
                    $existing->update([
                        'quantity' => $existing->quantity + $v['quantity'],
                        'member_names' => $names,
                        'unit_price' => $unitPrice,
                    ]);
                    return $existing->fresh();
                }

                return $group->items()->create([
                    'member_names' => [$memberName],
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'option_ids' => $optionIds,
                    'option_names' => $groupOpts->pluck('name', 'id')->toArray(),
                    'unit_price' => $unitPrice,
                    'quantity' => $v['quantity'],
                    'note' => $v['note'] ?? null,
                ]);
            });

            return response()->json(['success' => true, 'data' => $item], 201);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    // Sửa số lượng / ghi chú 1 dòng
    public function updateItem(string $code, int $id, Request $request): JsonResponse
    {
        try {
            $group = $this->openGroup($code);
            $v = $request->validate([
                'quantity' => 'sometimes|integer|min:1|max:20',
                'note' => 'nullable|string|max:255',
            ]);
            $item = $group->items()->findOrFail($id);
            $item->update($v);
            return response()->json(['success' => true, 'data' => $item->fresh()]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    // Xóa 1 dòng
    public function removeItem(string $code, int $id): JsonResponse
    {
        try {
            $group = $this->openGroup($code);
            $group->items()->findOrFail($id)->delete();
            return response()->json(['success' => true]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
    }

    // Trưởng nhóm chốt đơn -> chuyển thành đơn online bình thường
    public function checkout(
        string $code,
        Request $request,
        PromotionService $promotionService,
        LoyaltyService $loyaltyService
    ): JsonResponse {
        $group = GroupOrder::where('code', strtoupper($code))->firstOrFail();
        // Spec đơn nhóm đồng bộ (2026-10-21): nhóm đã chốt mà request mang client_key
        // trùng đơn đã tạo (bấm lại sau timeout) → trả lại đơn cũ, không tạo đơn mới.
        if ($group->status === 'ordered' && $group->order_id && $request->filled('client_key')) {
            $existing = \App\Models\Order::with('items')->find($group->order_id);
            if ($existing && $existing->client_key === $request->input('client_key')) {
                return response()->json(['success' => true, 'message' => 'Đơn đã được tạo trước đó', 'data' => $existing, 'duplicate' => true]);
            }
        }
        try {
            $group = $this->openGroup($code);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $this->clientErrorMessage($e)], 400);
        }
        if ($group->items()->count() === 0) {
            return response()->json(['success' => false, 'message' => 'Nhóm chưa có món nào.'], 400);
        }

        // Chuẩn hóa IN HOA khi tra cứu voucher (backlog Spec 5, 2026-10-21): chỉ chuẩn hóa
        // phía đầu vào tra cứu — mã lưu trong DB giữ nguyên.
        if ($request->filled('voucher_code')) {
            $request->merge(['voucher_code' => strtoupper(trim((string) $request->input('voucher_code')))]);
        }
        $v = $request->validate([
            'client_key' => 'nullable|string|max:64', // Spec đơn nhóm: chống trùng như đơn thường
            'customer_name' => 'required|string|max:100',
            'customer_phone' => 'required|string|max:20',
            // Spec KM chống mã Phần B: mã TV của trưởng nhóm để xác thực quyền lợi trong store()
            'member_code' => 'nullable|string|max:20',
            'order_type' => ['required', \Illuminate\Validation\Rule::in(array_values(array_intersect(\App\Models\SharedCategory::activeCodes('order_types'), ['takeaway', 'delivery'])))], // Spec danh mục dùng chung: validate động
            'delivery_address' => 'required_if:order_type,delivery|nullable|string|max:255',
            // Spec đơn nhóm: BỎ bắt buộc km — geocode lỗi vẫn đặt được, server tự tính lại phí
            'distance_km' => 'nullable|numeric|min:0|max:100',
            // Spec đơn nhóm: hẹn giờ giao / hẹn tới lấy (store() validate lại after:now)
            'scheduled_at' => 'nullable|date',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            'delivery_note' => 'nullable|string|max:500',
            // payment_method để store() validate (transfer/pay_at_store) — không hardcode thêm ở đây
            'payment_method' => 'required|string|max:30',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id',
            'points_redeem' => 'nullable|integer|min:0', // Loyalty 2.0: giữ lỏng cho client cũ — bị bỏ qua ở OnlineOrderController::store
            'note' => 'nullable|string|max:255',
            'referred_by' => 'nullable|string|max:20',
            // HD-R1: báo giá hãng giao hàng cho đơn nhóm
            'delivery_package' => 'nullable|in:nhanh,sieu_toc',
            'delivery_quoted_fee' => 'nullable|numeric|min:0',
            'delivery_provider' => 'nullable|in:ahamove,lalamove',
            'delivery_dropoff_lat' => 'nullable|numeric|between:-90,90',
            'delivery_dropoff_lng' => 'nullable|numeric|between:-180,180',
        ]);

        // Spec QR 2026-10-21: đơn nhóm trả bằng CHUYỂN KHOẢN cũng đi qua kênh BANK —
        // FAIL-FAST cấu hình NH + private key TRƯỚC khi tạo đơn (chống đơn mồ côi).
        $isBank = ($v['payment_method'] ?? '') === 'transfer' && (bool) \App\Models\Setting::get('zalo_pay_bank_enabled', '1');
        $payService = app(\App\Services\ZaloPaymentService::class);
        if ($isBank && (!$payService->paymentKeyReady() || !$payService->bankInfoComplete())) {
            \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Đơn nhóm BANK bị chặn do thiếu cấu hình thanh toán.');
            return response()->json(['success' => false, 'message' => 'Kênh chuyển khoản tạm chưa sẵn sàng. Vui lòng chọn trả tại quán.'], 422);
        }

        // Dựng items cho đơn online: tên người đặt nối vào ghi chú từng dòng
        // Gói 55 p11ad: KM chỉ áp 1 lần tại checkout — items dựng lại GIÁ GỐC từ DB
        // (không mang unit_price/discount từ client), tránh áp KM 2 lần.
        $items = $group->items()->get()->map(function ($gi) {
            return [
                'product_id' => $gi->product_id,
                'option_ids' => $gi->option_ids ?? [],
                'quantity' => $gi->quantity,
                'note' => $gi->displayNote(),
            ];
        })->toArray();

        $payload = array_merge($v, [
            'branch_id' => $group->branch_id,
            'items' => $items,
        ]);
        $subRequest = Request::create('/api/online/orders', 'POST', $payload);

        /** @var OnlineOrderController $online */
        $online = app(OnlineOrderController::class);
        $response = $online->store($subRequest, $promotionService, $loyaltyService);

        if ($response->getStatusCode() === 201) {
            // Spec đơn nhóm đồng bộ: lưu đơn đã chốt để mọi thành viên thấy mã đơn + theo dõi
            $data = $response->getData(true);
            $group->update([
                'status' => 'ordered',
                'order_id' => $data['data']['id'] ?? null,
            ]);

            // Spec QR 2026-10-21: đơn nhóm BANK — gắn pay_channel + params CK vào response
            // để trưởng nhóm vào màn "Chờ thanh toán" như đơn thường.
            if ($isBank && !empty($data['data']['id'])) {
                $order = \App\Models\Order::find($data['data']['id']);
                try {
                    $params = $payService->createCheckoutParams($order, \App\Services\ZaloPaymentService::CHANNEL_BANK);
                    $orderData = $order->fresh()->load(['items.product', 'customer'])->toArray();
                    $orderData['bank_info'] = $params['bank_info'];
                    $orderData['transfer_content'] = $params['transfer_content'];
                    $orderData['vietqr_payload'] = $params['vietqr_payload'] ?? null;
                    $orderData['pay_channel'] = 'BANK';
                    return response()->json(['success' => true, 'message' => $data['message'] ?? 'Đặt món thành công!', 'data' => $orderData], 201);
                } catch (\Exception $e) {
                    // Đã fail-fast ở trên — lỗi tới đây là bất thường: hủy đơn, không để mồ côi.
                    $order->update(['status' => 'cancelled', 'payment_status' => 'failed']);
                    $group->update(['status' => 'open', 'order_id' => null]);
                    \Illuminate\Support\Facades\Log::error('[ThanhToanQR] Đơn nhóm tạo params thất bại — đã hủy đơn ' . $order->code . ': ' . $e->getMessage());
                    return response()->json(['success' => false, 'message' => 'Không khởi tạo được thanh toán. Đơn đã được hủy, bạn không bị trừ tiền.'], 422);
                }
            }
        }
        return $response;
    }

    private function openGroup(string $code): GroupOrder
    {
        $group = GroupOrder::where('code', strtoupper($code))->firstOrFail();
        if (!$group->isOpen()) {
            throw new Exception('Nhóm đã đóng hoặc hết hạn.');
        }
        return $group;
    }

    private function serialize(GroupOrder $group): array
    {
        $items = $group->items->map(function ($it) {
            return [
                'id' => $it->id,
                'product_id' => $it->product_id,
                'product_name' => $it->product_name,
                'category_id' => $it->product?->category_id, // Spec đơn nhóm: KM theo danh mục cần category_id
                'image_url' => $it->product?->image_url,
                'option_names' => array_values($it->option_names ?? []),
                'member_names' => $it->member_names ?? [],
                'unit_price' => (float) $it->unit_price,
                'quantity' => $it->quantity,
                'line_total' => (float) $it->unit_price * $it->quantity,
                'note' => $it->displayNote(),
            ];
        });
        return [
            'code' => $group->code,
            // Audit 2026-10-21 🟠14: kèm tọa độ + giờ mở cửa để GroupCheckout tính
            // phí ship/giờ hẹn theo ĐÚNG chi nhánh của nhóm (trước chỉ có id+name,
            // frontend buộc phải mượn chi nhánh đang chọn trong máy trưởng nhóm).
            'branch' => $group->branch ? [
                'id' => $group->branch->id,
                'name' => $group->branch->name,
                'latitude' => $group->branch->latitude,
                'longitude' => $group->branch->longitude,
                'opening_hours' => $group->branch->opening_hours,
            ] : null,
            'leader_name' => $group->leader_name,
            'status' => $group->status,
            // Spec đơn nhóm đồng bộ: mã đơn đã chốt (mọi thành viên đều thấy)
            'order_id' => $group->order_id,
            'order_code' => $group->order?->code,
            'expires_at' => $group->expires_at,
            'items' => $items->values(),
            'total_qty' => $items->sum('quantity'),
            'subtotal' => $items->sum('line_total'),
            'member_count' => $items->pluck('member_names')->flatten()->unique()->count(),
        ];
    }
}
