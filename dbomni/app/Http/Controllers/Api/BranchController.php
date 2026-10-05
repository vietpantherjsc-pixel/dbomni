<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 1 (2026-10-04): Endpoint tra cứu chi nhánh cho các dropdown (POS, nhập kho...).
class BranchController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => Branch::orderBy('name')->get(),
        ]);
    }

    // Gói 6: cập nhật địa chỉ + tọa độ chi nhánh (để tính phí ship cho Mini App)
    public function update(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'nullable|string|max:100',
            'address' => 'nullable|string|max:255',
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            'cover_url' => 'nullable|string|max:500', // Gói 10f: cover riêng Mini App (null = dùng chung)
        ]);
        $branch = Branch::findOrFail($id);
        $branch->update($validated);
        return response()->json(['success' => true, 'message' => 'Đã cập nhật chi nhánh.', 'data' => $branch]);
    }

    // Gói 6: tạo chi nhánh mới
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => 'required|string|max:50|unique:branches,code',
            'name' => 'required|string|max:150',
            'phone' => 'nullable|string|max:20',
            'address' => 'required|string|max:255',
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
        ]);
        $branch = Branch::create($validated);
        return response()->json(['success' => true, 'message' => 'Đã tạo chi nhánh.', 'data' => $branch], 201);
    }
}
