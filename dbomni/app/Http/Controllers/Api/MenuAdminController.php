<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Menu;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 7f (2026-10-05): Quản lý Thực đơn (hiển thị trên POS/App đặt hàng).
// - CRUD thực đơn, kéo-thả đổi thứ tự thực đơn
// - Thêm/bớt món trong thực đơn, kéo-thả đổi thứ tự món
class MenuAdminController extends Controller
{
    public function index(): JsonResponse
    {
        $menus = Menu::withCount('products')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
        return response()->json(['success' => true, 'data' => $menus]);
    }

    public function show(int $id): JsonResponse
    {
        $menu = Menu::with(['products' => function ($q) {
            $q->select('products.id', 'products.name', 'products.base_price', 'products.image_url')
                ->orderBy('menu_product.sort_order')
                ->orderBy('products.name');
        }])->findOrFail($id);
        return response()->json(['success' => true, 'data' => $menu]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'name' => 'required|string|max:150|unique:menus,name',
            'description' => 'nullable|string|max:255',
        ]);
        $menu = Menu::create($v + ['sort_order' => Menu::max('sort_order') + 1]);
        return response()->json(['success' => true, 'message' => 'Đã tạo thực đơn.', 'data' => $menu], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $menu = Menu::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:150|unique:menus,name,' . $id,
            'description' => 'nullable|string|max:255',
            'is_active' => 'boolean',
        ]);
        $menu->update($v);
        return response()->json(['success' => true, 'message' => 'Đã cập nhật.', 'data' => $menu]);
    }

    public function destroy(int $id): JsonResponse
    {
        Menu::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa thực đơn.']);
    }

    // Kéo-thả đổi thứ tự thực đơn: {ordered_ids: [3,1,2]}
    public function reorder(Request $request): JsonResponse
    {
        $v = $request->validate(['ordered_ids' => 'required|array', 'ordered_ids.*' => 'integer|exists:menus,id']);
        DB::transaction(function () use ($v) {
            foreach ($v['ordered_ids'] as $i => $id) {
                Menu::where('id', $id)->update(['sort_order' => $i]);
            }
        });
        return response()->json(['success' => true, 'message' => 'Đã lưu thứ tự.']);
    }

    // Thêm món vào thực đơn
    public function attachProduct(Request $request, int $id): JsonResponse
    {
        $menu = Menu::findOrFail($id);
        $v = $request->validate(['product_id' => 'required|integer|exists:products,id']);
        $max = DB::table('menu_product')->where('menu_id', $id)->max('sort_order') ?? -1;
        $menu->products()->syncWithoutDetaching([$v['product_id'] => ['sort_order' => $max + 1]]);
        return response()->json(['success' => true, 'message' => 'Đã thêm món vào thực đơn.']);
    }

    // Bớt món khỏi thực đơn
    public function detachProduct(int $id, int $productId): JsonResponse
    {
        Menu::findOrFail($id)->products()->detach($productId);
        return response()->json(['success' => true, 'message' => 'Đã bớt món khỏi thực đơn.']);
    }

    // Kéo-thả đổi thứ tự món trong thực đơn: {ordered_ids: [...]}
    public function reorderProducts(Request $request, int $id): JsonResponse
    {
        $menu = Menu::findOrFail($id);
        $v = $request->validate(['ordered_ids' => 'required|array', 'ordered_ids.*' => 'integer']);
        DB::transaction(function () use ($menu, $v) {
            foreach ($v['ordered_ids'] as $i => $pid) {
                DB::table('menu_product')
                    ->where('menu_id', $menu->id)
                    ->where('product_id', $pid)
                    ->update(['sort_order' => $i]);
            }
        });
        return response()->json(['success' => true, 'message' => 'Đã lưu thứ tự món.']);
    }

    // Tìm món để thêm (loại món đã có trong thực đơn)
    public function searchProducts(Request $request, int $id): JsonResponse
    {
        $menu = Menu::findOrFail($id);
        $q = $request->get('q', '');
        $exclude = $menu->products()->pluck('products.id');
        $products = Product::where('is_active', true)
            ->whereNotIn('id', $exclude)
            ->when($q, fn($qq) => $qq->where('name', 'like', "%{$q}%"))
            ->orderBy('name')
            ->limit(20)
            ->get(['id', 'name', 'base_price', 'image_url']);
        return response()->json(['success' => true, 'data' => $products]);
    }
}
