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

    // Chốt phiếu (Gói 19): ghi nhận chênh lệch vào lịch sử, KHÔNG tự động điều chỉnh kho.
    // Nhận ngày-giờ kiểm từ client (mặc định = hiện tại).
    public function confirm(int $id, Request $request): JsonResponse
    {
        $validated = $request->validate([
            'checked_at' => 'nullable|date',
        ]);

        try {
            $result = DB::transaction(function () use ($id, $validated) {
                $stocktake = Stocktake::with('items.material.category')->lockForUpdate()->findOrFail($id);

                if ($stocktake->status !== 'draft') {
                    throw new Exception('Phiếu đã được chốt trước đó.');
                }

                $uncounted = $stocktake->items->whereNull('counted_qty');
                if ($uncounted->isNotEmpty()) {
                    throw new Exception('Còn ' . $uncounted->count() . ' nguyên liệu chưa nhập số thực đếm.');
                }

                $rows = [];
                foreach ($stocktake->items as $item) {
                    $diff = (float) $item->counted_qty - (float) $item->system_qty;
                    $rows[] = [
                        'material_id' => $item->material_id,
                        'name' => $item->material->name,
                        'unit' => $item->material->unit,
                        'type' => $item->material->type,
                        // Gói 22: snapshot loại NL tại lúc chốt (nhóm ảnh xuất theo loại)
                        'category_id' => $item->material->material_category_id,
                        'category_name' => $item->material->category?->name,
                        'system_qty' => (float) $item->system_qty,
                        'counted_qty' => (float) $item->counted_qty,
                        'diff' => $diff,
                    ];
                }

                $stocktake->status = 'confirmed';
                $stocktake->checked_at = $validated['checked_at'] ?? now();
                $stocktake->save();

                return [
                    'stocktake' => $stocktake->fresh()->load(['user', 'branch']),
                    'rows' => $rows,
                ];
            });

            return response()->json([
                'success' => true,
                'message' => 'Đã chốt kiểm kê và lưu lịch sử.',
                'data' => $result,
            ]);
        } catch (Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }
}
