<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Support\CatalogCache;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    public function index()
    {
        // Lấy danh sách danh mục, sắp xếp theo sort_order
        return response()->json(Category::orderBy('sort_order')->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'slug' => 'required|string|unique:categories,slug',
            'sort_order' => 'integer',
            'is_active' => 'boolean'
        ]);

        $category = Category::create($validated);
        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json($category, 201);
    }

    public function show(Category $category)
    {
        return response()->json($category);
    }

    public function update(Request $request, Category $category)
    {
        $validated = $request->validate([
            'name' => 'string|max:255',
            'slug' => 'string|unique:categories,slug,' . $category->id,
            'sort_order' => 'integer',
            'is_active' => 'boolean'
        ]);

        $category->update($validated);
        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json($category);
    }

    public function destroy(Category $category)
    {
        $category->delete();
        CatalogCache::bump(); // Bộ nhớ đệm thực đơn: catalog đổi → đệm cũ vô hiệu.
        return response()->json(['message' => 'Đã xóa danh mục thành công']);
    }
}