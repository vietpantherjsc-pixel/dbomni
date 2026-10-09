<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\BranchMenuHidden;
use App\Models\BranchProductHidden;
use App\Models\Menu;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 25 (2026-10-09): ẩn/hiện mặt hàng & thực đơn theo chi nhánh.
// Mặc định HIỆN ở tất cả CN -> bảng chỉ lưu override ẨN.
class BranchVisibilityController extends Controller
{
    /** Ma trận hiển thị mặt hàng: branches + products + cặp (branch_id, product_id) đang ẩn. */
    public function productMatrix(): JsonResponse
    {
        $branches = Branch::where('is_active', true)->orderBy('id')->get(['id', 'name']);
        $products = Product::orderBy('name')->get(['id', 'name']);
        $hidden = BranchProductHidden::all()->map(fn($r) => [$r->branch_id, $r->product_id])->values();
        return response()->json(['success' => true, 'data' => compact('branches', 'products', 'hidden')]);
    }

    /** Bật/tắt ẩn 1 món ở 1 CN. */
    public function toggleProduct(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'product_id' => 'required|exists:products,id',
            'hidden' => 'required|boolean',
        ]);
        if ($v['hidden']) {
            BranchProductHidden::firstOrCreate([
                'branch_id' => $v['branch_id'],
                'product_id' => $v['product_id'],
            ]);
        } else {
            BranchProductHidden::where('branch_id', $v['branch_id'])
                ->where('product_id', $v['product_id'])->delete();
        }
        return response()->json(['success' => true]);
    }

    /** Đồng bộ cả cột 1 CN: $request->product_ids = danh sách product_id đang ẩn. */
    public function syncProducts(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'product_ids' => 'nullable|array',
            'product_ids.*' => 'exists:products,id',
        ]);
        DB::transaction(function () use ($v) {
            BranchProductHidden::where('branch_id', $v['branch_id'])->delete();
            foreach ($v['product_ids'] ?? [] as $pid) {
                BranchProductHidden::create(['branch_id' => $v['branch_id'], 'product_id' => $pid]);
            }
        });
        return response()->json(['success' => true]);
    }

    /** Ma trận hiển thị thực đơn. */
    public function menuMatrix(): JsonResponse
    {
        $branches = Branch::where('is_active', true)->orderBy('id')->get(['id', 'name']);
        $menus = Menu::withCount('products')->orderBy('sort_order')->orderBy('id')->get(['id', 'name']);
        $hidden = BranchMenuHidden::all()->map(fn($r) => [$r->branch_id, $r->menu_id])->values();
        return response()->json(['success' => true, 'data' => compact('branches', 'menus', 'hidden')]);
    }

    /** Bật/tắt ẩn 1 thực đơn ở 1 CN. */
    public function toggleMenu(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'menu_id' => 'required|exists:menus,id',
            'hidden' => 'required|boolean',
        ]);
        if ($v['hidden']) {
            BranchMenuHidden::firstOrCreate([
                'branch_id' => $v['branch_id'],
                'menu_id' => $v['menu_id'],
            ]);
        } else {
            BranchMenuHidden::where('branch_id', $v['branch_id'])
                ->where('menu_id', $v['menu_id'])->delete();
        }
        return response()->json(['success' => true]);
    }

    /** Đồng bộ cả cột 1 CN: $request->menu_ids = danh sách menu_id đang ẩn. */
    public function syncMenus(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'menu_ids' => 'nullable|array',
            'menu_ids.*' => 'exists:menus,id',
        ]);
        DB::transaction(function () use ($v) {
            BranchMenuHidden::where('branch_id', $v['branch_id'])->delete();
            foreach ($v['menu_ids'] ?? [] as $mid) {
                BranchMenuHidden::create(['branch_id' => $v['branch_id'], 'menu_id' => $mid]);
            }
        });
        return response()->json(['success' => true]);
    }
}
