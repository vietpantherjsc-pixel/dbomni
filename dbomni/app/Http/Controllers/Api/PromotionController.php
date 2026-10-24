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
            'code' => 'nullable|string|max:20|unique:promotions,code', // SPEC-02: mã CP-xx
            'type' => ['required', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('promotion_types'))], // Spec danh mục dùng chung: validate động
            'coupon_type' => 'nullable|in:bogo,stamp,gift', // SPEC-02: loại coupon mở rộng
            'value' => 'nullable|numeric|min:0',
            'scope' => ['required', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('promotion_scopes'))], // Spec danh mục dùng chung: validate động
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
            // Spec kênh bán hàng (2026-10-19): channels = mảng ID price_lists (null = mọi kênh)
            'channels' => 'nullable|array',
            'channels.*' => 'integer|exists:price_lists,id',
            'is_active' => 'nullable|boolean',
            // Mô hình cộng dồn 2026-10-21 ~22:45: phía KM chỉ còn 1 cờ — cộng dồn với coupon.
            // (Cờ KM+KM đã bỏ hẳn: mỗi đơn tối đa 1 KM tiền hàng.)
            'stack_with_coupon' => 'nullable|boolean',
            'banner_url' => 'nullable|string|max:500', // Gói 48: ảnh banner cho Mini App
            'auto_config' => 'nullable|array', // SPEC-02: cấu hình trigger tự động
        ];
    }

    // SPEC-02b: thông báo lỗi tiếng Việt để admin không chuyên đọc hiểu được.
    private function messages(): array
    {
        return [
            'name.required' => 'Vui lòng nhập tên khuyến mại.',
            'name.max' => 'Tên khuyến mại tối đa 150 ký tự.',
            'code.unique' => 'Mã coupon này đã được dùng cho khuyến mại khác. Hãy nhập mã khác.',
            'code.max' => 'Mã coupon tối đa 20 ký tự.',
            'type.required' => 'Vui lòng chọn loại khuyến mại.',
            'type.in' => 'Loại khuyến mại không hợp lệ.',
            'value.numeric' => 'Giá trị khuyến mại phải là số.',
            'value.min' => 'Giá trị khuyến mại không được âm.',
            'scope.required' => 'Vui lòng chọn phạm vi áp dụng.',
            'scope.in' => 'Phạm vi áp dụng không hợp lệ.',
            'gift_product_id.exists' => 'Món tặng không tồn tại. Hãy tải lại trang rồi chọn lại.',
            'gift_quantity.min' => 'Số lượng tặng ít nhất là 1.',
            'min_order_amount.numeric' => 'Đơn tối thiểu phải là số.',
            'max_discount_amount.numeric' => 'Giảm giá tối đa phải là số.',
            'target.required' => 'Vui lòng chọn đối tượng áp dụng.',
            'starts_at.date' => 'Ngày bắt đầu không hợp lệ.',
            'expires_at.date' => 'Ngày kết thúc không hợp lệ.',
            'expires_at.after_or_equal' => 'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
            'time_from.date_format' => 'Giờ bắt đầu phải đúng dạng HH:MM.',
            'time_to.date_format' => 'Giờ kết thúc phải đúng dạng HH:MM.',
            'time_to.after' => 'Giờ kết thúc phải sau giờ bắt đầu.',
            'auto_config.array' => 'Tham số trigger tự động không hợp lệ.',
        ];
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate($this->rules(), $this->messages());

        if ($validated['type'] === 'gift' && empty($validated['gift_product_id'])) {
            return response()->json([
                'success' => false,
                'message' => 'Coupon tặng món: vui lòng chọn "Món tặng" trước khi bấm Lưu.',
                'errors' => ['gift_product_id' => ['Vui lòng chọn món sẽ tặng cho khách.']],
            ], 422);
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
        $rules = array_map(
            // Spec danh mục dùng chung: rules() có cả dạng mảng (Rule::in động) — đổi required->sometimes cho cả 2 dạng
            fn($r) => is_array($r)
                ? array_map(fn($x) => $x === 'required' ? 'sometimes' : $x, $r)
                : str_replace('required|', 'sometimes|', $r),
            $this->rules()
        );
        // SPEC-02: unique code bỏ qua bản ghi hiện tại
        $rules['code'] = 'nullable|string|max:20|unique:promotions,code,' . $id;
        $validated = $request->validate($rules, $this->messages());
        // SPEC-02b: kiểm tra gift cả khi sửa (gộp với dữ liệu cũ của bản ghi)
        $type = $validated['type'] ?? $promo->type;
        $giftId = array_key_exists('gift_product_id', $validated) ? $validated['gift_product_id'] : $promo->gift_product_id;
        if ($type === 'gift' && empty($giftId)) {
            return response()->json([
                'success' => false,
                'message' => 'Coupon tặng món: vui lòng chọn "Món tặng" trước khi bấm Lưu.',
                'errors' => ['gift_product_id' => ['Vui lòng chọn món sẽ tặng cho khách.']],
            ], 422);
        }
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
            'channel' => 'nullable|in:pos,online,nha_hang,zalo', // Spec kênh bán hàng: chấp nhận cả mã chuẩn lẫn mã cũ (service tự map)
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
