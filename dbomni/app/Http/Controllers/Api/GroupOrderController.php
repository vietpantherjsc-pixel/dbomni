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
                $product = Product::findOrFail($v['product_id']);
                if ($product->is_service_fee || !$product->is_active) {
                    throw new Exception('Món không khả dụng.');
                }
                $groupOpts = !empty($v['option_ids'])
                    ? ProductOption::whereIn('id', $v['option_ids'])->get()
                    : collect();
                $unitPrice = (float) $product->base_price
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
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
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
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
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
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }

    // Trưởng nhóm chốt đơn -> chuyển thành đơn online bình thường
    public function checkout(
        string $code,
        Request $request,
        PromotionService $promotionService,
        LoyaltyService $loyaltyService
    ): JsonResponse {
        try {
            $group = $this->openGroup($code);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
        if ($group->items()->count() === 0) {
            return response()->json(['success' => false, 'message' => 'Nhóm chưa có món nào.'], 400);
        }

        $v = $request->validate([
            'customer_name' => 'required|string|max:100',
            'customer_phone' => 'required|string|max:20',
            'order_type' => 'required|in:takeaway,delivery',
            'delivery_address' => 'required_if:order_type,delivery|nullable|string|max:255',
            'distance_km' => 'required_if:order_type,delivery|nullable|numeric|min:0|max:100',
            'payment_method' => 'required|in:transfer,pay_at_store',
            'voucher_code' => 'nullable|string|exists:vouchers,code',
            'promotion_id' => 'nullable|exists:promotions,id',
            'points_redeem' => 'nullable|integer|min:0',
            'note' => 'nullable|string|max:255',
            'referred_by' => 'nullable|string|max:20',
        ]);

        // Dựng items cho đơn online: tên người đặt nối vào ghi chú từng dòng
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
            $group->update(['status' => 'ordered']);
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
            'branch' => $group->branch ? ['id' => $group->branch->id, 'name' => $group->branch->name] : null,
            'leader_name' => $group->leader_name,
            'status' => $group->status,
            'expires_at' => $group->expires_at,
            'items' => $items->values(),
            'total_qty' => $items->sum('quantity'),
            'subtotal' => $items->sum('line_total'),
            'member_count' => $items->pluck('member_names')->flatten()->unique()->count(),
        ];
    }
}
