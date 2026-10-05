<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Material;
use App\Models\OptionGroup;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\Recipe;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 7b (2026-10-05): Quản lý nhóm tùy chọn (Size, Độ Ngọt, Đá, Topping...).
class OptionGroupController extends Controller
{
    public function index(): JsonResponse
    {
        $groups = OptionGroup::with(['options' => fn($q) => $q->orderBy('sort_order')->orderBy('id')])
            ->withCount('products')
            ->orderBy('sort_order')
            ->get();
        return response()->json(['success' => true, 'data' => $groups]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'name' => 'required|string|max:100',
            'code' => 'nullable|string|max:50|unique:option_groups,code',
            'type' => 'required|in:single,multiple',
            'is_required' => 'boolean',
            'max_select' => 'nullable|integer|min:1',
            'quantity_mode' => 'nullable|in:fixed,per_product', // Gói 8c
        ]);
        $group = OptionGroup::create($v);
        return response()->json(['success' => true, 'message' => 'Đã tạo nhóm.', 'data' => $group], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $group = OptionGroup::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'type' => 'sometimes|in:single,multiple',
            'is_required' => 'boolean',
            'max_select' => 'nullable|integer|min:1',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
            'quantity_mode' => 'sometimes|in:fixed,per_product', // Gói 8c
        ]);
        $group->update($v);
        return response()->json(['success' => true, 'message' => 'Đã cập nhật.', 'data' => $group]);
    }

    public function destroy(int $id): JsonResponse
    {
        $group = OptionGroup::findOrFail($id);
        // Options thuộc nhóm giữ lại nhưng gỡ khỏi nhóm (tránh mất giá đã set)
        ProductOption::where('option_group_id', $id)->update(['option_group_id' => null]);
        $group->products()->detach();
        $group->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa nhóm.']);
    }

    public function storeOption(Request $request, int $groupId): JsonResponse
    {
        $group = OptionGroup::findOrFail($groupId);
        $v = $request->validate([
            'name' => 'required|string|max:100',
            'additional_price' => 'nullable|numeric|min:0',
        ]);
        $opt = $group->options()->create([
            'name' => $v['name'],
            'additional_price' => $v['additional_price'] ?? 0,
            'product_id' => null,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã thêm tùy chọn.', 'data' => $opt], 201);
    }

    public function updateOption(Request $request, int $id): JsonResponse
    {
        $opt = ProductOption::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'additional_price' => 'nullable|numeric|min:0',
            'is_required' => 'boolean',
        ]);
        $opt->update($v);
        return response()->json(['success' => true, 'message' => 'Đã cập nhật giá.', 'data' => $opt]);
    }

    public function destroyOption(int $id): JsonResponse
    {
        ProductOption::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa tùy chọn.']);
    }

    // ===== Gói 8a (2026-10-05) =====

    // Kéo-thả sắp xếp nhóm
    public function reorder(Request $request): JsonResponse
    {
        $v = $request->validate(['ids' => 'required|array', 'ids.*' => 'exists:option_groups,id']);
        foreach ($v['ids'] as $i => $id) {
            OptionGroup::where('id', $id)->update(['sort_order' => $i]);
        }
        return response()->json(['success' => true]);
    }

    // Kéo-thả sắp xếp tùy chọn trong nhóm
    public function reorderOptions(Request $request, int $groupId): JsonResponse
    {
        $v = $request->validate(['ids' => 'required|array', 'ids.*' => 'exists:product_options,id']);
        foreach ($v['ids'] as $i => $id) {
            ProductOption::where('id', $id)->where('option_group_id', $groupId)->update(['sort_order' => $i]);
        }
        return response()->json(['success' => true]);
    }

    // Danh sách mặt hàng đang gán vào nhóm
    public function products(int $id): JsonResponse
    {
        $group = OptionGroup::findOrFail($id);
        return response()->json(['success' => true, 'data' => $group->products()->pluck('products.id')]);
    }

    // Gán nhóm cho nhiều mặt hàng (từ trang Nhóm tùy chọn)
    public function assignProducts(Request $request, int $id): JsonResponse
    {
        $group = OptionGroup::findOrFail($id);
        $v = $request->validate([
            'product_ids' => 'required|array',
            'product_ids.*' => 'exists:products,id',
        ]);
        $group->products()->sync($v['product_ids']);
        return response()->json(['success' => true, 'message' => 'Đã gán nhóm cho ' . count($v['product_ids']) . ' mặt hàng.']);
    }

    // Định mức nguyên liệu TĂNG THÊM của 1 tùy chọn (size/topping)
    // VD: Size L +30ml cà phê; Trân châu đen +30g trân châu
    // Gói 8c: tách 2 loại — ingredient (nguyên liệu) và packaging (bao bì).
    // Chỉ dùng cho nhóm quantity_mode='fixed' (định lượng cố định).
    public function optionRecipes(int $id): JsonResponse
    {
        $opt = ProductOption::with('group')->findOrFail($id);
        $recipes = Recipe::with('material')->where('product_option_id', $id)->whereNull('product_id')->get();
        return response()->json(['success' => true, 'data' => [
            'option' => $opt,
            'quantity_mode' => $opt->group->quantity_mode ?? 'fixed',
            'recipes' => $recipes,
            'materials' => Material::orderBy('name')->get(['id', 'name', 'unit', 'type']),
        ]]);
    }

    public function updateOptionRecipes(Request $request, int $id): JsonResponse
    {
        $opt = ProductOption::findOrFail($id);
        $v = $request->validate([
            'recipes' => 'required|array',
            'recipes.*.material_id' => 'required|exists:materials,id',
            'recipes.*.quantity' => 'required|numeric|min:0',
            'recipes.*.kind' => 'nullable|in:ingredient,packaging',
        ]);

        DB::transaction(function () use ($id, $v, $opt) {
            // Chỉ xóa dòng chung (product_id null); giữ dòng theo món (Gói 8c)
            Recipe::where('product_option_id', $id)->whereNull('product_id')->delete();
            foreach ($v['recipes'] as $r) {
                if ((float) $r['quantity'] <= 0) continue;
                Recipe::create([
                    'product_id' => null,
                    'product_option_id' => $id,
                    'material_id' => $r['material_id'],
                    'quantity' => $r['quantity'],
                    'kind' => $r['kind'] ?? 'ingredient',
                ]);
            }
        });

        return response()->json(['success' => true, 'message' => 'Đã lưu định mức.']);
    }
}
