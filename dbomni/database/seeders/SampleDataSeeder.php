<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\Material;
use App\Models\Batch;
use App\Models\Recipe;

// Gói 1 (2026-10-04): Viết lại cho khớp schema hiện tại.
// Dữ liệu mẫu tối thiểu để test full luồng: nhập kho -> mở ca -> bán hàng (trừ kho FIFO) -> KDS.
// Chạy: php artisan db:seed --class=SampleDataSeeder
class SampleDataSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Chi nhánh mẫu
        $branch = Branch::firstOrCreate(
            ['code' => 'CN-Q1'],
            [
                'name' => 'Chi nhánh Quận 1 - Hồ Chí Minh',
                'phone' => '0901234567',
                'address' => 'Số 123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1',
                'latitude' => 10.776889,
                'longitude' => 106.700806,
                'is_active' => true,
            ]
        );

        // 2. Danh mục
        $catCoffee = Category::firstOrCreate(
            ['slug' => 'ca-phe'],
            ['name' => 'Cà phê', 'sort_order' => 1, 'is_active' => true]
        );
        $catTea = Category::firstOrCreate(
            ['slug' => 'tra-trai-cay'],
            ['name' => 'Trà trái cây', 'sort_order' => 2, 'is_active' => true]
        );

        // 3. Nguyên vật liệu
        $coffeeBean = Material::firstOrCreate(
            ['name' => 'Hạt cà phê Robusta'],
            ['unit' => 'g', 'type' => 'raw', 'minimum_stock' => 1000]
        );
        $condensedMilk = Material::firstOrCreate(
            ['name' => 'Sữa đặc Ngôi sao Phương Nam'],
            ['unit' => 'ml', 'type' => 'raw', 'minimum_stock' => 500]
        );
        $sugar = Material::firstOrCreate(
            ['name' => 'Đường cát trắng'],
            ['unit' => 'g', 'type' => 'raw', 'minimum_stock' => 500]
        );
        $cup = Material::firstOrCreate(
            ['name' => 'Ly nhựa 500ml kèm nắp'],
            ['unit' => 'cái', 'type' => 'consumable', 'minimum_stock' => 100]
        );

        // 4. Nhập kho theo lô vào chi nhánh Q1
        $batches = [
            [$coffeeBean, 'BATCH-CF-001', 10000, 250, now()->addMonths(6)],   // 10kg, 250đ/g
            [$condensedMilk, 'BATCH-SM-001', 5000, 80, now()->addMonths(3)],  // 5000ml, 80đ/ml
            [$sugar, 'BATCH-SG-001', 5000, 25, now()->addMonths(12)],         // 5kg đường, 25đ/g
            [$cup, 'BATCH-CUP-001', 500, 1200, null],                          // 500 ly, 1200đ/cái
        ];
        foreach ($batches as [$material, $code, $qty, $cost, $expired]) {
            Batch::firstOrCreate(
                ['batch_code' => $code],
                [
                    'material_id' => $material->id,
                    'branch_id' => $branch->id,
                    'initial_quantity' => $qty,
                    'current_quantity' => $qty,
                    'unit_cost' => $cost,
                    'expired_at' => $expired,
                    'status' => 'active',
                ]
            );
        }

        // 5. Sản phẩm: Cà phê sữa đá
        $product = Product::firstOrCreate(
            ['slug' => 'ca-phe-sua-da-truyen-thong'],
            [
                'category_id' => $catCoffee->id,
                'sku' => 'CF-SUADA-01',
                'name' => 'Cà phê sữa đá truyền thống',
                'base_price' => 35000,
                'image_url' => 'https://placehold.co/400x400/png?text=Ca+Phe+Sua+Da',
                'description' => 'Cà phê Robusta rang đậm kết hợp sữa đặc thơm béo',
                'is_active' => true,
                'sell_on_pos' => true,
                'sell_on_zalo' => true,
            ]
        );

        // 6. Tùy chọn: Size L
        $optSizeL = ProductOption::firstOrCreate(
            ['product_id' => $product->id, 'name' => 'Nâng cấp Size L (+10k)'],
            ['additional_price' => 10000, 'is_required' => false]
        );

        // 7. Định mức (BOM) cho 1 ly size thường
        $recipes = [
            [null, $coffeeBean->id, 25],      // 25g cà phê
            [null, $condensedMilk->id, 40],  // 40ml sữa đặc
            [null, $sugar->id, 10],          // 10g đường
            [null, $cup->id, 1],             // 1 ly
        ];
        foreach ($recipes as [$optionId, $materialId, $qty]) {
            Recipe::firstOrCreate(
                [
                    'product_id' => $product->id,
                    'product_option_id' => $optionId,
                    'material_id' => $materialId,
                ],
                ['quantity' => $qty]
            );
        }

        // 8. Định mức thêm khi chọn Size L (thêm cà phê + sữa)
        Recipe::firstOrCreate(
            [
                'product_id' => $product->id,
                'product_option_id' => $optSizeL->id,
                'material_id' => $coffeeBean->id,
            ],
            ['quantity' => 10] // +10g cà phê
        );
        Recipe::firstOrCreate(
            [
                'product_id' => $product->id,
                'product_option_id' => $optSizeL->id,
                'material_id' => $condensedMilk->id,
            ],
            ['quantity' => 15] // +15ml sữa đặc
        );

        $this->command->info('SampleDataSeeder: đã tạo dữ liệu mẫu (CN-Q1, 2 danh mục, 1 món + Size L, 4 nguyên liệu, 4 lô nhập, BOM).');
    }
}
