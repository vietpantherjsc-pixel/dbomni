<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Material;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 1 (2026-10-04): Chuyển từ hệ ingredients cũ sang materials + batches.
// - stats(): cảnh báo tồn kho tính theo tổng các lô active (có lọc theo chi nhánh).
// - quickInwardStock(): nhập nhanh = tạo 1 lô (batch) mới, thay vì cộng dồn số tồn.
class AdminDashboardController extends Controller
{
    public function stats(Request $request): JsonResponse
    {
        $today = now()->startOfDay();
        $branchId = $request->query('branch_id');

        // 1. Chỉ số tổng quan trong ngày
        $todayOrdersQuery = Order::where('created_at', '>=', $today)
            ->where('status', '!=', 'cancelled');
        if ($branchId) {
            $todayOrdersQuery->where('branch_id', $branchId);
        }
        $todayOrders = $todayOrdersQuery->get();

        $todayRevenue = $todayOrders->sum('total_amount');
        $totalOrdersCount = $todayOrders->count();
        $averageOrderValue = $totalOrdersCount > 0 ? round($todayRevenue / $totalOrdersCount) : 0;

        // Doanh thu theo phương thức thanh toán
        $cashTotal = $todayOrders->where('payment_method', 'cash')->sum('total_amount');
        $transferTotal = $todayOrders->where('payment_method', 'transfer')->sum('total_amount');

        // 2. Top 5 sản phẩm bán chạy nhất
        $topProducts = OrderItem::select('product_id', DB::raw('SUM(quantity) as total_quantity'))
            ->whereHas('order', function ($query) use ($branchId) {
                $query->where('status', '!=', 'cancelled');
                if ($branchId) {
                    $query->where('branch_id', $branchId);
                }
            })
            ->with(['product:id,name,image_url,base_price'])
            ->groupBy('product_id')
            ->orderByDesc('total_quantity')
            ->limit(5)
            ->get()
            ->map(function ($item) {
                $productPrice = $item->product ? (float) $item->product->base_price : 0;
                $item->total_sales = $item->total_quantity * $productPrice;
                return $item;
            });

        // 3. Giám sát kho & cảnh báo thiếu hụt (theo tổng tồn các lô active)
        $materials = Material::with(['batches' => function ($q) use ($branchId) {
            $q->where('status', 'active');
            if ($branchId) {
                $q->where('branch_id', $branchId);
            }
        }])->orderBy('name')->get();

        $stockData = $materials->map(function ($material) {
            $stock = (float) $material->batches->sum('current_quantity');
            return [
                'id' => $material->id,
                'name' => $material->name,
                'unit' => $material->unit,
                'type' => $material->type,
                'minimum_stock' => (float) $material->minimum_stock,
                'current_stock' => $stock,
                'is_low_stock' => $stock <= (float) $material->minimum_stock,
            ];
        });

        $lowStockAlerts = $stockData->filter(fn($m) => $m['is_low_stock'])
            ->sortBy('current_stock')->values();

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
                'low_stock_alerts' => $lowStockAlerts,
                'all_materials' => $stockData->values(),
            ]
        ]);
    }
}
