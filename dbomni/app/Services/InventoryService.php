<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Ingredient;
use App\Models\Recipe;
use App\Models\InventoryLog;
use Illuminate\Support\Facades\DB;

class InventoryService
{
    /**
     * Tự động trừ nguyên vật liệu thô khi đơn hàng hoàn tất pha chế
     */
    public function deductStockForOrder(Order $order): void
    {
        DB::transaction(function () use ($order) {
            foreach ($order->items as $item) {
                $recipes = Recipe::where('product_id', $item->product_id)->get();

                foreach ($recipes as $recipe) {
                    $totalDeduct = $recipe->amount * $item->quantity;

                    // Khóa dòng để tránh tranh chấp dữ liệu khi nhiều đơn bấm cùng lúc
                    $ingredient = Ingredient::lockForUpdate()->find($recipe->ingredient_id);
                    if ($ingredient) {
                        $ingredient->current_stock -= $totalDeduct;
                        $ingredient->save();

                        // Ghi lại lịch sử trừ kho
                        InventoryLog::create([
                            'ingredient_id' => $ingredient->id,
                            'type' => 'auto_order',
                            'quantity_change' => -$totalDeduct,
                            'stock_after' => $ingredient->current_stock,
                            'note' => "Trừ tự động từ đơn {$order->code} ({$item->quantity} món)",
                        ]);
                    }
                }
            }
        });
    }

    /**
     * Tính toán giá vốn (COGS) của 1 sản phẩm dựa trên công thức nguyên liệu
     */
    public function calculateProductCost(int $productId): float
    {
        $recipes = Recipe::with('ingredient')->where('product_id', $productId)->get();
        $totalCost = 0;

        foreach ($recipes as $recipe) {
            if ($recipe->ingredient) {
                $totalCost += ($recipe->amount * $recipe->ingredient->cost_per_unit);
            }
        }

        return round($totalCost, 2);
    }
}