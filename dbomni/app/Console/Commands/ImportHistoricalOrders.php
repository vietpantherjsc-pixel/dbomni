<?php

namespace App\Console\Commands;

use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 7c (2026-10-05): Import 448 đơn lịch sử từ file Excel của quán.
// Dữ liệu: database/seeders/data/orders_import.json (+ legacy_products.json).
// Chạy: php artisan import:historical-orders
// - Đơn đã thanh toán -> completed/paid, đã hủy -> cancelled
// - stock_deducted = true (không trừ kho quá khứ)
// - Idempotent: bỏ qua mã đơn đã tồn tại.
class ImportHistoricalOrders extends Command
{
    protected $signature = 'import:historical-orders';
    protected $description = 'Import 448 đơn lịch sử từ file Excel';

    public function handle(): int
    {
        $path = database_path('seeders/data/orders_import.json');
        if (!file_exists($path)) {
            $this->error("Không tìm thấy file: {$path}");
            return 1;
        }
        $orders = json_decode(file_get_contents($path), true);

        $fallbackUser = User::first();
        if (!$fallbackUser) {
            $this->error('Chưa có user nào trong hệ thống.');
            return 1;
        }
        $branchId = DB::table('branches')->orderBy('id')->value('id');

        DB::transaction(function () use ($orders, $fallbackUser, $branchId) {
            // Món legacy (không có trong file mặt hàng chuẩn)
            $legacyNames = json_decode(file_get_contents(database_path('seeders/data/legacy_products.json')), true) ?? [];
            $legacyCat = Category::firstOrCreate(
                ['name' => 'Món import'],
                ['slug' => 'mon-import', 'is_active' => true, 'sort_order' => 99]
            );
            $legacyIds = [];
            foreach ($legacyNames as $name) {
                $p = Product::firstOrCreate(
                    ['name' => $name],
                    [
                        'category_id' => $legacyCat->id,
                        'slug' => Str::slug($name) . '-import',
                        'base_price' => 0,
                        'is_active' => false, // ẩn khỏi menu, chỉ phục vụ báo cáo
                        'sell_on_pos' => false,
                        'sell_on_zalo' => false,
                    ]
                );
                $legacyIds[$name] = $p->id;
            }
            $serviceFeeId = Product::where('is_service_fee', true)->value('id');

            $created = 0;
            $skipped = 0;
            foreach ($orders as $o) {
                if (Order::where('code', $o['code'])->exists()) {
                    $skipped++;
                    continue;
                }

                $user = $o['cashier']
                    ? User::where('name', 'like', '%' . $o['cashier'] . '%')->first()
                    : null;
                $userId = $user?->id ?? $fallbackUser->id;

                $customerId = null;
                if ($o['customer_phone']) {
                    $customer = Customer::firstOrCreate(
                        ['phone' => $o['customer_phone']],
                        ['name' => $o['customer_name'] ?: 'Khách lẻ', 'member_code' => 'IMP' . $o['customer_phone']]
                    );
                    $customerId = $customer->id;
                }

                $order = Order::create([
                    'user_id' => $userId,
                    'branch_id' => $branchId,
                    'order_type' => $this->mapType($o['service_type'], $o['source']),
                    'online_channel' => in_array($o['source'], ['Grabfood', 'ShopeeFood', 'Green Food']) ? 'grab' : 'pos',
                    'order_number' => $o['code'],
                    'code' => $o['code'],
                    'customer_id' => $customerId,
                    'customer_name' => $o['customer_name'] ?: null,
                    'customer_phone' => $o['customer_phone'] ?: null,
                    'subtotal_amount' => $o['subtotal'],
                    'discount_amount' => $o['discount'],
                    'total_amount' => $o['total'],
                    'status' => $o['status'] === 'Đã hủy' ? 'cancelled' : 'completed',
                    'payment_method' => $o['payment_method'] ?: null,
                    'payment_status' => $o['status'] === 'Đã hủy' ? 'unpaid' : 'paid',
                    'stock_deducted' => true, // đơn quá khứ: không trừ kho
                    'note' => $o['note'] ?: null,
                    'created_at' => $o['created_at'] ?: now(),
                    'updated_at' => $o['paid_at'] ?: ($o['created_at'] ?: now()),
                ]);

                foreach ($o['items'] as $it) {
                    $ref = $it['product_ref'];
                    $productId = match ($ref['type']) {
                        'master' => Product::where('name', $ref['name'])->value('id'),
                        'legacy' => $legacyIds[$ref['name']] ?? null,
                        'service_fee' => $serviceFeeId,
                        default => null,
                    };
                    OrderItem::create([
                        'order_id' => $order->id,
                        'product_id' => $productId,
                        'product_name' => $it['product_name'],
                        'price' => $it['price'],
                        'unit_price' => $it['price'],
                        'quantity' => (int) $it['qty'],
                        'subtotal' => $it['line_total'],
                        'total_price' => $it['line_total'],
                        'discount_amount' => $it['discount_total'],
                        'options' => array_map(fn($n) => ['name' => $n, 'price' => 0], $it['options']),
                        'note' => $it['note'] ?: null,
                        'created_at' => $order->created_at,
                        'updated_at' => $order->created_at,
                    ]);
                }
                $created++;
            }
            $this->info("Tạo: {$created} đơn | Bỏ qua (đã có): {$skipped} đơn");
        });

        $this->info('Import đơn lịch sử hoàn tất.');
        return 0;
    }

    private function mapType(string $serviceType, string $source): string
    {
        return match (true) {
            $serviceType === 'Ăn tại bàn' => 'dine_in',
            $serviceType === 'Giao hàng' || $source === 'Grabfood'
                || $source === 'ShopeeFood' || $source === 'Green Food' => 'delivery',
            default => 'takeaway',
        };
    }
}
