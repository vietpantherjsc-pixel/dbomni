<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Material;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class InboundController extends Controller
{
    /**
     * Tạo 1 lô nhập từ dữ liệu đã validate (dùng chung cho nhập lẻ và nhập nhiều dòng).
     * Gói 4: hỗ trợ đơn vị quy đổi — nhập theo đơn vị mua (chai/kg/túi),
     * hệ thống tự quy về đơn vị cơ sở (ml/g) theo tỉ lệ của nguyên liệu.
     */
    private function createBatch(int $branchId, array $item): array
    {
        $material = Material::findOrFail($item['material_id']);

        // Quy đổi về đơn vị cơ sở
        $rate = (float) ($material->conversion_rate ?: 1);
        $baseQuantity = (float) $item['purchase_quantity'] * $rate;
        $purchaseUnit = $material->purchase_unit ?: $material->unit;

        $batchCode = $item['batch_code'] ?? ('BATCH-' . strtoupper(Str::random(8)));

        $batch = Batch::create([
            'branch_id' => $branchId,
            'material_id' => $item['material_id'],
            'batch_code' => $batchCode,
            'initial_quantity' => $baseQuantity,
            'current_quantity' => $baseQuantity,
            'unit_cost' => $item['unit_cost'] ?? 0,
            'expired_at' => $item['expired_at'] ?? null,
            'status' => 'active',
        ]);

        return [
            'material' => $material->name,
            'purchase' => (float) $item['purchase_quantity'] . ' ' . $purchaseUnit,
            'base' => $baseQuantity . ' ' . $material->unit,
            'batch' => $batch,
        ];
    }

    /**
     * Nhập 1 lô nguyên vật liệu vào kho chi nhánh.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'material_id' => 'required|exists:materials,id',
            'purchase_quantity' => 'required|numeric|min:0.01',
            'unit_cost' => 'required|numeric|min:0',
            'expired_at' => 'nullable|date|after:today',
            'batch_code' => 'nullable|string|max:50',
        ]);

        $result = DB::transaction(function () use ($validated) {
            return $this->createBatch($validated['branch_id'], $validated);
        });

        return response()->json([
            'success' => true,
            'message' => "Nhập kho thành công: {$result['purchase']} = {$result['base']}",
            'data' => $result['batch'],
        ], 201);
    }

    /**
     * Gói 4 (2026-10-04): Nhập kho NHIỀU DÒNG 1 lần — tiện khi nhập đơn hàng nhiều món.
     * Toàn bộ các dòng được tạo trong 1 transaction.
     */
    public function storeBulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'items' => 'required|array|min:1|max:100',
            'items.*.material_id' => 'required|exists:materials,id',
            'items.*.purchase_quantity' => 'required|numeric|min:0.01',
            'items.*.unit_cost' => 'nullable|numeric|min:0',
            'items.*.expired_at' => 'nullable|date|after:today',
            'items.*.batch_code' => 'nullable|string|max:50',
        ]);

        $results = DB::transaction(function () use ($validated) {
            $out = [];
            foreach ($validated['items'] as $item) {
                $out[] = $this->createBatch($validated['branch_id'], $item);
            }
            return $out;
        });

        $lines = array_map(fn($r) => "{$r['material']}: {$r['purchase']} = {$r['base']}", $results);

        return response()->json([
            'success' => true,
            'message' => 'Đã nhập kho ' . count($results) . " mặt hàng:\n" . implode("\n", $lines),
            'data' => array_column($results, 'batch'),
        ], 201);
    }
}
