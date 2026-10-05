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
                'sapo' => $this->sapoOverview($request, $branchId),
            ]
        ]);
    }

    /**
     * Gói 2 (2026-10-04): Số liệu kiểu Sapo cho trang Tổng quan.
     * - range: today | 7d | 30d
     * - Các chỉ số chưa có dữ liệu (giảm giá, thuế, khách hàng) trả về null -> frontend hiện "N/A".
     */
    private function sapoOverview(Request $request, $branchId): array
    {
        $range = $request->query('range', 'today');
        $from = match ($range) {
            '7d' => now()->subDays(6)->startOfDay(),
            '30d' => now()->subDays(29)->startOfDay(),
            default => now()->startOfDay(),
        };

        $baseQuery = Order::where('created_at', '>=', $from);
        if ($branchId) {
            $baseQuery->where('branch_id', $branchId);
        }

        $validOrders = (clone $baseQuery)->where('status', '!=', 'cancelled')->get();
        $cancelledTotal = (clone $baseQuery)->where('status', 'cancelled')->sum('total_amount');

        $grossSales = (float) $validOrders->sum('total_amount');
        $ordersCount = $validOrders->count();
        $totalItems = $ordersCount > 0
            ? (float) OrderItem::whereIn('order_id', $validOrders->pluck('id'))->sum('quantity')
            : 0;

        // Dữ liệu biểu đồ: theo giờ (today) hoặc theo ngày (7d/30d)
        $chartData = [];
        if ($range === 'today') {
            for ($h = 0; $h < 24; $h++) {
                $hourRevenue = $validOrders
                    ->filter(fn($o) => (int) $o->created_at->format('H') === $h)
                    ->sum('total_amount');
                $chartData[] = [
                    'label' => sprintf('%02d:00', $h),
                    'revenue' => (float) $hourRevenue,
                ];
            }
        } else {
            $days = $range === '7d' ? 7 : 30;
            for ($d = $days - 1; $d >= 0; $d--) {
                $date = now()->subDays($d)->startOfDay();
                $dayRevenue = $validOrders
                    ->filter(fn($o) => $o->created_at >= $date && $o->created_at < $date->copy()->addDay())
                    ->sum('total_amount');
                $chartData[] = [
                    'label' => $date->format('d/m'),
                    'revenue' => (float) $dayRevenue,
                ];
            }
        }

        return [
            'range' => $range,
            'gross_sales' => $grossSales,          // Tiền hàng
            'cancelled_total' => (float) $cancelledTotal, // Hoàn hủy
            'discount_total' => null,              // Giảm giá: chưa có dữ liệu
            'tax_total' => null,                  // Thuế phí: chưa có dữ liệu
            'revenue' => $grossSales,             // Doanh thu gồm thuế
            'customers_count' => null,            // Số khách hàng: chưa có CRM
            'orders_count' => $ordersCount,       // Số hóa đơn
            'avg_items_per_order' => $ordersCount > 0 ? round($totalItems / $ordersCount, 1) : 0,
            'avg_revenue_per_order' => $ordersCount > 0 ? round($grossSales / $ordersCount) : 0,
            'chart' => $chartData,
        ];
    }
}
