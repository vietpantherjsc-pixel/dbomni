<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Unit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 52: CRUD đơn vị tính
class UnitController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => Unit::orderBy('name')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate(['name' => 'required|string|max:50|unique:units,name']);
        $u = Unit::create($v);
        return response()->json(['success' => true, 'data' => $u], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $u = Unit::findOrFail($id);
        $v = $request->validate(['name' => 'required|string|max:50|unique:units,name,' . $id]);
        $u->update($v);
        return response()->json(['success' => true, 'data' => $u]);
    }

    public function destroy(int $id): JsonResponse
    {
        // Chặn xóa nếu đang dùng trong sản phẩm
        $u = Unit::findOrFail($id);
        $used = \App\Models\Product::where('unit', $u->name)->exists();
        if ($used) {
            return response()->json(['success' => false, 'message' => 'Đơn vị đang dùng trong sản phẩm, không xóa được'], 422);
        }
        $u->delete();
        return response()->json(['success' => true]);
    }
}
