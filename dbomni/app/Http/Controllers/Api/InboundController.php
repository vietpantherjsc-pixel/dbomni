<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Branch;
use App\Models\Material;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class InboundController extends Controller
{
    /**
     * Nhập lô nguyên vật liệu mới vào kho chi nhánh
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'material_id' => 'required|exists:materials,id',
            'quantity' => 'required|numeric|min:0.01',
            'unit_cost' => 'required|numeric|min:0',
            'expired_at' => 'nullable|date|after:today',
            'batch_code' => 'nullable|string|max:50',
        ]);

        $batchCode = $validated['batch_code'] ?? ('BATCH-' . strtoupper(Str::random(8)));

        $batch = Batch::create([
            'branch_id' => $validated['branch_id'],
            'material_id' => $validated['material_id'],
            'batch_code' => $batchCode,
            'initial_quantity' => $validated['quantity'],
            'current_quantity' => $validated['quantity'],
            'unit_cost' => $validated['unit_cost'],
            'expired_at' => $validated['expired_at'] ?? null,
            'status' => 'active',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Nhập kho thành công',
            'data' => $batch,
        ], 201);
    }
}