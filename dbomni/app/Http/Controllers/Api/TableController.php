<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Table;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 3 (2026-10-04): CRUD bàn phục vụ (bản gọn).
class TableController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Table::query()->orderBy('name');
        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->query('branch_id'));
        }
        return response()->json(['success' => true, 'data' => $query->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'name' => 'required|string|max:50',
        ]);

        $table = Table::create([
            'branch_id' => $validated['branch_id'],
            'name' => $validated['name'],
            'status' => 'empty',
        ]);

        return response()->json(['success' => true, 'data' => $table], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $table = Table::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:50',
            'status' => 'sometimes|in:empty,occupied',
        ]);
        $table->update($validated);

        return response()->json(['success' => true, 'data' => $table]);
    }

    public function destroy(int $id): JsonResponse
    {
        Table::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa bàn']);
    }
}
