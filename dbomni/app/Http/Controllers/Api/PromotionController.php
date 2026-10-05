<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Promotion;
use App\Services\PromotionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 5 (2026-10-05): Khuyến mại kiểu Sapo.
class PromotionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Promotion::with('giftProduct')->orderByDesc('id');
        if ($request->filled('is_active')) {
            $query->where('is_active', (bool) $request->query('is_active'));
        }
        return response()->json(['success' => true, 'data' => $query->paginate(20)]);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json(['success' => true, 'data' => Promotion::with('giftProduct')->findOrFail($id)]);
    }

    private function rules(): array
    {
        return [
            'name' => 'required|string|max:150',
            'type' => 'required|in:percent,fixed,fixed_price,gift,shipping', // Gói 10c: shipping = giảm/miễn phí ship
            'value' => 'nullable|numeric|min:0',
            'scope' => 'required|in:order,category,product,menu', // Gói 10: thêm phạm vi Thực đơn
            'scope_ids' => 'nullable|array',
            'min_order_amount' => 'nullable|numeric|min:0',
            'max_discount_amount' => 'nullable|numeric|min:0',
            'gift_product_id' => 'nullable|exists:products,id',
            'gift_quantity' => 'nullable|integer|min:1',
            'target' => 'required|in:all,tier',
            'tier_ids' => 'nullable|array',
            'starts_at' => 'nullable|date',
            'expires_at' => 'nullable|date|after_or_equal:starts_at',
            'days_of_week' => 'nullable|array',
            'days_of_week.*' => 'integer|min:0|max:6',
            'time_from' => 'nullable|date_format:H:i',
            'time_to' => 'nullable|date_format:H:i|after:time_from',
            'channels' => 'nullable|array',
            'is_active' => 'nullable|boolean',
        ];
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate($this->rules());

        if ($validated['type'] === 'gift' && empty($validated['gift_product_id'])) {
            return response()->json(['success' => false, 'message' => 'Khuyến mại tặng món cần chọn sản phẩm tặng.'], 422);
        }
        if (in_array($validated['type'], ['percent', 'fixed', 'fixed_price']) && empty($validated['value'])) {
            return response()->json(['success' => false, 'message' => 'Nhập giá trị khuyến mại.'], 422);
        }

        $promo = Promotion::create($validated);
        return response()->json(['success' => true, 'data' => $promo->load('giftProduct')], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $promo = Promotion::findOrFail($id);
        $validated = $request->validate(array_map(
            fn($r) => str_replace('required|', 'sometimes|', $r),
            $this->rules()
        ));
        $promo->update($validated);
        return response()->json(['success' => true, 'data' => $promo->load('giftProduct')]);
    }

    public function destroy(int $id): JsonResponse
    {
        Promotion::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa khuyến mại']);
    }

    // Danh sách KM đủ điều kiện cho 1 đơn hàng (POS gọi để hiển thị/gợi ý)
    public function eligible(Request $request, PromotionService $service): JsonResponse
    {
        $validated = $request->validate([
            'subtotal' => 'required|numeric|min:0',
            'items' => 'nullable|array',
            'items.*.product_id' => 'required|integer',
            'items.*.category_id' => 'nullable|integer',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.line_total' => 'required|numeric|min:0',
            'items.*.unit_price' => 'required|numeric|min:0',
            'customer_id' => 'nullable|exists:customers,id',
            'channel' => 'nullable|in:pos,online',
            'shipping_fee' => 'nullable|numeric|min:0', // Gói 10c: để tính KM phí ship
        ]);

        $list = $service->eligiblePromotions([
            'subtotal' => (float) $validated['subtotal'],
            'items' => $validated['items'] ?? [],
            'customer_id' => $validated['customer_id'] ?? null,
            'channel' => $validated['channel'] ?? 'pos',
            'shipping_fee' => (float) ($validated['shipping_fee'] ?? 0),
        ]);

        return response()->json(['success' => true, 'data' => $list]);
    }
}
