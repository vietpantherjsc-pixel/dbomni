<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Ingredient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminDashboardController extends Controller
{
    public function stats(Request $request)
    {
        $today = now()->startOfDay();

        // 1. Chỉ số tổng quan trong ngày
        $todayOrders = Order::where('created_at', '>=', $today)
            ->where('status', '!=', 'cancelled')
            ->get();

        $todayRevenue = $todayOrders->sum('total_amount');
        $totalOrdersCount = $todayOrders->count();
        $averageOrderValue = $totalOrdersCount > 0 ? round($todayRevenue / $totalOrdersCount) : 0;

        // Doanh thu theo phương thức thanh toán
        $cashTotal = $todayOrders->where('payment_method', 'cash')->sum('total_amount');
        $transferTotal = $todayOrders->where('payment_method', 'transfer')->sum('total_amount');

        // 2. Top 5 sản phẩm bán chạy nhất
        $topProducts = OrderItem::select('product_id', DB::raw('SUM(quantity) as total_quantity'))
            ->whereHas('order', function ($query) {
                $query->where('status', '!=', 'cancelled');
            })
            ->with(['product:id,name,image_url,price'])
            ->groupBy('product_id')
            ->orderByDesc('total_quantity')
            ->limit(5)
            ->get()
            ->map(function ($item) {
                // Tính total_sales dựa trên giá niêm yết của sản phẩm nếu bảng order_items không lưu price
                $productPrice = $item->product ? (float) $item->product->price : 0;
                $item->total_sales = $item->total_quantity * $productPrice;
                return $item;
            });

        // 3. Giám sát kho & Cảnh báo thiếu hụt nguyên vật liệu
        $lowStockIngredients = Ingredient::whereColumn('current_stock', '<=', 'min_stock_alert')
            ->orderBy('current_stock', 'asc')
            ->get();

        $allIngredients = Ingredient::orderBy('name', 'asc')->get();

        return response()->json([
            'success' => true,
            'data' => [
                'overview' => [
                    'today_revenue' => $todayRevenue,
                    'today_orders_count' => $totalOrdersCount,
                    'average_order_value' => $averageOrderValue,
                    'cash_revenue' => $cashTotal,
                    'transfer_revenue' => $transferTotal,
                ],
                'top_products' => $topProducts,
                'low_stock_alerts' => $lowStockIngredients,
                'all_ingredients' => $allIngredients,
            ]
        ]);
    }

    // Nhập hàng nhanh cho nguyên vật liệu
    public function quickInwardStock(Request $request)
    {
        $request->validate([
            'ingredient_id' => 'required|exists:ingredients,id',
            'quantity' => 'required|numeric|min:0.01',
            'cost_per_unit' => 'nullable|numeric|min:0',
        ]);

        $ingredient = Ingredient::findOrFail($request->ingredient_id);
        $ingredient->current_stock += $request->quantity;
        
        if ($request->filled('cost_per_unit')) {
            $ingredient->cost_per_unit = $request->cost_per_unit;
        }
        $ingredient->save();

        return response()->json([
            'success' => true,
            'message' => "Đã nhập thêm {$request->quantity} {$ingredient->unit} cho {$ingredient->name}",
            'data' => $ingredient
        ]);
    }
}