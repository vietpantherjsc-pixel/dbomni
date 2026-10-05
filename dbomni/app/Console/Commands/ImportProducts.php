<?php

namespace App\Console\Commands;

use App\Models\Category;
use App\Models\Menu;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductPrice;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 7a (2026-10-05): Import mặt hàng chuẩn từ file Excel của quán.
// Dữ liệu đã được trích xuất sẵn thành database/seeders/data/products_import.json
// (kèm ảnh tải về public/images/products/).
// Chạy: php artisan import:products
// Idempotent: bỏ qua món đã tồn tại (theo slug).
class ImportProducts extends Command
{
    protected $signature = 'import:products {--fresh : Xóa dữ liệu món cũ trước khi import}';
    protected $description = 'Import 77 mặt hàng chuẩn từ file Excel (kèm danh mục, thực đơn, giá kênh)';

    public function handle(): int
    {
        $path = database_path('seeders/data/products_import.json');
        if (!file_exists($path)) {
            $this->error("Không tìm thấy file: {$path}");
            return 1;
        }
        $items = json_decode(file_get_contents($path), true);
        if (!is_array($items)) {
            $this->error('File JSON không hợp lệ.');
            return 1;
        }

        DB::transaction(function () use ($items) {
            if ($this->option('fresh')) {
                $this->warn('Xóa dữ liệu món cũ...');
                DB::table('menu_product')->delete();
                DB::table('product_prices')->delete();
                DB::table('product_option_group')->delete();
                Product::where('is_service_fee', false)->delete();
                Category::query()->delete();
                Menu::query()->delete();
            }

            // 1. Bảng giá kênh
            $lists = [
                'nha_hang' => 'Giá tại nhà hàng',
                'grabfood' => 'Giá GrabFood',
                'shopeefood' => 'Giá ShopeeFood',
                'greenfood' => 'Giá Green Food',
                'online' => 'Giá bán online',
            ];
            $listIds = [];
            foreach ($lists as $code => $name) {
                $listIds[$code] = PriceList::firstOrCreate(['code' => $code], ['name' => $name])->id;
            }

            // 2. Danh mục + thực đơn
            $catIds = [];
            $menuIds = [];
            foreach ($items as $it) {
                $catIds[$it['category']] = $catIds[$it['category']]
                    ?? Category::firstOrCreate(
                        ['name' => $it['category']],
                        ['slug' => Str::slug($it['category']), 'is_active' => true, 'sort_order' => count($catIds)]
                    )->id;
                foreach ($it['menus'] as $mName) {
                    $menuIds[$mName] = $menuIds[$mName]
                        ?? Menu::firstOrCreate(['name' => $mName], ['is_active' => true])->id;
                }
            }
            $this->info('Danh mục: ' . count($catIds) . ' | Thực đơn: ' . count($menuIds));

            // 3. Món
            $created = 0;
            $skipped = 0;
            foreach ($items as $it) {
                if (Product::where('slug', $it['slug'])->exists()) {
                    $skipped++;
                    continue;
                }
                $product = Product::create([
                    'category_id' => $catIds[$it['category']],
                    'name' => $it['name'],
                    'slug' => $it['slug'],
                    'sku' => $it['sku'],
                    'base_price' => $it['prices']['nha_hang'],
                    'cost_price' => $it['cost_price'],
                    'unit' => $it['unit'],
                    'tax_code' => $it['tax_code'] ?: null,
                    'barcode' => $it['barcode'] ?: null,
                    'print_label' => $it['print_label'],
                    'image_url' => $it['image'] ?: null,
                    'description' => $it['description'] ?: null,
                    'is_active' => true,
                    'sell_on_pos' => true,
                    'sell_on_zalo' => true,
                ]);

                // Thực đơn
                $product->menus()->sync(array_values(array_unique(array_map(
                    fn($m) => $menuIds[$m],
                    $it['menus']
                ))));

                // Giá kênh
                foreach ($it['prices'] as $code => $price) {
                    ProductPrice::create([
                        'product_id' => $product->id,
                        'price_list_id' => $listIds[$code],
                        'price' => $price,
                    ]);
                }
                $created++;
            }
            $this->info("Tạo mới: {$created} món | Bỏ qua (đã có): {$skipped} món");
        });

        $this->info('Import hoàn tất.');
        return 0;
    }
}
