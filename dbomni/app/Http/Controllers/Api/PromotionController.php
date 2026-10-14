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
            'banner_url' => 'nullable|string|max:500', // Gói 48: ảnh banner cho Mini App
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
        $oldBanner = $promo->banner_url;
        $validated = $request->validate(array_map(
            fn($r) => str_replace('required|', 'sometimes|', $r),
            $this->rules()
        ));
        $promo->update($validated);
        // Gói 50: xóa ảnh banner cũ khi thay bằng ảnh mới (tránh đầy bộ nhớ)
        if (array_key_exists('banner_url', $validated) && $oldBanner && $oldBanner !== $validated['banner_url']) {
            $this->deleteCoverFile($oldBanner);
        }
        return response()->json(['success' => true, 'data' => $promo->load('giftProduct')]);
    }

    public function destroy(int $id): JsonResponse
    {
        $promo = Promotion::findOrFail($id);
        // Gói 50: xóa ảnh banner khi xóa CT
        if ($promo->banner_url) {
            $this->deleteCoverFile($promo->banner_url);
        }
        $promo->delete();
        return response()->json(['success' => true]);
    }

    // Gói 50: xóa file ảnh trong public/covers (chỉ xóa file thật, chống path traversal)
    private function deleteCoverFile(?string $url): void
    {
        if (!$url) return;
        $path = parse_url($url, PHP_URL_PATH) ?: $url;
        $filename = basename($path);
        if (!$filename || !preg_match('/^[a-zA-Z0-9_\-\.]+$/', $filename)) return;
        $full = public_path('covers/' . $filename);
        if (is_file($full)) {
            @unlink($full);
        }
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

    // Gói 48: banner KM cho carousel trong Zalo Mini App (public).
    // Chỉ lấy CT đang bật, có ảnh banner, còn hiệu lực.
    public function banners(Request $request): JsonResponse
    {
        $now = now();
        $items = \App\Models\Promotion::where('is_active', true)
            ->whereNotNull('banner_url')
            ->where('banner_url', '!=', '')
            ->where(function ($q) use ($now) {
                $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now);
            })
            ->where(function ($q) use ($now) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now);
            })
            ->orderByDesc('id')
            ->get(['id', 'name', 'banner_url']);
        // Gói 50b: chuẩn hóa thành URL tuyệt đối theo host thật (sửa dữ liệu cũ relative/localhost)
        $host = $request->getSchemeAndHttpHost();
        foreach ($items as $item) {
            if ($item->banner_url && !preg_match('#^https?://#i', $item->banner_url)) {
                $item->banner_url = $host . '/' . ltrim($item->banner_url, '/');
            }
        }
        return response()->json(['success' => true, 'data' => $items]);
    }
}
