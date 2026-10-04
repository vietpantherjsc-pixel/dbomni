<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Ingredient;
use App\Models\Recipe;
use App\Models\Product;

class InventoryDemoSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Tạo danh sách nguyên liệu thô
        $ingArabica = Ingredient::updateOrCreate(
            ['name' => 'Hạt Cà Phê Arabica Cầu Đất'],
            ['unit' => 'gram', 'cost_per_unit' => 350, 'current_stock' => 5000, 'min_stock_alert' => 500] // 350đ/g = 350k/kg
        );

        $ingRobusta = Ingredient::updateOrCreate(
            ['name' => 'Hạt Cà Phê Robusta Buôn Mê'],
            ['unit' => 'gram', 'cost_per_unit' => 220, 'current_stock' => 10000, 'min_stock_alert' => 1000] // 220đ/g
        );

        $ingFreshMilk = Ingredient::updateOrCreate(
            ['name' => 'Sữa Tươi Tiệt Trùng'],
            ['unit' => 'ml', 'cost_per_unit' => 38, 'current_stock' => 15000, 'min_stock_alert' => 2000] // 38đ/ml = 38k/lít
        );

        $ingCondensedMilk = Ingredient::updateOrCreate(
            ['name' => 'Sữa Đặc Ngôi Sao'],
            ['unit' => 'ml', 'cost_per_unit' => 55, 'current_stock' => 5000, 'min_stock_alert' => 500]
        );

        $ingOolongTea = Ingredient::updateOrCreate(
            ['name' => 'Cốt Trà Ô Long Nướng'],
            ['unit' => 'ml', 'cost_per_unit' => 45, 'current_stock' => 8000, 'min_stock_alert' => 1000]
        );

        // 2. Gán công thức (Recipe) cho các món mẫu
        // Ví dụ: Cold Brew Cam Vàng (cần 25g Arabica)
        $coldBrew = Product::where('name', 'like', '%Cold Brew%')->first();
        if ($coldBrew) {
            Recipe::updateOrCreate(
                ['product_id' => $coldBrew->id, 'ingredient_id' => $ingArabica->id],
                ['amount' => 25] // 25 gram
            );
        }

        // Ví dụ: Cà Phê Sữa Tươi Cốt Dừa (cần 20g Robusta + 120ml Sữa tươi + 25ml Sữa đặc)
        $cfSuaDua = Product::where('name', 'like', '%Cốt Dừa%')->first();
        if ($cfSuaDua) {
            Recipe::updateOrCreate(
                ['product_id' => $cfSuaDua->id, 'ingredient_id' => $ingRobusta->id],
                ['amount' => 20]
            );
            Recipe::updateOrCreate(
                ['product_id' => $cfSuaDua->id, 'ingredient_id' => $ingFreshMilk->id],
                ['amount' => 120]
            );
            Recipe::updateOrCreate(
                ['product_id' => $cfSuaDua->id, 'ingredient_id' => $ingCondensedMilk->id],
                ['amount' => 25]
            );
        }

        // Ví dụ: Trà Sữa Ô Long Nướng (cần 150ml Cốt trà ô long + 80ml Sữa tươi)
        $traSua = Product::where('name', 'like', '%Trà Sữa Ô Long%')->first();
        if ($traSua) {
            Recipe::updateOrCreate(
                ['product_id' => $traSua->id, 'ingredient_id' => $ingOolongTea->id],
                ['amount' => 150]
            );
            Recipe::updateOrCreate(
                ['product_id' => $traSua->id, 'ingredient_id' => $ingFreshMilk->id],
                ['amount' => 80]
            );
        }
    }
}