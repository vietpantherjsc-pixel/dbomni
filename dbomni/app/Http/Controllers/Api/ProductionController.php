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
            'batch_output_qty' => 'nullable|numeric|min:0.0001', // Gói 55 p11c: SL BTP mỗi mẻ
        ]);

        $material = Material::findOrFail($validated['material_id']);
        // Gói 55 p11o: bỏ gate type cũ — NL nào có định mức chế biến thì được coi là BTP

        $recipe = ProductionRecipe::updateOrCreate(
            ['material_id' => $validated['material_id'], 'raw_material_id' => $validated['raw_material_id']],
            [
                'quantity' => $validated['quantity'],
                'batch_output_qty' => $validated['batch_output_qty'] ?? null,
            ]
        );

        // Đồng bộ batch_output_qty cho tất cả dòng cùng BTP (định mức theo mẻ)
        if (isset($validated['batch_output_qty'])) {
            ProductionRecipe::where('material_id', $validated['material_id'])
                ->update(['batch_output_qty' => $validated['batch_output_qty']]);
        }

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
            'client_key' => 'nullable|string|max:64', // Gói 55 p11ac: idempotency
        ]);

        // Gói 55 p11ac: nếu client_key đã tồn tại → trả bản ghi cũ, không trừ kho lại
        if (!empty($validated['client_key'])) {
            $existing = Production::where('client_key', $validated['client_key'])->first();
            if ($existing) {
                return response()->json([
                    'success' => true,
                    'message' => 'Phiếu đã được tạo trước đó.',
                    'data' => $existing->load(['material', 'items.material']),
                    'duplicate' => true,
                ]);
            }
        }

        try {
            $movementIds = []; // Gói 55 p11af: nhận id nhật ký xuất kho để gắn production_id sau
            $production = DB::transaction(function () use ($validated, $inventoryService, &$movementIds) {
                $material = Material::findOrFail($validated['material_id']);
                // Gói 55 p11o: bỏ gate type cũ — check định mức bên dưới đã đủ

                $recipes = ProductionRecipe::where('material_id', $material->id)->get();
                if ($recipes->isEmpty()) {
                    throw new Exception("Chưa có định mức chế biến cho {$material->name}.");
                }

                $qty = (float) $validated['quantity'];

                // 1. Tính nguyên liệu thô cần trừ
                // Gói 55 p11c: định mức tính theo mẻ — quantity là NL cho 1 mẻ (batch_output_qty đơn vị BTP)
                $needs = [];
                foreach ($recipes as $r) {
                    $batchOut = (float) ($r->batch_output_qty ?: 1);
                    // Số mẻ = qty / batch_output_qty; NL cần = quantity_per_batch * số mẻ
                    $batches = $qty / $batchOut;
                    $needs[$r->raw_material_id] = ($needs[$r->raw_material_id] ?? 0) + (float) $r->quantity * $batches;
                }

                // 2. Trừ kho FIFO (ném Exception nếu thiếu)
                // Gói 55 p11af: ghi nhật ký xuất kho từng lô, gắn production_id sau khi tạo phiếu
                $inventoryService->deductMaterials(
                    $validated['branch_id'],
                    $needs,
                    ['type' => 'production', 'note' => 'Chế biến ' . $material->name],
                    $movementIds
                );

                // 3. Nhập lô mới cho bán thành phẩm
                $inventoryService->addStock($validated['branch_id'], $material->id, $qty);

                // 4. Lưu phiếu
                $production = Production::create([
                    'branch_id' => $validated['branch_id'],
                    'material_id' => $material->id,
                    'quantity' => $qty,
                    'user_id' => $request->user()->id,
                    'note' => $validated['note'] ?? null,
                    'client_key' => $validated['client_key'] ?? null, // Gói 55 p11ac
                ]);
                foreach ($needs as $rawId => $usedQty) {
                    $production->items()->create([
                        'material_id' => $rawId,
                        'quantity' => $usedQty,
                    ]);
                }
                // Gói 55 p11af: gắn production_id vào nhật ký xuất kho
                if (!empty($movementIds)) {
                    \App\Models\StockMovement::whereIn('id', $movementIds)->update(['reference_id' => $production->id]);
                }

                return $production->load(['material', 'items.material']);
            });

            return response()->json([
                'success' => true,
                'message' => 'Chế biến thành công, đã nhập lô bán thành phẩm mới.',
                'data' => $production,
            ], 201);
        } catch (Exception $e) {
            // Gói 55 p11ac: race 2 request cùng client_key → unique violation → trả bản ghi đã tạo
            if (!empty($validated['client_key']) && str_contains($e->getMessage(), 'client_key')) {
                $existing = Production::where('client_key', $validated['client_key'])->first();
                if ($existing) {
                    return response()->json([
                        'success' => true,
                        'message' => 'Phiếu đã được tạo trước đó.',
                        'data' => $existing->load(['material', 'items.material']),
                        'duplicate' => true,
                    ]);
                }
            }
            // Gói 55 p11w: log lỗi hệ thống trước khi trả về, tránh che lỗi thật
            \Log::error('ProductionController@produce failed', [
                'message' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'input' => $request->only(['branch_id', 'material_id', 'quantity']),
            ]);
            // Gói SEC2: không lộ message SQL thô ra client
            $message = $e instanceof \Illuminate\Database\QueryException
                ? 'Có lỗi xảy ra. Vui lòng thử lại.'
                : $e->getMessage();
            return response()->json(['success' => false, 'message' => $message], 400);
        }
    }
}
