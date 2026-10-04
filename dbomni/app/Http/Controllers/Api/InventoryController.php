<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Material;
use Illuminate\Http\JsonResponse;

class InventoryController extends Controller
{
    /**
     * Báo cáo tồn kho theo chi nhánh và cảnh báo nguyên liệu sắp hết
     */
    public function getStockByBranch(int $branchId): JsonResponse
    {
        $branch = Branch::findOrFail($branchId);

        $materials = Material::with(['batches' => function ($query) use ($branchId) {
            $query->where('branch_id', $branchId)
                  ->where('status', 'active');
        }])->get();

        $report = $materials->map(function ($material) {
            $currentStock = $material->batches->sum('current_quantity');
            $isLowStock = $currentStock <= $material->minimum_stock;

            return [
                'material_id' => $material->id,
                'name' => $material->name,
                'unit' => $material->unit,
                'type' => $material->type,
                'minimum_stock' => (float) $material->minimum_stock,
                'current_stock' => (float) $currentStock,
                'is_low_stock' => $isLowStock,
                'batches_count' => $material->batches->count(),
            ];
        });

        return response()->json([
            'success' => true,
            'branch' => [
                'id' => $branch->id,
                'name' => $branch->name,
            ],
            'data' => $report,
        ], 200);
    }
}