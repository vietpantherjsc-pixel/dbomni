<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PriceList;
use App\Support\CatalogCache;
use App\Support\ConfigChangeLogger; // N-5: log đổi chiết khấu bảng giá
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

// Gói 8a (2026-10-05): CRUD kênh bán hàng (dùng cho giá theo kênh).
class PriceListController extends Controller
{
    public function index(): JsonResponse
    {
        $lists = PriceList::orderBy('sort_order')->orderBy('id')->get()
            ->map(function ($pl) {
                $pl->product_count = $pl->prices()->where('is_active', true)->count();
                return $pl;
            });
        return response()->json($lists);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'code' => 'nullable|string|max:50|unique:price_lists,code',
            'is_active' => 'boolean',
            // Spec kênh bán hàng (2026-10-19): phân loại kênh
            'category' => 'nullable|in:store,online,partner',
            // Gói 17: chiết khấu kênh
            'commission_rate' => 'nullable|numeric|min:0|max:100',
            'commission_tax_included' => 'nullable|boolean',
            'commission_tax_rate' => 'nullable|numeric|min:0|max:100',
        ]);

        $validated['code'] = $validated['code'] ?? Str::slug($validated['name'], '_');
        $validated['sort_order'] = (PriceList::max('sort_order') ?? -1) + 1;

        $pl = PriceList::create($validated);
        // N-5: tạo mới có chiết khấu → ghi log (cũ = null; trường rỗng không ghi).
        [$actorId, $actorType, $actorName] = ConfigChangeLogger::actor($request);
        ConfigChangeLogger::logFields('channel_pricing', 'price_list', (int) $pl->id, $pl->name, [], [
            'commission_rate' => $validated['commission_rate'] ?? null,
            'commission_tax_included' => $validated['commission_tax_included'] ?? null,
            'commission_tax_rate' => $validated['commission_tax_rate'] ?? null,
        ], $actorId, $actorType, $actorName);
        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json($pl, 201);
    }

    public function update(Request $request, PriceList $priceList): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'is_active' => 'sometimes|boolean',
            // Spec kênh bán hàng (2026-10-19): phân loại kênh
            'category' => 'sometimes|in:store,online,partner',
            // Gói 17: chiết khấu kênh
            'commission_rate' => 'sometimes|numeric|min:0|max:100',
            'commission_tax_included' => 'sometimes|boolean',
            'commission_tax_rate' => 'nullable|numeric|min:0|max:100',
        ]);

        // N-5: chụp giá trị chiết khấu cũ trước khi sửa để ghi diff.
        $old = $priceList->only(['commission_rate', 'commission_tax_included', 'commission_tax_rate']);
        $priceList->update($validated);
        [$actorId, $actorType, $actorName] = ConfigChangeLogger::actor($request);
        ConfigChangeLogger::logFields('channel_pricing', 'price_list', (int) $priceList->id, $priceList->name, $old,
            array_intersect_key($validated, array_flip(['commission_rate', 'commission_tax_included', 'commission_tax_rate'])),
            $actorId, $actorType, $actorName);
        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json($priceList);
    }

    public function destroy(PriceList $priceList): JsonResponse
    {
        // Không xóa kênh còn đang gán giá cho món (tránh mất dữ liệu giá)
        if ($priceList->prices()->exists()) {
            return response()->json(['message' => 'Kênh đang có giá món, hãy tắt thay vì xóa.'], 422);
        }
        $priceList->delete();
        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json(['message' => 'Đã xóa kênh bán hàng.']);
    }

    // Kéo-thả sắp xếp kênh
    public function reorder(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:price_lists,id',
        ]);

        foreach ($validated['ids'] as $i => $id) {
            PriceList::where('id', $id)->update(['sort_order' => $i]);
        }

        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json(['success' => true]);
    }
}
