<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MaterialCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 22 (2026-10-09): CRUD loại danh mục nguyên liệu.
class MaterialCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        $cats = MaterialCategory::withCount('materials')
            ->orderBy('sort_order')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $cats]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'sort_order' => 'nullable|integer',
        ]);
        $cat = MaterialCategory::create([
            'name' => $validated['name'],
            'sort_order' => $validated['sort_order'] ?? ((int) MaterialCategory::max('sort_order') + 1),
        ]);
        return response()->json(['success' => true, 'data' => $cat], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $cat = MaterialCategory::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'sort_order' => 'nullable|integer',
        ]);
        $cat->update($validated);
        return response()->json(['success' => true, 'data' => $cat]);
    }

    // Sắp xếp lại thứ tự: nhận mảng id theo thứ tự mong muốn
    public function reorder(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'exists:material_categories,id',
        ]);
        foreach ($validated['ids'] as $i => $id) {
            MaterialCategory::where('id', $id)->update(['sort_order' => $i + 1]);
        }
        return response()->json(['success' => true, 'message' => 'Đã sắp xếp lại thứ tự.']);
    }

    public function destroy(int $id): JsonResponse
    {
        $cat = MaterialCategory::findOrFail($id);
        if ($cat->materials()->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Loại này đang có nguyên liệu, không thể xóa. Hãy chuyển nguyên liệu sang loại khác trước.',
            ], 400);
        }
        $cat->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa loại nguyên liệu']);
    }
}
