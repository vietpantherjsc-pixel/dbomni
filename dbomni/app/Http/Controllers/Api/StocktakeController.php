<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Material;
use App\Models\Stocktake;
use App\Services\InventoryService;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 4 (2026-10-04): Kiểm kê kho (ngày/tuần/tháng/đột xuất).
// Luồng: tạo phiếu (chụp tồn hệ thống) -> nhập số thực đếm -> chốt (điều chỉnh kho).
class StocktakeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Stocktake::with(['user', 'branch'])->orderByDesc('id');
        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->query('branch_id'));
        }
        return response()->json(['success' => true, 'data' => $query->limit(50)->get()]);
    }

    public function show(int $id): JsonResponse
    {
        $stocktake = Stocktake::with(['items.material', 'user', 'branch'])->findOrFail($id);
        return response()->json(['success' => true, 'data' => $stocktake]);
    }

    // Tạo phiếu kiểm kê + chụp tồn hệ thống
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'type' => 'nullable|in:daily,weekly,monthly,spontaneous',
            'note' => 'nullable|string|max:255',
            'material_ids' => 'nullable|array',
            'material_ids.*' => 'exists:materials,id',
        ]);

        $stocktake = DB::transaction(function () use ($validated, $request) {
            $stocktake = Stocktake::create([
                'branch_id' => $validated['branch_id'],
                'user_id' => $request->user()->id,
                'type' => $validated['type'] ?? 'spontaneous',
                'status' => 'draft',
                'note' => $validated['note'] ?? null,
            ]);

            $materials = !empty($validated['material_ids'])
                ? Material::whereIn('id', $validated['material_ids'])->get()
                : Material::all();

            foreach ($materials as $material) {
                $systemQty = (float) Batch::where('branch_id', $validated['branch_id'])
                    ->where('material_id', $material->id)
                    ->where('status', 'active')
                    ->sum('current_quantity');
                $stocktake->items()->create([
                    'material_id' => $material->id,
                    'system_qty' => $systemQty,
                    'counted_qty' => null,
                ]);
            }

            return $stocktake;
        });

        return response()->json([
            'success' => true,
            'message' => 'Đã tạo phiếu kiểm kê',
            'data' => $stocktake->load('items.material'),
        ], 201);
    }

    // Nhập số lượng thực đếm (có thể nhập nhiều lần trước khi chốt)
    public function updateCounts(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.stocktake_item_id' => 'required|exists:stocktake_items,id',
            'items.*.counted_qty' => 'required|numeric|min:0',
        ]);

        $stocktake = Stocktake::findOrFail($id);
        if ($stocktake->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt, không thể sửa.'], 400);
        }

        DB::transaction(function () use ($stocktake, $validated) {
            foreach ($validated['items'] as $row) {
                $item = $stocktake->items()->where('id', $row['stocktake_item_id'])->firstOrFail();
                $item->counted_qty = $row['counted_qty'];
                $item->save();
            }
        });

        return response()->json(['success' => true, 'message' => 'Đã lưu số liệu kiểm đếm']);
    }

    // Chốt phiếu: điều chỉnh kho theo chênh lệch
    public function confirm(int $id, InventoryService $inventoryService): JsonResponse
    {
        try {
            $result = DB::transaction(function () use ($id, $inventoryService) {
                $stocktake = Stocktake::with('items.material')->lockForUpdate()->findOrFail($id);

                if ($stocktake->status !== 'draft') {
                    throw new Exception('Phiếu đã được chốt trước đó.');
                }

                $uncounted = $stocktake->items->whereNull('counted_qty');
                if ($uncounted->isNotEmpty()) {
                    throw new Exception('Còn ' . $uncounted->count() . ' nguyên liệu chưa nhập số thực đếm.');
                }

                $adjustments = [];
                foreach ($stocktake->items as $item) {
                    $diff = (float) $item->counted_qty - (float) $item->system_qty;
                    if (abs($diff) < 0.005) {
                        continue; // không chênh lệch
                    }

                    if ($diff < 0) {
                        // Thiếu: trừ kho FIFO
                        $inventoryService->deductMaterials($stocktake->branch_id, [$item->material_id => abs($diff)]);
                    } else {
                        // Thừa: nhập lô điều chỉnh mới
                        $inventoryService->addStock(
                            $stocktake->branch_id,
                            $item->material_id,
                            $diff,
                            'KK-' . date('Ymd') . '-' . strtoupper(\Illuminate\Support\Str::random(5))
                        );
                    }

                    $adjustments[] = [
                        'material' => $item->material->name,
                        'unit' => $item->material->unit,
                        'system' => (float) $item->system_qty,
                        'counted' => (float) $item->counted_qty,
                        'diff' => $diff,
                    ];
                }

                $stocktake->status = 'confirmed';
                $stocktake->save();

                return $adjustments;
            });

            return response()->json([
                'success' => true,
                'message' => 'Đã chốt kiểm kê và điều chỉnh kho.',
                'data' => $result,
            ]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }
}
