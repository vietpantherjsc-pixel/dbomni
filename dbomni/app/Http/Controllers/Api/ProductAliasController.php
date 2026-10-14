<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProductAlias;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 55: CRUD tên thay thế món (alias) — map tên cũ về món hiện tại
class ProductAliasController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = ProductAlias::with('product:id,name')->orderBy('id', 'desc');
        if ($pid = $request->query('product_id')) {
            $q->where('product_id', $pid);
        }
        return response()->json(['success' => true, 'data' => $q->paginate(50)]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'product_id' => 'required|exists:products,id',
            'alias_name' => 'required|string|max:255',
        ]);
        $v['alias_name'] = trim($v['alias_name']);
        $a = ProductAlias::firstOrCreate(
            ['product_id' => $v['product_id'], 'alias_name' => $v['alias_name']]
        );
        return response()->json(['success' => true, 'data' => $a->load('product:id,name')], 201);
    }

    public function destroy(int $id): JsonResponse
    {
        ProductAlias::findOrFail($id)->delete();
        return response()->json(['success' => true]);
    }
}
