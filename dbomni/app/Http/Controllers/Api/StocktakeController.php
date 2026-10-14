<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Material;
use App\Models\Stocktake;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 4 (2026-10-04): Kiểm kê kho (ngày/tuần/tháng/đột xuất).
// Luồng: tạo phiếu (chụp tồn hệ thống) -> nhập số thực đếm -> chốt (chỉ GHI NHẬN chênh lệch, không tự điều chỉnh kho).
class StocktakeController extends Controller
{
    // Gói 19 (2026-10-09): Lịch sử kiểm kho — chốt phiếu chỉ GHI NHẬN chênh lệch,
    // KHÔNG tự động điều chỉnh tồn kho (quản lý quyết định xử lý sau).
    public function index(Request $request): JsonResponse
    {
        $query = Stocktake::with(['user', 'branch', 'items'])
            ->orderByRaw('checked_at IS NULL DESC')
            ->orderByDesc('checked_at')
            ->orderByDesc('id');
        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->query('branch_id'));
        }
        $list = $query->limit(50)->get()->map(function ($s) {
            $arr = $s->toArray();
            unset($arr['items']); // gọn payload danh sách
            $arr['total_items'] = $s->items->count();
            $arr['diff_items'] = $s->items->filter(function ($it) {
                return $it->counted_qty !== null
                    && abs((float) $it->counted_qty - (float) $it->system_qty) >= 0.005;
            })->count();
            return $arr;
        });
        return response()->json(['success' => true, 'data' => $list]);
    }

    public function show(int $id): JsonResponse
    {
        $stocktake = Stocktake::with(['items.material.category', 'user', 'branch'])->findOrFail($id); // Gói 22: kèm loại NL
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
            'data' => $stocktake->load('items.material.category'), // Gói 22
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

    // Chốt phiếu (Gói 19): ghi nhận chênh lệch vào lịch sử.
    // Gói 55 p11k: thêm tùy chọn with_balance=true để cân bằng kho theo số thực đếm.
    // Nhận ngày-giờ kiểm từ client (mặc định = hiện tại).
    public function confirm(int $id, Request $request): JsonResponse
    {
        $validated = $request->validate([
            'checked_at' => 'nullable|date',
            'with_balance' => 'nullable|boolean',
        ]);

        try {
            $result = DB::transaction(function () use ($id, $validated) {
                // Gói 55: withTrashed để không 500 khi NL bị xóa mềm sau khi tạo phiếu
                $stocktake = Stocktake::with([
                    'items' => fn ($q) => $q->lockForUpdate(),
                    'items.material' => fn ($q) => $q->withTrashed(),
                    'items.material.category',
                ])->lockForUpdate()->findOrFail($id);

                if ($stocktake->status !== 'draft') {
                    throw new Exception('Phiếu đã được chốt trước đó.');
                }

                // Gói 55 p11ac: chặn chốt phiếu trống
                if ($stocktake->items->isEmpty()) {
                    throw new Exception('Phiếu trống, không thể chốt.');
                }

                $uncounted = $stocktake->items->whereNull('counted_qty');
                if ($uncounted->isNotEmpty()) {
                    throw new Exception('Còn ' . $uncounted->count() . ' nguyên liệu chưa nhập số thực đếm.');
                }

                $rows = [];
                foreach ($stocktake->items as $item) {
                    $diff = (float) $item->counted_qty - (float) $item->system_qty;
                    $mat = $item->material; // Gói 55: null guard cho NL đã xóa mềm
                    $rows[] = [
                        'material_id' => $item->material_id,
                        'name' => $mat?->name ?? '(đã xóa)',
                        'unit' => $mat?->unit ?? '',
                        'type' => $mat?->type ?? null,
                        // Gói 22: snapshot loại NL tại lúc chốt (nhóm ảnh xuất theo loại)
                        'category_id' => $mat?->material_category_id,
                        'category_name' => $mat?->category?->name,
                        'system_qty' => (float) $item->system_qty,
                        'counted_qty' => (float) $item->counted_qty,
                        'diff' => $diff,
                    ];
                }

                $stocktake->status = 'confirmed';
                $stocktake->checked_at = $validated['checked_at'] ?? now();
                $stocktake->save();

                // Gói 55 p11k: cân bằng kho theo số thực đếm (điều chỉnh Batch về counted_qty)
                if (!empty($validated['with_balance'])) {
                    foreach ($stocktake->items as $item) {
                        $target = (float) $item->counted_qty;
                        $batches = Batch::where('branch_id', $stocktake->branch_id)
                            ->where('material_id', $item->material_id)
                            ->where('status', 'active')
                            ->orderByRaw('expired_at IS NULL, expired_at ASC, id ASC')
                            ->lockForUpdate()
                            ->get();
                        $total = (float) $batches->sum('current_quantity');
                        $diffQty = $target - $total;
                        if ($diffQty > 0) {
                            // Thiếu: tạo lô điều chỉnh tăng
                            Batch::create([
                                'branch_id' => $stocktake->branch_id,
                                'material_id' => $item->material_id,
                                'batch_code' => 'DC-ST' . $stocktake->id . '-' . $item->material_id,
                                'initial_quantity' => $diffQty,
                                'current_quantity' => $diffQty,
                                'unit_cost' => 0,
                                'status' => 'active',
                            ]);
                        } elseif ($diffQty < 0) {
                            // Thừa: trừ dần từ lô hết hạn trước (FIFO)
                            $need = abs($diffQty);
                            foreach ($batches as $b) {
                                if ($need <= 0) break;
                                $take = min((float) $b->current_quantity, $need);
                                $b->current_quantity = (float) $b->current_quantity - $take;
                                if ($b->current_quantity <= 0) $b->status = 'exhausted';
                                $b->save();
                                $need -= $take;
                            }
                        }
                    }
                }

                return [
                    'stocktake' => $stocktake->fresh()->load(['user', 'branch']),
                    'rows' => $rows,
                ];
            });

            // Gói 55 p11b: tổng giá trị chênh vượt ngưỡng → tự sinh đề xuất điều chỉnh (chờ duyệt)
            // Bọc try/catch để không làm hỏng kết quả chốt nếu sinh đề xuất lỗi
            $adjCount = 0;
            try {
                $adjCount = \App\Models\StocktakeAdjustment::createFromConfirmed(
                    $result['stocktake'], $result['rows'], $result['stocktake']->employee_id ?? null
                );
            } catch (\Exception $adjEx) {
                \Log::warning('Không tạo được đề xuất điều chỉnh kiểm kê #' . $result['stocktake']->id . ': ' . $adjEx->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Đã chốt kiểm kê và lưu lịch sử.'
                    . ($adjCount > 0 ? " Đã tạo {$adjCount} đề xuất điều chỉnh chờ duyệt." : ''),
                'data' => $result,
                'adjustments_created' => $adjCount,
            ]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }
}
