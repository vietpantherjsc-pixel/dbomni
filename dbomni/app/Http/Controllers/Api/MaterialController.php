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
        $materials = Material::orderBy('type')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $materials]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'unit' => 'required|string|max:20',
            'type' => 'required|in:raw,semi_finished,consumable',
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
            'minimum_stock' => 'nullable|numeric|min:0',
            'purchase_unit' => 'nullable|string|max:20',
            'conversion_rate' => 'nullable|numeric|min:0.0001',
        ]);
        $material->update($validated);
        return response()->json(['success' => true, 'data' => $material]);
    }

    public function destroy(int $id): JsonResponse
    {
        $material = Material::findOrFail($id);
        if ($material->batches()->exists()) {
            return response()->json(['success' => false, 'message' => 'Nguyên liệu đã có lô nhập, không thể xóa.'], 400);
        }
        $material->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa nguyên liệu']);
    }
}
