<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Unit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 52: CRUD đơn vị tính
// Spec cài đặt danh sách (2026-10-21): thêm group/is_active/sort_order;
// mặc định chỉ trả đơn vị đang bật (nơi chọn đơn vị), admin truyền ?all=1 để thấy cả đã tắt.
class UnitController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Unit::orderBy('sort_order')->orderBy('name');
        if (!$request->boolean('all')) {
            $q->where('is_active', true);
        }
        return response()->json(['success' => true, 'data' => $q->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'name' => 'required|string|max:50|unique:units,name',
            'group' => 'nullable|in:count,mass,volume,other',
            'is_active' => 'boolean',
            'sort_order' => 'integer|min:0',
        ]);
        $v['group'] = $v['group'] ?? 'count';
        $u = Unit::create($v);
        return response()->json(['success' => true, 'data' => $u], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $u = Unit::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:50|unique:units,name,' . $id,
            'group' => 'nullable|in:count,mass,volume,other',
            'is_active' => 'boolean',
            'sort_order' => 'integer|min:0',
        ]);
        $u->update($v);
        return response()->json(['success' => true, 'data' => $u]);
    }

    public function destroy(int $id): JsonResponse
    {
        // Chặn xóa nếu đang dùng trong sản phẩm hoặc nguyên liệu
        $u = Unit::findOrFail($id);
        $used = \App\Models\Product::where('unit', $u->name)->exists()
            || \App\Models\Material::where('unit', $u->name)->exists();
        if ($used) {
            return response()->json(['success' => false, 'message' => 'Đơn vị đang được dùng (sản phẩm/nguyên liệu), không xóa được. Hãy tắt trạng thái thay vì xóa.'], 422);
        }
        $u->delete();
        return response()->json(['success' => true]);
    }
}
