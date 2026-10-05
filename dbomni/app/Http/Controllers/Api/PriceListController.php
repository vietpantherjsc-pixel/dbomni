<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PriceList;
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
        ]);

        $validated['code'] = $validated['code'] ?? Str::slug($validated['name'], '_');
        $validated['sort_order'] = (PriceList::max('sort_order') ?? -1) + 1;

        $pl = PriceList::create($validated);
        return response()->json($pl, 201);
    }

    public function update(Request $request, PriceList $priceList): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'is_active' => 'sometimes|boolean',
        ]);

        $priceList->update($validated);
        return response()->json($priceList);
    }

    public function destroy(PriceList $priceList): JsonResponse
    {
        // Không xóa kênh còn đang gán giá cho món (tránh mất dữ liệu giá)
        if ($priceList->prices()->exists()) {
            return response()->json(['message' => 'Kênh đang có giá món, hãy tắt thay vì xóa.'], 422);
        }
        $priceList->delete();
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

        return response()->json(['success' => true]);
    }
}
