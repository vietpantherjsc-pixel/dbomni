<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Material;
use App\Models\Transaction;
use App\Models\TransactionCategory;
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
     * Gói 27 (2026-10-09): tự sinh phiếu chi "Đã thanh toán" khi nhập kho
     * (quyết định của Đại Vương: danh mục "Nhập hàng").
     * Idempotent: cặp (related_type, related_id) đã có phiếu thì không tạo trùng.
     */
    private function createAutoExpense(int $branchId, float $amount, int $relatedId, string $note): void
    {
        $exists = Transaction::where('related_type', 'inbound')
            ->where('related_id', $relatedId)
            ->exists();
        if ($exists) {
            return;
        }
        $cat = TransactionCategory::firstOrCreate(
            ['name' => 'Nhập hàng', 'type' => 'expense'],
            ['is_system' => true]
        );
        Transaction::create([
            'code' => Transaction::nextCode('expense'),
            'type' => 'expense',
            'category_id' => $cat->id,
            'branch_id' => $branchId,
            'amount' => $amount,
            'paid_amount' => $amount, // Gói 29: phiếu tự sinh đã thanh toán -> còn nợ = 0
            'paid_at' => now()->toDateString(),
            'status' => 'paid',
            'note' => $note,
            'created_by' => auth()->id(),
        ]);
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
            $created = $this->createBatch($validated['branch_id'], $validated);
            // Gói 27: tự sinh phiếu chi "Đã thanh toán" theo tổng tiền phiếu nhập.
            $amount = (float) $validated['purchase_quantity'] * (float) ($validated['unit_cost'] ?? 0);
            if ($amount > 0) {
                $this->createAutoExpense(
                    $validated['branch_id'],
                    $amount,
                    $created['batch']->id,
                    "Tự sinh từ phiếu nhập kho {$created['batch']->batch_code} ({$created['material']})"
                );
            }
            return $created;
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
            // Gói 27: 1 phiếu chi duy nhất cho cả đợt nhập nhiều dòng.
            $total = 0;
            foreach ($validated['items'] as $item) {
                $total += (float) $item['purchase_quantity'] * (float) ($item['unit_cost'] ?? 0);
            }
            if ($total > 0 && !empty($out)) {
                $codes = implode(', ', array_map(fn($r) => $r['batch']->batch_code, $out));
                $this->createAutoExpense(
                    $validated['branch_id'],
                    $total,
                    $out[0]['batch']->id,
                    'Tự sinh từ phiếu nhập kho nhiều dòng (' . count($out) . ' dòng): ' . $codes
                );
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
