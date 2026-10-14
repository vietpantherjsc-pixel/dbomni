<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Material;
use App\Models\StockTransfer;
use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 43: chuyển kho nguyên liệu giữa các chi nhánh (kèm điều chỉnh giá vốn FIFO).
class StockTransferController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = StockTransfer::with(['fromBranch', 'toBranch', 'items.material'])
            ->orderByDesc('id');
        if ($request->filled('from_branch_id')) $q->where('from_branch_id', $request->input('from_branch_id'));
        if ($request->filled('to_branch_id')) $q->where('to_branch_id', $request->input('to_branch_id'));
        if ($request->filled('status')) $q->where('status', $request->input('status'));
        $per = min((int) $request->input('per_page', 20), 200);
        return response()->json(['success' => true, 'data' => $q->paginate($per)]);
    }

    public function show(int $id): JsonResponse
    {
        $t = StockTransfer::with(['fromBranch', 'toBranch', 'items.material', 'items.fromBatch', 'items.toBatch'])
            ->findOrFail($id);
        return response()->json(['success' => true, 'data' => $t]);
    }

    // Tạo phiếu nháp (chưa trừ/cộng kho)
    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $isEmployee = $actor instanceof \App\Models\Employee;
        $v = $request->validate([
            'from_branch_id' => ($isEmployee ? 'nullable' : 'required') . '|exists:branches,id|different:to_branch_id',
            'to_branch_id' => 'required|exists:branches,id',
            'note' => 'nullable|string|max:1000',
            'items' => 'required|array|min:1|max:200',
            'items.*.material_id' => 'required|exists:materials,id',
            'items.*.quantity' => 'required|numeric|min:0.001',
        ]);
        // Gói 55 p11aa: NV ép kho nguồn = chi nhánh của mình
        $fromBranchId = $isEmployee ? (int) $actor->branch_id : (int) $v['from_branch_id'];
        if ($fromBranchId === (int) $v['to_branch_id']) {
            return response()->json(['success' => false, 'message' => 'Kho nguồn và kho đích phải khác nhau.'], 422);
        }
        $transfer = DB::transaction(function () use ($v, $actor, $fromBranchId) {
            $t = StockTransfer::create([
                'code' => StockTransfer::nextCode(),
                'from_branch_id' => $fromBranchId,
                'to_branch_id' => $v['to_branch_id'],
                'status' => 'draft',
                'requested_by' => $actor && $actor instanceof \App\Models\User ? $actor->id : null,
                'note' => $v['note'] ?? null,
            ]);
            foreach ($v['items'] as $it) {
                $t->items()->create([
                    'material_id' => $it['material_id'],
                    'quantity' => $it['quantity'],
                ]);
            }
            return $t;
        });
        return response()->json(['success' => true, 'message' => 'Đã tạo phiếu chuyển kho.', 'data' => $transfer->load('items.material')], 201);
    }

    // Chốt: trừ kho nguồn (FIFO) + nhập kho đích (giữ nguyên giá vốn/HSD từng lô) trong 1 transaction
    public function confirm(int $id, Request $request, InventoryService $inv): JsonResponse
    {
        $actor = $request->user();
        try {
            $totalCost = DB::transaction(function () use ($id, $actor, $inv) {
                // Gói 55: lock row trong transaction trước khi check status (chống race condition)
                $t = StockTransfer::with('items')->lockForUpdate()->findOrFail($id);
                if ($t->status !== 'draft') {
                    throw new \Exception('Phiếu không ở trạng thái nháp.');
                }
                $needs = [];
                foreach ($t->items as $it) {
                    $needs[$it->material_id] = ($needs[$it->material_id] ?? 0) + (float) $it->quantity;
                }
                // Trừ nguồn, lấy chi tiết từng lô (ném Exception nếu tồn không đủ → chặn cứng)
                $deducted = $inv->deductMaterialsDetailed((int) $t->from_branch_id, $needs);
                $total = 0;
                $lotRows = []; // Gói 55: gom chi tiết lô để insert 1 lần (tránh last-wins)
                // Gộp theo nguyên liệu để tránh nhân đôi khi phiếu có 2 dòng cùng NL
                $consumed = [];
                foreach ($t->items as $it) {
                    $mid = $it->material_id;
                    if (!empty($consumed[$mid])) continue;
                    $consumed[$mid] = true;
                    $lines = $deducted[$mid] ?? [];
                    $first = true;
                    foreach ($lines as $ln) {
                        $cost = (float) $ln['quantity'] * (float) $ln['unit_cost'];
                        $total += $cost;
                        // Nhập đích: giữ nguyên giá vốn + HSD của lô nguồn
                        $toBatch = Batch::create([
                            'material_id' => $mid,
                            'branch_id' => $t->to_branch_id,
                            'batch_code' => $t->code, // Gói 55 p11w: $t->code đã có prefix CK-, không thêm nữa
                            'initial_quantity' => $ln['quantity'],
                            'current_quantity' => $ln['quantity'],
                            'unit_cost' => $ln['unit_cost'],
                            'expired_at' => $ln['expired_at'],
                            'status' => 'active',
                        ]);
                        // Gói 55: lưu chi tiết từng lô vào bảng stock_transfer_item_lots
                        $lotRows[] = [
                            'stock_transfer_item_id' => $it->id,
                            'batch_id' => $ln['batch_id'],
                            'to_batch_id' => $toBatch->id,
                            'quantity' => $ln['quantity'],
                            'unit_cost' => $ln['unit_cost'],
                            'created_at' => now(),
                            'updated_at' => now(),
                        ];
                        // Giữ tương thích: dòng đầu vẫn ghi tóm tắt vào item
                        if ($first) {
                            $it->update([
                                'unit_cost' => $ln['unit_cost'],
                                'from_batch_id' => $ln['batch_id'],
                                'to_batch_id' => $toBatch->id,
                            ]);
                            $first = false;
                        }
                    }
                }
                // Insert chi tiết lô 1 lần
                if (!empty($lotRows)) {
                    \App\Models\StockTransferItemLot::insert($lotRows);
                }
                $t->update([
                    'status' => 'confirmed',
                    'confirmed_by' => $actor && $actor instanceof \App\Models\User ? $actor->id : null,
                    'confirmed_at' => now(),
                    'total_cost' => $total,
                ]);
                return $total;
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
        return response()->json(['success' => true, 'message' => 'Đã chuyển kho.', 'data' => ['total_cost' => $totalCost]]);
    }

    public function cancel(int $id): JsonResponse
    {
        $t = StockTransfer::findOrFail($id);
        if ($t->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Chỉ hủy được phiếu nháp.'], 422);
        }
        $t->update(['status' => 'cancelled']);
        return response()->json(['success' => true, 'message' => 'Đã hủy phiếu chuyển kho.']);
    }

    // Tồn khả dụng của 1 nguyên liệu tại 1 chi nhánh (cho form tạo phiếu)
    public function stock(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'material_id' => 'required|exists:materials,id',
        ]);
        $qty = Batch::where('branch_id', $v['branch_id'])
            ->where('material_id', $v['material_id'])
            ->where('status', 'active')
            ->sum('current_quantity');
        $mat = Material::find($v['material_id']);
        return response()->json(['success' => true, 'data' => [
            'quantity' => (float) $qty,
            'unit' => $mat?->unit,
        ]]);
    }
}
