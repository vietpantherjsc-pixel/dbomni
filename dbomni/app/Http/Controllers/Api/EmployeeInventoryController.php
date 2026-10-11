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

    public function materials(Request $request): JsonResponse
    {
        $data = Material::with('category:id,name')
            ->orderBy('name')
            ->get()
            ->map(fn ($m) => [
                'id' => $m->id,
                'name' => $m->name,
                'unit' => $m->unit,
                'type' => $m->type,
                'category_name' => $m->category?->name,
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
        $list = Stocktake::where('branch_id', $emp->branch_id)
            ->orderByDesc('id')->limit(20)->get()
            ->map(fn ($s) => [
                'id' => $s->id,
                'type' => $s->type,
                'status' => $s->status,
                'note' => $s->note,
                'checked_at' => $s->checked_at,
                'created_at' => $s->created_at,
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
        ]);
        // Nếu đã có phiếu nháp hôm nay của CN → trả về để tiếp tục
        $existing = Stocktake::where('branch_id', $emp->branch_id)
            ->where('status', 'draft')
            ->whereDate('created_at', now()->toDateString())
            ->latest('id')->first();
        if ($existing) {
            return response()->json(['success' => true, 'data' => $existing->load('items.material.category'), 'resumed' => true]);
        }
        $st = DB::transaction(function () use ($emp, $v) {
            $st = Stocktake::create([
                'branch_id' => $emp->branch_id,
                'employee_id' => $emp->id,
                'type' => $v['type'] ?? 'daily',
                'status' => 'draft',
                'note' => $v['note'] ?? null,
            ]);
            foreach (Material::all() as $material) {
                $systemQty = (float) Batch::where('branch_id', $emp->branch_id)
                    ->where('material_id', $material->id)
                    ->where('status', 'active')
                    ->sum('current_quantity');
                $st->items()->create([
                    'material_id' => $material->id,
                    'system_qty' => $systemQty,
                    'counted_qty' => null,
                ]);
            }
            return $st;
        });
        return response()->json(['success' => true, 'message' => 'Đã tạo phiếu kiểm kê.', 'data' => $st->load('items.material.category')], 201);
    }

    public function showStocktake(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        $st = Stocktake::with('items.material.category')
            ->where('branch_id', $emp->branch_id)->findOrFail($id);
        return response()->json(['success' => true, 'data' => $st]);
    }

    public function updateStocktakeCounts(Request $request, int $id): JsonResponse
    {
        $emp = $this->emp($request);
        $st = Stocktake::where('branch_id', $emp->branch_id)->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt.'], 422);
        }
        $v = $request->validate([
            'items' => 'required|array|min:1|max:500',
            'items.*.stocktake_item_id' => 'required|exists:stocktake_items,id',
            'items.*.counted_qty' => 'required|numeric|min:0',
        ]);
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
        $st = Stocktake::with('items')->where('branch_id', $emp->branch_id)->findOrFail($id);
        if ($st->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Phiếu đã chốt.'], 422);
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
        return response()->json(['success' => true, 'message' => 'Đã chốt kiểm kê.']);
    }

    // ---------- Chế biến ----------

    public function productionMaterials(Request $request): JsonResponse
    {
        $data = Material::where('type', 'semi_finished')->orderBy('name')
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
                    'stock_qty' => $stock,
                ];
            });
        return response()->json(['success' => true, 'data' => ['material' => $material->only(['id', 'name', 'unit']), 'recipes' => $recipes]]);
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
        if ($material->type !== 'semi_finished') {
            return response()->json(['success' => false, 'message' => 'Chỉ chế biến bán thành phẩm.'], 422);
        }
        $recipes = ProductionRecipe::where('material_id', $material->id)->get();
        if ($recipes->isEmpty()) {
            return response()->json(['success' => false, 'message' => 'Chưa có định mức cho nguyên liệu này.'], 422);
        }
        try {
            $production = DB::transaction(function () use ($emp, $v, $material, $recipes, $inv) {
                $needs = [];
                foreach ($recipes as $r) {
                    $needs[$r->raw_material_id] = ($needs[$r->raw_material_id] ?? 0) + (float) $r->quantity * (float) $v['quantity'];
                }
                $deducted = $inv->deductMaterialsDetailed((int) $emp->branch_id, $needs);
                $batch = $inv->addStock((int) $emp->branch_id, (int) $material->id, (float) $v['quantity']);
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
}
