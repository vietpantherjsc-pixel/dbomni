<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Employee;
use App\Models\Material;
use App\Models\Partner;
use App\Models\Production;
use App\Models\ProductionItem;
use App\Models\ProductionRecipe;
use App\Models\Stocktake;
use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 43: API kho cho nhân viên (3 trang mobile /kiem-ke, /che-bien, /nhap-kho).
// Mọi endpoint ép branch_id từ token NV, không nhận từ client.
class EmployeeInventoryController extends Controller
{
    private function emp(Request $request): Employee
    {
        /** @var Employee $emp */
        $emp = $request->user();
        return $emp;
    }

    // ---------- Danh mục dùng chung ----------

    // Gói 55 p11t: chi nhánh kiểm kê — mặc định = chi nhánh ca đang chấm công
    public function branches(Request $request): JsonResponse
    {
        $emp = $this->emp($request);
        // Ca đang làm: chấm công hôm nay có check_in chưa check_out
        $shift = \App\Models\Attendance::where('employee_id', $emp->id)
            ->whereDate('date', now()->toDateString())
            ->whereNotNull('check_in')
            ->whereNull('check_out')
            ->latest('id')->first();
        $currentBranchId = $shift?->branch_id ?? $emp->branch_id;
        // Các chi nhánh NV được phép kiểm kê
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $branchIds = array_unique($branchIds);
        $branches = \App\Models\Branch::whereIn('id', $branchIds)->orderBy('name')->get(['id', 'name']);
        // Kèm danh sách loại nguyên liệu để lọc
        $categories = \App\Models\MaterialCategory::orderBy('sort_order')->orderBy('name')->get(['id', 'name', 'sort_order']);
        return response()->json([
            'success' => true,
            'data' => [
                'branches' => $branches,
                'current_branch_id' => (int) $currentBranchId,
                'categories' => $categories,
            ],
        ]);
    }

