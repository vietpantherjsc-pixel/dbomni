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
                // Gói Checkout SDK — bổ sung Đ4 (lệnh PM 2026-11-11): ca trùng
                // cũng mở được SDK ngay trên response như nhánh không-trùng —
                // gắn sdk_params cho BANK/COD khi đơn còn chờ thanh toán. Kênh
                // lấy theo pay_channel đã lưu trên đơn (fallback: payment_method
                // của request, khớp khuôn $isBank/$isCod của nhánh chính); fail-fast
                // cấu hình như nhánh chính (BANK: key + thông tin NH · COD: key).
                $dupChannel = null;
                if ($existing->pay_channel === \App\Services\ZaloPaymentService::CHANNEL_BANK
                    || $existing->pay_channel === \App\Services\ZaloPaymentService::CHANNEL_COD) {
                    $dupChannel = $existing->pay_channel;
                } elseif ($request->input('payment_method') === 'transfer' && (bool) \App\Models\Setting::get('zalo_pay_bank_enabled', '1')) {
                    $dupChannel = \App\Services\ZaloPaymentService::CHANNEL_BANK;
                } elseif ($request->input('payment_method') === 'pay_at_store' && (bool) \App\Models\Setting::get('zalo_pay_cod_enabled', '1')) {
                    $dupChannel = \App\Services\ZaloPaymentService::CHANNEL_COD;
                }
                if ($dupChannel && $existing->payment_status === 'pending_payment') {
                    $payService = app(\App\Services\ZaloPaymentService::class);
                    $ready = $dupChannel === \App\Services\ZaloPaymentService::CHANNEL_BANK
                        ? ($payService->paymentKeyReady() && $payService->bankInfoComplete())
                        : $payService->paymentKeyReady();
                    if ($ready) {
                        try {
                            $params = $payService->createCheckoutParams($existing, $dupChannel);
                            $orderData = $existing->fresh()->load(['items.product', 'customer'])->toArray();
                            $orderData['sdk_params'] = $params['sdk_params'];
                            $orderData['bank_info'] = $params['bank_info'];
                            $orderData['transfer_content'] = $params['transfer_content'];
                            $orderData['pay_channel'] = $dupChannel;
                            return response()->json(['success' => true, 'message' => 'Đơn đã được tạo trước đó', 'data' => $orderData, 'duplicate' => true]);
                        } catch (\Exception $e) {
                            // Không vì lỗi cấp lại params mà mất đơn đã chốt —
                            // trưởng nhóm còn đường "Thanh toán tiếp" ở /pay-wait.
                            \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Đơn nhóm trùng: cấp lại params thất bại cho đơn ' . $existing->code . ': ' . $e->getMessage());
                        }
                    }
                }
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
            // Spec đồng bộ luồng nhóm (2026-11-13, L4 + L11): chuyển tiếp
            // vào store() như đơn thường — coupon ví của trưởng nhóm và
            // email tự nguyện; thiếu 2 dòng này thì validate ở đây nuốt
            // mất payload trước khi store() nhận (store() đã có sẵn luật
            // xử lý cả hai: coupon ví thay promotion_id, email chỉ điền
            // khi hồ sơ trống).
            'customer_coupon_id' => 'nullable|exists:customer_coupons,id',
            'email' => 'nullable|email|max:150',
            // Spec mật khẩu §5.4: cờ đồng ý NĐ 13 để store() ghi mốc 'checkout'
            // (chốt đơn nhóm cũng qua store() nên cùng cổng cứng).
            'consent_agreed' => 'nullable|boolean',
            'points_redeem' => 'nullable|integer|min:0', // Loyalty 2.0: giữ lỏng cho client cũ — bị bỏ qua ở OnlineOrderController::store
            'note' => 'nullable|string|max:255',
            'referred_by' => 'nullable|string|max:20',
            // HD-R1: báo giá hãng giao hàng cho đơn nhóm
            'delivery_package' => 'nullable|in:nhanh,sieu_toc',
            'delivery_quoted_fee' => 'nullable|numeric|min:0',
            'delivery_provider' => 'nullable|in:ahamove,lalamove',
            'delivery_dropoff_lat' => 'nullable|numeric|between:-90,90',
            'delivery_dropoff_lng' => 'nullable|numeric|between:-180,180',
            // Gói geocode lai NDAMaps (2026-11-13 mục 3.3 + 6): cờ nguồn
            // điểm áp cho đơn nhóm như đơn thường — thiếu dòng này thì
            // validate ở đây nuốt mất trường trước khi store() nhận.
            'dropoff_source' => 'nullable|in:ladder,ndamaps_place,ndamaps_forward,saved',
        ]);

        // Spec QR 2026-10-21: đơn nhóm trả bằng CHUYỂN KHOẢN cũng đi qua kênh BANK —
        // FAIL-FAST cấu hình NH + private key TRƯỚC khi tạo đơn (chống đơn mồ côi).
        // Vá §HL (2026-11-13, lỗi sống S-05): TÁCH nhận diện kênh khỏi cờ
        // khả dụng. Trước đây $isBank gộp cờ zalo_pay_bank_enabled vào
        // phép nhận diện kênh nên khi BANK tắt thì $isBank=false, khối
        // fail-fast 422 KHÔNG BAO GIỜ chạy và đơn vẫn tạo 201 — đơn mồ
        // côi không kênh, không sdk_params (mẫu sống: đơn 3573). Nay
        // $isBank/$isCod CHỈ nhận diện kênh đã chọn; cờ khả dụng là điều
        // kiện CHẶN riêng trong cùng khối 422 (câu lỗi giữ nguyên văn).
        // Cùng mẫu lỗi ở $isCod nên vá đối xứng cả hai kênh.
        $isBank = ($v['payment_method'] ?? '') === 'transfer';
        $isCod = ($v['payment_method'] ?? '') === 'pay_at_store';
        $bankEnabled = (bool) \App\Models\Setting::get('zalo_pay_bank_enabled', '1');
        $codEnabled = (bool) \App\Models\Setting::get('zalo_pay_cod_enabled', '1');
        $payService = app(\App\Services\ZaloPaymentService::class);
        if ($isBank && (!$bankEnabled || !$payService->paymentKeyReady() || !$payService->bankInfoComplete())) {
            \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Đơn nhóm BANK bị chặn do thiếu cấu hình thanh toán.');
            return response()->json(['success' => false, 'message' => 'Kênh chuyển khoản tạm chưa sẵn sàng. Vui lòng chọn trả tại quán.'], 422);
        }
        // Gói Checkout SDK — Đ4 (2026-11-10): đơn nhóm COD (trả tại quán)
        // cũng đi qua Checkout SDK như đơn thường — mac bắt buộc cho mọi
        // kênh nên fail-fast private key cho COD trước khi tạo đơn.
        if ($isCod && (!$codEnabled || !$payService->paymentKeyReady())) {
            \Illuminate\Support\Facades\Log::warning('[ThanhToanQR] Đơn nhóm COD bị chặn do thiếu private key ký mac Checkout SDK.');
            return response()->json(['success' => false, 'message' => 'Kênh trả tại quán tạm chưa sẵn sàng. Vui lòng chọn chuyển khoản.'], 422);
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
            // Gói Checkout SDK — Đ4 (2026-11-10): trả kèm sdk_params cho CẢ
            // BANK lẫn COD để trưởng nhóm mở CheckoutSDK ngay sau khi chốt
            // (cùng đường params với checkout-orders, không luồng riêng).
            if (($isBank || $isCod) && !empty($data['data']['id'])) {
                $order = \App\Models\Order::find($data['data']['id']);
                try {
                    $params = $payService->createCheckoutParams($order, $isBank
                        ? \App\Services\ZaloPaymentService::CHANNEL_BANK
                        : \App\Services\ZaloPaymentService::CHANNEL_COD);
                    $orderData = $order->fresh()->load(['items.product', 'customer'])->toArray();
                    $orderData['sdk_params'] = $params['sdk_params'];
                    $orderData['bank_info'] = $params['bank_info'];
                    $orderData['transfer_content'] = $params['transfer_content'];
                    $orderData['pay_channel'] = $isBank ? 'BANK' : 'COD';
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
