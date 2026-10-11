<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Material;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 4 (2026-10-04): CRUD nguyên vật liệu (kèm đơn vị quy đổi).
class MaterialController extends Controller
{
    public function index(): JsonResponse
    {
        // Gói 22: kèm loại danh mục để nhóm kiểm kho + hiển thị
        $materials = Material::with('category')->orderBy('type')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $materials]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'unit' => 'required|string|max:20',
            'type' => 'required|in:raw,semi_finished,consumable',
            'material_category_id' => 'nullable|exists:material_categories,id', // Gói 22
            'minimum_stock' => 'nullable|numeric|min:0',
            'purchase_unit' => 'nullable|string|max:20',
            'conversion_rate' => 'nullable|numeric|min:0.0001',
        ]);

        // Có đơn vị nhập mà không có tỉ lệ -> báo lỗi
        if (!empty($validated['purchase_unit']) && empty($validated['conversion_rate'])) {
            return response()->json(['success' => false, 'message' => 'Nhập tỉ lệ quy đổi (VD: 1 chai = 750ml).'], 422);
        }

        $material = Material::create([
            'name' => $validated['name'],
            'unit' => $validated['unit'],
            'type' => $validated['type'],
            'material_category_id' => $validated['material_category_id'] ?? null, // Gói 22
            'minimum_stock' => $validated['minimum_stock'] ?? 0,
            'purchase_unit' => $validated['purchase_unit'] ?? null,
            'conversion_rate' => $validated['conversion_rate'] ?? 1,
        ]);

        return response()->json(['success' => true, 'data' => $material], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $material = Material::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:150',
            'unit' => 'sometimes|string|max:20',
            'material_category_id' => 'sometimes|nullable|exists:material_categories,id', // Gói 22
            'minimum_stock' => 'nullable|numeric|min:0',
            'purchase_unit' => 'nullable|string|max:20',
            'conversion_rate' => 'nullable|numeric|min:0.0001',
        ]);
        $material->update($validated);
        return response()->json(['success' => true, 'data' => $material]);
    }

    public function destroy(int $id): JsonResponse
    {
        // Gói 46: cho xóa khi tồn kho về 0 (xóa mềm, giữ lịch sử);
        // chặn khi còn trong định mức (BOM).
        $material = Material::findOrFail($id);

        // 1. Kiểm tra còn trong định mức món ăn / công thức chế biến không
        $productIds = \App\Models\Recipe::where('material_id', $id)->distinct()->pluck('product_id');
        $inProduction = \App\Models\ProductionRecipe::where('material_id', $id)
            ->orWhere('raw_material_id', $id)->exists();
        $dishCount = $productIds->count();
        if ($dishCount > 0 || $inProduction) {
            $extra = $inProduction ? ' và công thức chế biến' : '';
            return response()->json([
                'success' => false,
                'message' => "Không xóa được \"{$material->name}\": đang dùng trong {$dishCount} món{$extra}. Hãy gỡ khỏi định mức trước.",
            ], 422);
        }

        // 2. Kiểm tra tồn kho về 0 (mọi chi nhánh)
        $stock = (float) $material->batches()->sum('current_quantity');
        if ($stock > 0) {
            return response()->json([
                'success' => false,
                'message' => "Không xóa được \"{$material->name}\": tồn kho còn {$stock} {$material->unit}. Chỉ xóa được khi tồn về 0.",
            ], 422);
        }

        $material->delete(); // xóa mềm — lịch sử lô/phiếu vẫn giữ
        return response()->json(['success' => true, 'message' => "Đã xóa \"{$material->name}\" (lịch sử vẫn được giữ lại)."]);
    }
}
