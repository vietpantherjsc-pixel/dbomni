<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Menu;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 7g (2026-10-05): Thực đơn hiển thị cho POS và Mini App.
// - Theo bảng `menus` (cột T file Excel), sắp xếp theo sort_order
// - Món trong thực đơn sắp xếp theo menu_product.sort_order
// - Kèm nhóm tùy chọn (Size/Độ ngọt/Đá/Topping)
// - ?unique=1 (Mini App): món thuộc nhiều thực đơn chỉ hiện 1 lần ở thực đơn
//   xếp trên cùng; ẩn thực đơn không có món.
class DisplayMenuController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        // Gói 10c: route online (Mini App) ẩn món "giá nhập khi chọn món";
        // POS (route web) vẫn hiện để thu ngân bấm và nhập giá.
        $isOnline = $request->is('api/online/*');

        $menus = Menu::where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->with(['products' => function ($q) use ($isOnline) {
                $q->where('products.is_active', true)
                    ->where('products.is_service_fee', false)
                    ->when($isOnline, fn($qq) => $qq->where('products.price_on_demand', false))
                    ->orderBy('menu_product.sort_order')
                    ->orderBy('products.name')
                    ->with(['options', 'optionGroups' => function ($qq) {
                        $qq->where('is_active', true)->with(['options' => fn($qqq) => $qqq->orderBy('id')]);
                    }]);
            }])
            ->get();

        if ($request->boolean('unique')) {
            $seen = [];
            $menus = $menus->map(function ($menu) use (&$seen) {
                $menu->setRelation('products', $menu->products->reject(
                    function ($p) use (&$seen) {
                        if (isset($seen[$p->id])) {
                            return true;
                        }
                        $seen[$p->id] = true;
                        return false;
                    }
                )->values());
                return $menu;
            })->filter(fn($m) => $m->products->isNotEmpty())->values();
        }

        return response()->json(['success' => true, 'data' => $menus]);
    }
}
