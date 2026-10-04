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

class SampleDataSeeder extends Seeder
{
    /**
     * Khởi tạo dữ liệu mẫu cho hệ thống F&B.
     */
    public function run(): void
    {
        // 1. Tạo Chi nhánh mẫu
        $branch = Branch::create([
            'code' => 'CN-Q1',
            'name' => 'Chi nhánh Quận 1 - Hồ Chí Minh',
            'phone' => '0901234567',
            'address' => 'Số 123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1',
            'latitude' => 10.776889,
            'longitude' => 106.700806,
            'is_active' => true,
        ]);

        // 2. Tạo Danh mục sản phẩm
        $catCoffee = Category::create([
            'name' => 'Cà phê',
            'slug' => 'ca-phe',
            'order' => 1,
            'is_active' => true,
        ]);

        $catTea = Category::create([
            'name' => 'Trà trái cây',
            'slug' => 'tra-trai-cay',
            'order' => 2,
            'is_active' => true,
        ]);

        // 3. Tạo Nguyên vật liệu kho
        $coffeeBean = Material::create([
            'name' => 'Hạt cà phê Robusta',
            'unit' => 'g',
            'type' => 'raw',
            'minimum_stock' => 1000,
        ]);

        $condensedMilk = Material::create([
            'name' => 'Sữa đặc Ngôi sao Phương Nam',
            'unit' => 'ml',
            'type' => 'raw',
            'minimum_stock' => 500,
        ]);

        $cup = Material::create([
            'name' => 'Ly nhựa 500ml kèm nắp',
            'unit' => 'cái',
            'type' => 'consumable',
            'minimum_stock' => 100,
        ]);

        // 4. Nhập kho theo lô (Batch) vào chi nhánh Q1
        Batch::create([
            'material_id' => $coffeeBean->id,
            'branch_id' => $branch->id,
            'batch_code' => 'BATCH-CF-001',
            'initial_quantity' => 10000, // 10kg
            'current_quantity' => 10000,
            'unit_cost' => 250, // 250đ / g
            'expired_at' => now()->addMonths(6),
            'status' => 'active',
        ]);

        Batch::create([
            'material_id' => $condensedMilk->id,
            'branch_id' => $branch->id,
            'batch_code' => 'BATCH-SM-001',
            'initial_quantity' => 5000, // 5000ml
            'current_quantity' => 5000,
            'unit_cost' => 80, // 80đ / ml
            'expired_at' => now()->addMonths(3),
            'status' => 'active',
        ]);

        Batch::create([
            'material_id' => $cup->id,
            'branch_id' => $branch->id,
            'batch_code' => 'BATCH-CUP-001',
            'initial_quantity' => 500,
            'current_quantity' => 500,
            'unit_cost' => 1200, // 1.200đ / cái
            'expired_at' => null,
            'status' => 'active',
        ]);

        // 5. Tạo Sản phẩm
        $product = Product::create([
            'category_id' => $catCoffee->id,
            'sku' => 'CF-SUADA-01',
            'name' => 'Cà phê sữa đá truyền thống',
            'alias' => 'Nâu đá',
            'price' => 35000,
            'image_url' => 'https://placehold.co/400x400/png?text=Ca+Phe+Sua+Da',
            'description' => 'Cà phê Robusta rang đậm kết hợp sữa đặc thơm béo',
            'unit' => 'Ly',
            'tax_percent' => 8.00,
            'is_tax_inclusive' => true,
            'is_active' => true,
        ]);

        // 6. Tạo Tùy chọn món (Options/Topping)
        $optSizeL = ProductOption::create([
            'product_id' => $product->id,
            'name' => 'Nâng cấp Size L (+10k)',
            'additional_price' => 10000,
            'is_required' => false,
        ]);

        // 7. Thiết lập BOM / Định lượng công thức (Recipe) cho 1 ly size thường
        Recipe::create([
            'product_id' => $product->id,
            'product_option_id' => null,
            'material_id' => $coffeeBean->id,
            'quantity' => 25, // 25g cà phê
        ]);

        Recipe::create([
            'product_id' => $product->id,
            'product_option_id' => null,
            'material_id' => $condensedMilk->id,
            'quantity' => 40, // 40ml sữa đặc
        ]);

        Recipe::create([
            'product_id' => $product->id,
            'product_option_id' => null,
            'material_id' => $cup->id,
            'quantity' => 1, // 1 cái ly
        ]);
    }
}