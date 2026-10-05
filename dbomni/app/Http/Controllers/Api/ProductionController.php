<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Material;
use App\Models\Production;
use App\Models\ProductionRecipe;
use App\Services\InventoryService;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 4 (2026-10-04): Định mức + phiếu chế biến bán thành phẩm
// (ủ cốt cà phê/trà, nấu trân châu, làm kem...).
class ProductionController extends Controller
{
    // Danh sách định mức chế biến (kèm tên nguyên liệu)
    public function recipes(Request $request): JsonResponse
    {
        $query = ProductionRecipe::with(['material', 'rawMaterial'])->orderBy('material_id');
        if ($request->filled('material_id')) {
            $query->where('material_id', $request->query('material_id'));
        }
        return response()->json(['success' => true, 'data' => $query->get()]);
    }

    // Thêm/sửa định mức: 1 đơn vị bán thành phẩm cần bao nhiêu nguyên liệu thô
    public function storeRecipe(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'material_id' => 'required|exists:materials,id',
            'raw_material_id' => 'required|exists:materials,id|different:material_id',
            'quantity' => 'required|numeric|min:0.0001',
        ]);

        $material = Material::findOrFail($validated['material_id']);
        if ($material->type !== 'semi_finished') {
            return response()->json(['success' => false, 'message' => 'Đầu ra phải là bán thành phẩm.'], 422);
        }

        $recipe = ProductionRecipe::updateOrCreate(
            ['material_id' => $validated['material_id'], 'raw_material_id' => $validated['raw_material_id']],
            ['quantity' => $validated['quantity']]
        );

        return response()->json(['success' => true, 'data' => $recipe->load(['material', 'rawMaterial'])], 201);
    }

    public function destroyRecipe(int $id): JsonResponse
    {
        ProductionRecipe::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa định mức']);
    }

    // Lịch sử phiếu chế biến
    public function index(Request $request): JsonResponse
    {
        $query = Production::with(['material', 'user', 'items.material'])->orderByDesc('id');
        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->query('branch_id'));
        }
        return response()->json(['success' => true, 'data' => $query->limit(50)->get()]);
    }

    /**
     * Tạo phiếu chế biến:
     * - Trừ nguyên liệu thô theo định mức (FIFO)
     * - Nhập 1 lô mới cho bán thành phẩm
     */
    public function produce(Request $request, InventoryService $inventoryService): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'material_id' => 'required|exists:materials,id',
            'quantity' => 'required|numeric|min:0.01',
            'note' => 'nullable|string|max:255',
        ]);

        try {
            $production = DB::transaction(function () use ($validated, $inventoryService) {
                $material = Material::findOrFail($validated['material_id']);
                if ($material->type !== 'semi_finished') {
                    throw new Exception('Chỉ chế biến được bán thành phẩm.');
                }

                $recipes = ProductionRecipe::where('material_id', $material->id)->get();
                if ($recipes->isEmpty()) {
                    throw new Exception("Chưa có định mức chế biến cho {$material->name}.");
                }

                $qty = (float) $validated['quantity'];

                // 1. Tính nguyên liệu thô cần trừ
                $needs = [];
                foreach ($recipes as $r) {
                    $needs[$r->raw_material_id] = ($needs[$r->raw_material_id] ?? 0) + (float) $r->quantity * $qty;
                }

                // 2. Trừ kho FIFO (ném Exception nếu thiếu)
                $inventoryService->deductMaterials($validated['branch_id'], $needs);

                // 3. Nhập lô mới cho bán thành phẩm
                $batch = $inventoryService->addStock($validated['branch_id'], $material->id, $qty);

                // 4. Lưu phiếu
                $production = Production::create([
                    'branch_id' => $validated['branch_id'],
                    'material_id' => $material->id,
                    'quantity' => $qty,
                    'user_id' => $request->user()->id,
                    'note' => $validated['note'] ?? null,
                ]);
                foreach ($needs as $rawId => $usedQty) {
                    $production->items()->create([
                        'material_id' => $rawId,
                        'quantity' => $usedQty,
                    ]);
                }

                return $production->load(['material', 'items.material']);
            });

            return response()->json([
                'success' => true,
                'message' => 'Chế biến thành công, đã nhập lô bán thành phẩm mới.',
                'data' => $production,
            ], 201);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }
}