    public function materials(Request $request): JsonResponse
    {
        $data = Material::with('category:id,name,sort_order')
            ->orderBy('name')
            ->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'name' => $m->name,
                'unit' => $m->unit,
                'type' => $m->type,
                'category_name' => $m->category?->name,
                'category_sort' => (int) ($m->category?->sort_order ?? 999), // Gói 55 p11g: thứ tự hiển thị
                'material_category_id' => $m->material_category_id, // Gói 55 p11w
                'is_active' => (bool) $m->is_active, // Gói 55 p11w
                'purchase_unit' => $m->purchase_unit,
                'conversion_rate' => (float) ($m->conversion_rate ?: 1),
            ]);
        return response()->json(['success' => true, 'data' => $data]);
    }

    public function suppliers(Request $request): JsonResponse
    {
        $data = Partner::where('type', 'supplier')->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'phone']);
        return response()->json(['success' => true, 'data' => $data]);
    }

    // ---------- Kiểm kê ----------

    public function stocktakes(Request $request): JsonResponse
    {
        $emp = $this->emp($request);
        // Gói 55: hiện phiếu của tất cả CN NV được phép (không chỉ CN mặc định)
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $branchIds = array_unique($branchIds);
        $list = Stocktake::whereIn('branch_id', $branchIds)
            ->with('branch:id,name')
            ->orderByDesc('id')->limit(20)->get()
            ->map(fn ($s) => [
                'id' => $s->id,
                'type' => $s->type,
                'status' => $s->status,
                'note' => $s->note,
                'checked_at' => $s->checked_at,
                'created_at' => $s->created_at,
                'branch_name' => $s->branch?->name,
                'total_items' => $s->items()->count(),
                'counted_items' => $s->items()->whereNotNull('counted_qty')->count(),
            ]);
        return response()->json(['success' => true, 'data' => $list]);
    }

    public function storeStocktake(Request $request): JsonResponse
    {
        $emp = $this->emp($request);
        $v = $request->validate([
            'type' => 'nullable|in:daily,weekly,monthly,spontaneous',
            'note' => 'nullable|string|max:255',
            'branch_id' => 'nullable|exists:branches,id', // Gói 55 p11t: chọn chi nhánh
            'category_ids' => 'nullable|array', // Gói 55 p11t: lọc theo loại NL
            'category_ids.*' => 'exists:material_categories,id',
        ]);
        // Chi nhánh kiểm kê: ưu tiên param, mặc định = chi nhánh NV
        $branchId = $v['branch_id'] ?? $emp->branch_id;
        // Gói 55: validate quyền chi nhánh (NV chỉ được kiểm kê CN mình được phân công)
        $allowedBranchIds = $emp->branches()->pluck('branches.id')->map(fn ($i) => (int) $i)->toArray();
        if ($emp->branch_id) $allowedBranchIds[] = (int) $emp->branch_id;
        $allowedBranchIds = array_unique($allowedBranchIds);
        if (!in_array((int) $branchId, $allowedBranchIds, true)) {
            return response()->json(['success' => false, 'message' => 'Bạn không có quyền kiểm kê chi nhánh này.'], 403);
        }
        $catIds = !empty($v['category_ids']) ? array_map('intval', $v['category_ids']) : null;
        // Nếu đã có phiếu nháp hôm nay của CN → kiểm tra có khớp bộ lọc không
        $existing = Stocktake::where('branch_id', $branchId)
            ->where('status', 'draft')
            ->whereDate('created_at', now()->toDateString())
            ->latest('id')->first();
        if ($existing) {
            // Gói 55 p11v: nếu có chọn loại NL mà phiếu cũ không khớp → xóa phiếu cũ tạo mới
            if ($catIds !== null) {
                $existingCatIds = $existing->items()
                    ->join('materials', 'stocktake_items.material_id', '=', 'materials.id')
                    ->distinct()->pluck('materials.material_category_id')
                    ->map(fn ($c) => (int) $c)->filter()->values()->toArray();
                sort($existingCatIds);
                $sortedCatIds = $catIds;
                sort($sortedCatIds);
                if ($existingCatIds !== $sortedCatIds) {
                    // Xóa phiếu cũ (chưa chốt) để tạo mới theo bộ lọc
                    $existing->items()->delete();
                    $existing->delete();
                    $existing = null;
                }
            }
            if ($existing) {
                // Gói 55 p11t: withTrashed để hiện tên NL đã xóa mềm
                return response()->json(['success' => true, 'data' => $existing->load(['items.material' => fn ($q) => $q->withTrashed(), 'items.material.category:id,name,sort_order']), 'resumed' => true]);
            }
        }
        $st = DB::transaction(function () use ($emp, $v, $branchId, $catIds) {
            $st = Stocktake::create([
                'branch_id' => $branchId,
                'employee_id' => $emp->id,
                'type' => $v['type'] ?? 'daily',
                'status' => 'draft',
                'note' => $v['note'] ?? null,
            ]);
            // Gói 55: gom tồn kho 1 query (tránh N+1)
            $stockMap = Batch::where('branch_id', $branchId)
                ->where('status', 'active')
                ->groupBy('material_id')
                ->selectRaw('material_id, SUM(current_quantity) as total')
                ->pluck('total', 'material_id');
            $itemRows = [];
            // Gói 55 p11w: chỉ lấy nguyên liệu đang hoạt động
            foreach (Material::where('is_active', true)->get() as $material) {
                // Gói 55 p11t: lọc theo loại NL nếu có chọn
                if ($catIds !== null && !in_array((int) $material->material_category_id, $catIds, true)) {
                    continue;
                }
                $itemRows[] = [
                    'material_id' => $material->id,
                    'system_qty' => (float) ($stockMap[$material->id] ?? 0),
                    'counted_qty' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            if (!empty($itemRows)) {
                $st->items()->createMany($itemRows);
            }
            return $st;
        });
        return response()->json(['success' => true, 'message' => 'Đã tạo phiếu kiểm kê.', 'data' => $st->load(['items.material' => fn ($q) => $q->withTrashed(), 'items.material.category:id,name,sort_order'])], 201);
    }

    public function showStocktake(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        // Gói 55 p11u: cho phép mở phiếu của các chi nhánh NV được phép (không chỉ CN mặc định)
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $branchIds = array_unique($branchIds);
        $st = Stocktake::with(['items.material' => fn ($q) => $q->withTrashed(), 'items.material.category:id,name,sort_order'])
            ->whereIn('branch_id', $branchIds)->findOrFail($id);
        return response()->json(['success' => true, 'data' => $st]);
    }

    public function updateStocktakeCounts(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        // Gói 55 p11u: cho phép các chi nhánh NV được phép
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $st = Stocktake::whereIn('branch_id', array_unique($branchIds))->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt.'], 422);
        }
        $v = $request->validate([
            'items' => 'required|array|min:1|max:500',
            'items.*.stocktake_item_id' => 'required|exists:stocktake_items,id',
            'items.*.counted_qty' => 'required|numeric|min:0',
        ]);
        // Gói 55: kiểm tra tất cả item đều thuộc phiếu trước khi update (tránh bỏ qua lặng lẽ)
        $ids = collect($v['items'])->pluck('stocktake_item_id');
        $validCount = $st->items()->whereIn('id', $ids)->count();
        if ($validCount < count($v['items'])) {
            return response()->json([
                'success' => false,
                'message' => 'Có ' . (count($v['items']) - $validCount) . ' dòng không thuộc phiếu kiểm kê này.',
            ], 422);
        }
        DB::transaction(function () use ($st, $v) {
            foreach ($v['items'] as $it) {
                $st->items()->where('id', $it['stocktake_item_id'])->update(['counted_qty' => $it['counted_qty']]);
            }
        });
        return response()->json(['success' => true, 'message' => 'Đã lưu số liệu.']);
    }

    public function confirmStocktake(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        // Gói 55 p11u: cho phép các chi nhánh NV được phép
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $st = Stocktake::with('items')->whereIn('branch_id', array_unique($branchIds))->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt.'], 422);
        }
        // Gói 55 p11ac: chặn chốt phiếu trống
        if ($st->items->count() === 0) {
            return response()->json(['success' => false, 'message' => 'Phiếu trống, không thể chốt.'], 422);
        }
        $missing = $st->items->whereNull('counted_qty')->count();
        if ($missing > 0) {
            return response()->json(['success' => false, 'message' => "Còn {$missing} nguyên liệu chưa nhập số đếm."], 422);
        }
        $v = $request->validate(['checked_at' => 'nullable|date']);
        $st->update([
            'status' => 'confirmed',
            'checked_at' => $v['checked_at'] ?? now(),
            'employee_id' => $st->employee_id ?? $emp->id,
        ]);
        // Gói 19: chốt chỉ ghi nhận chênh lệch, KHÔNG tự điều chỉnh kho
        // Gói 55 p11b: tổng giá trị chênh vượt ngưỡng → tự sinh đề xuất điều chỉnh (chờ duyệt)
        $rows = $st->items->map(fn ($it) => [
            'material_id' => $it->material_id,
            'system_qty' => (float) $it->system_qty,
            'counted_qty' => (float) $it->counted_qty,
            'diff' => (float) $it->counted_qty - (float) $it->system_qty,
        ])->all();
        $adjCount = 0;
        try {
            $adjCount = \App\Models\StocktakeAdjustment::createFromConfirmed($st->fresh(), $rows, $emp->id);
        } catch (\Exception $adjEx) {
            \Log::warning('Không tạo được đề xuất điều chỉnh kiểm kê #' . $st->id . ': ' . $adjEx->getMessage());
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã chốt kiểm kê.'
                . ($adjCount > 0 ? " Đã tạo {$adjCount} đề xuất điều chỉnh chờ quản lý duyệt." : ''),
            'adjustments_created' => $adjCount,
        ]);
    }

    // Gói 55 p11w: thêm nguyên liệu vào phiếu nháp
    public function addStocktakeItems(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $st = Stocktake::whereIn('branch_id', array_unique($branchIds))->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt, không thể thêm.'], 422);
        }
        $v = $request->validate([
            'material_ids' => 'required|array|min:1',
            'material_ids.*' => 'exists:materials,id',
        ]);
        $existingIds = $st->items()->pluck('material_id')->toArray();
        $newIds = array_diff($v['material_ids'], $existingIds);
        if (empty($newIds)) {
            return response()->json(['success' => false, 'message' => 'Các nguyên liệu đã có trong phiếu.'], 422);
        }
        // Tính tồn hệ thống 1 lần
        $stocks = \App\Models\Batch::where('branch_id', $st->branch_id)
            ->whereIn('material_id', $newIds)
            ->where('status', 'active')
            ->groupBy('material_id')
            ->selectRaw('material_id, SUM(current_quantity) as total')
            ->pluck('total', 'material_id');
        $items = [];
        foreach ($newIds as $mid) {
            $items[] = [
                'material_id' => $mid,
                'system_qty' => (float) ($stocks[$mid] ?? 0),
                'counted_qty' => null,
            ];
        }
        $st->items()->createMany($items);
        return response()->json(['success' => true, 'message' => 'Đã thêm ' . count($items) . ' nguyên liệu.', 'data' => $st->load(['items.material' => fn ($q) => $q->withTrashed(), 'items.material.category:id,name,sort_order'])]);
    }

    // Gói 55 p11w: xóa dòng khỏi phiếu nháp
    public function removeStocktakeItem(Request $request, int $id, int $itemId): JsonResponse
    {
        $emp = $this->emp($request);
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $st = Stocktake::whereIn('branch_id', array_unique($branchIds))->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt, không thể xóa.'], 422);
        }
        $deleted = $st->items()->where('id', $itemId)->delete();
        if (!$deleted) {
            return response()->json(['success' => false, 'message' => 'Không tìm thấy dòng.'], 404);
        }
        return response()->json(['success' => true, 'message' => 'Đã xóa khỏi phiếu.']);
    }

    // Gói 55 p11w: hủy/xóa phiếu nháp
    public function deleteStocktake(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        $branchIds = $emp->branches()->pluck('branches.id')->toArray();
        if ($emp->branch_id) $branchIds[] = (int) $emp->branch_id;
        $st = Stocktake::whereIn('branch_id', array_unique($branchIds))->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Chỉ được hủy phiếu nháp.'], 422);
        }
        $st->items()->delete();
        $st->delete();
        return response()->json(['success' => true, 'message' => 'Đã hủy phiếu kiểm kê.']);
    }

    // ---------- Chế biến ----------

    public function productionMaterials(Request $request): JsonResponse
    {
        // Gói 55 p11o: BTP = NL có định mức chế biến (thay cho type cũ)
        $semiIds = \App\Models\ProductionRecipe::distinct()->pluck('material_id');
        $data = Material::whereIn('id', $semiIds)->orderBy('name')
            ->get(['id', 'name', 'unit']);
        return response()->json(['success' => true, 'data' => $data]);
    }

    public function productionRecipes(Request $request): JsonResponse
    {
        $emp = $this->emp($request);
        $v = $request->validate(['material_id' => 'required|exists:materials,id']);
        $material = Material::findOrFail($v['material_id']);
        $recipes = ProductionRecipe::with('rawMaterial:id,name,unit')
            ->where('material_id', $material->id)->get()
            ->map(function ($r) use ($emp) {
                $stock = (float) Batch::where('branch_id', $emp->branch_id)
                    ->where('material_id', $r->raw_material_id)
                    ->where('status', 'active')->sum('current_quantity');
                return [
                    'raw_material' => $r->rawMaterial,
                    'quantity' => (float) $r->quantity,
                    'batch_output_qty' => $r->batch_output_qty ? (float) $r->batch_output_qty : null, // Gói 55 p11c
                    'stock_qty' => $stock,
                ];
            });
        return response()->json(['success' => true, 'data' => [
            'material' => $material->only(['id', 'name', 'unit']),
            'batch_output_qty' => $recipes->first()['batch_output_qty'] ?? null, // SL mỗi mẻ
            'recipes' => $recipes,
        ]]);
    }

    public function storeProduction(Request $request, InventoryService $inv): JsonResponse
    {
        $emp = $this->emp($request);
        $v = $request->validate([
            'material_id' => 'required|exists:materials,id',
            'quantity' => 'required|numeric|min:0.01',
            'note' => 'nullable|string|max:500',
        ]);
        $material = Material::findOrFail($v['material_id']);
        // Gói 55 p11o: bỏ gate type cũ — check định mức bên dưới đã đủ
        $recipes = ProductionRecipe::where('material_id', $material->id)->get();
        if ($recipes->isEmpty()) {
            return response()->json(['success' => false, 'message' => 'Chưa có định mức cho nguyên liệu này.'], 422);
        }
        try {
            $movementIds = []; // Gói 55 p11af: nhận id nhật ký xuất kho để gắn production_id sau
            $production = DB::transaction(function () use ($emp, $v, $material, $recipes, $inv, &$movementIds) {
                $needs = [];
                foreach ($recipes as $r) {
                    // Gói 55 p11c: định mức theo mẻ — quantity là NL cho 1 mẻ (batch_output_qty đơn vị BTP)
                    $batchOut = (float) ($r->batch_output_qty ?: 1);
                    $batches = (float) $v['quantity'] / $batchOut;
                    $needs[$r->raw_material_id] = ($needs[$r->raw_material_id] ?? 0) + (float) $r->quantity * $batches;
                }
                // Gói 55 p11af: ghi nhật ký xuất kho từng lô, gắn production_id sau
                $deducted = $inv->deductMaterialsDetailed((int) $emp->branch_id, $needs, [
                    'type' => 'production',
                    'note' => 'Chế biến ' . $material->name,
                ], $movementIds);
                $inv->addStock((int) $emp->branch_id, (int) $material->id, (float) $v['quantity']);
                $production = Production::create([
                    'branch_id' => $emp->branch_id,
                    'material_id' => $material->id,
                    'quantity' => $v['quantity'],
                    'employee_id' => $emp->id,
                    'note' => $v['note'] ?? null,
                ]);
                foreach ($deducted as $matId => $lines) {
                    $qty = array_sum(array_column($lines, 'quantity'));
                    ProductionItem::create([
                        'production_id' => $production->id,
                        'material_id' => $matId,
                        'quantity' => $qty,
                    ]);
                }
                // Gói 55 p11af: gắn production_id vào nhật ký xuất kho
                if (!empty($movementIds)) {
                    \App\Models\StockMovement::whereIn('id', $movementIds)->update(['reference_id' => $production->id]);
                }
                return $production;
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
        return response()->json(['success' => true, 'message' => 'Chế biến thành công.', 'data' => $production->load(['material', 'items.material'])], 201);
    }

    public function productions(Request $request): JsonResponse
    {
        $emp = $this->emp($request);
        $list = Production::with(['material:id,name', 'employee:id,full_name'])
            ->where('branch_id', $emp->branch_id)
            ->orderByDesc('id')->limit(30)->get()
            ->map(fn ($p) => [
                'id' => $p->id,
                'material_name' => $p->material?->name,
                'quantity' => (float) $p->quantity,
                'employee_name' => $p->employee?->full_name,
                'created_at' => $p->created_at,
            ]);
        return response()->json(['success' => true, 'data' => $list]);
    }

    // ---------- Nhập hàng (ủy quyền cho InboundReceiptController) ----------

    public function storeInboundReceipt(Request $request): JsonResponse
    {
        // InboundReceiptController@store đã tự ép branch theo Employee
        return app(InboundReceiptController::class)->store($request);
    }

    // Gói 55 p11aa: nhân viên tạo phiếu xuất (tạo nháp, admin chốt sau)
    public function storeOutboundReceipt(Request $request): JsonResponse
    {
        return app(\App\Http\Controllers\Api\OutboundController::class)->store($request);
    }

    // Gói 55 p11aa: nhân viên tạo phiếu chuyển kho (tạo nháp, admin chốt sau)
    public function storeStockTransfer(Request $request): JsonResponse
    {
        return app(\App\Http\Controllers\Api\StockTransferController::class)->store($request);
    }
}
