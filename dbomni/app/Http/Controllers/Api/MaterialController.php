<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Material;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 4 (2026-10-04): CRUD nguyên vật liệu (kèm đơn vị quy đổi).
class MaterialController extends Controller
{
    public function index(): JsonResponse
    {
        // Gói 22: kèm loại danh mục để nhóm kiểm kho + hiển thị
        // Gói 55 p11m: kèm đơn vị quy đổi
        // Gói 55 p11o: is_semi_finished dựa trên định mức chế biến thực tế (thay trường type cũ)
        $semiIds = \App\Models\ProductionRecipe::distinct()->pluck('material_id')->toArray();
        $materials = Material::with(['category', 'units'])->orderBy('name')->get()
            ->map(function ($m) use ($semiIds) {
                $m->is_semi_finished = in_array($m->id, $semiIds);
                return $m;
            });
        return response()->json(['success' => true, 'data' => $materials]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'unit' => 'required|string|max:20',
            // Gói 55 p11o: bỏ trường type — dùng is_semi_finished từ định mức chế biến
            'material_category_id' => 'nullable|exists:material_categories,id', // Gói 22
            'minimum_stock' => 'nullable|numeric|min:0',
            'waste_threshold_pct' => 'nullable|numeric|min:0|max:100', // Gói 55 p11b: ngưỡng hao hụt cho phép
            'is_active' => 'nullable|boolean', // Gói 55 p11w
            'units' => 'nullable|array', // Gói 55 p11m+p11ab: [{unit_name, conversion_rate}] — conversion_rate = số ĐV mua / 1 ĐV cơ sở
            'units.*.unit_name' => 'required|string|max:30|distinct',
            'units.*.conversion_rate' => 'required|numeric|min:0.0001',
        ]);

        $material = Material::create([
            'name' => $validated['name'],
            'unit' => $validated['unit'],
            'type' => 'raw', // Gói 55 p11o: giữ giá trị mặc định, không dùng nữa
            'material_category_id' => $validated['material_category_id'] ?? null, // Gói 22
            'minimum_stock' => $validated['minimum_stock'] ?? 0,
            'waste_threshold_pct' => $validated['waste_threshold_pct'] ?? 5, // Gói 55 p11b
            'is_active' => $validated['is_active'] ?? true, // Gói 55 p11w
        ]);

        // Gói 55 p11m: lưu đơn vị quy đổi
        // Gói 55 p11ab: frontend gửi chiều "1 cơ sở = X mua" → đảo thành "1 mua = 1/X cơ sở" để công thức nhập kho không đổi
        if (!empty($validated['units'])) {
            foreach ($validated['units'] as $u) {
                $material->units()->create([
                    'unit_name' => $u['unit_name'],
                    'conversion_rate' => 1 / (float) $u['conversion_rate'],
                ]);
            }
            // Gói 55: đồng bộ cột legacy
            $first = $validated['units'][0];
            $material->purchase_unit = $first['unit_name'];
            $material->conversion_rate = 1 / (float) $first['conversion_rate'];
            $material->save();
        }

        return response()->json(['success' => true, 'data' => $material->load('units')], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $material = Material::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:150',
            'unit' => 'sometimes|string|max:20',
            'material_category_id' => 'sometimes|nullable|exists:material_categories,id', // Gói 22
            'minimum_stock' => 'nullable|numeric|min:0',
            'waste_threshold_pct' => 'nullable|numeric|min:0|max:100', // Gói 55 p11b: ngưỡng hao hụt cho phép
            'units' => 'nullable|array', // Gói 55 p11m+p11ab: [{unit_name, conversion_rate}] — conversion_rate = số ĐV mua / 1 ĐV cơ sở
            'units.*.unit_name' => 'required|string|max:30|distinct',
            'units.*.conversion_rate' => 'required|numeric|min:0.0001',
        ]);
        $data = $validated;
        unset($data['units']);
        $material->update($data);

        // Gói 55 p11m: đồng bộ đơn vị quy đổi (xóa hết tạo lại)
        // Gói 55 p11ab: frontend gửi chiều "1 cơ sở = X mua" → đảo thành "1 mua = 1/X cơ sở"
        if (array_key_exists('units', $validated)) {
            $material->units()->delete();
            foreach ($validated['units'] ?? [] as $u) {
                $material->units()->create([
                    'unit_name' => $u['unit_name'],
                    'conversion_rate' => 1 / (float) $u['conversion_rate'],
                ]);
            }
            // Gói 55: đồng bộ cột legacy để code cũ (nhập kho) vẫn chạy đúng
            $first = $validated['units'][0] ?? null;
            $material->purchase_unit = $first['unit_name'] ?? null;
            $material->conversion_rate = isset($first['conversion_rate']) ? 1 / (float) $first['conversion_rate'] : 1;
            $material->save();
        }

        return response()->json(['success' => true, 'data' => $material->load('units')]);
    }

    // Gói 55 p11s: parse file Excel/CSV bằng PhpSpreadsheet (đã có sẵn ở backend)
    // Trả về headers + rows để frontend mapping cột
    public function importPreview(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        try {
            $spreadsheet = \PhpOffice\PhpSpreadsheet\IOFactory::load($request->file('file')->getRealPath());
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Không đọc được file: ' . $e->getMessage(),
            ], 422);
        }

        $sheet = $spreadsheet->getActiveSheet();
        $all = $sheet->toArray(null, true, false, false);
        // Lọc dòng trống
        $all = array_values(array_filter($all, fn ($r) => collect($r)->some(fn ($c) => trim((string) $c) !== '')));
        if (count($all) < 2) {
            return response()->json(['success' => false, 'message' => 'File không có dòng dữ liệu (cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu).'], 422);
        }

        $headers = array_map(fn ($h) => trim((string) $h), $all[0]);
        $rows = array_slice($all, 1);
        // Chuẩn hóa rows thành string
        $rows = array_map(fn ($r) => array_map(fn ($c) => trim((string) $c), $r), $rows);

        return response()->json([
            'success' => true,
            'data' => ['headers' => $headers, 'rows' => $rows],
        ]);
    }
    public function linkedProducts(int $id): JsonResponse
    {
        $material = Material::findOrFail($id);
        // Món ăn dùng nguyên liệu này (định mức BOM)
        $products = \App\Models\Recipe::where('material_id', $id)
            ->with('product:id,name')
            ->get()
            ->map(fn ($r) => ['link_id' => $r->id, 'link_type' => 'recipe', 'id' => $r->product?->id, 'name' => $r->product?->name, 'via' => 'Định mức món'])
            ->filter(fn ($p) => $p['id']);
        // Bán thành phẩm dùng nguyên liệu này làm đầu vào
        $prodRecipes = \App\Models\ProductionRecipe::where('raw_material_id', $id)->with('material:id,name')->get();
        $semis = $prodRecipes
            ->map(fn ($r) => ['link_id' => $r->id, 'link_type' => 'production', 'id' => $r->material?->id, 'name' => $r->material?->name, 'via' => 'Chế biến BTP'])
            ->filter(fn ($p) => $p['id']);
        // Bán thành phẩm này được chế biến từ nguyên liệu nào (nếu là BTP)
        $inputs = \App\Models\ProductionRecipe::where('material_id', $id)
            ->with('rawMaterial:id,name')
            ->get()
            ->map(fn ($r) => ['link_id' => $r->id, 'link_type' => 'production', 'id' => $r->rawMaterial?->id, 'name' => $r->rawMaterial?->name, 'via' => 'Nguyên liệu đầu vào'])
            ->filter(fn ($p) => $p['id']);
        return response()->json([
            'success' => true,
            'data' => $products->concat($semis)->concat($inputs)->unique(fn ($p) => $p['link_type'] . '-' . $p['link_id'])->values(),
        ]);
    }

    // Gói 55 p11n: hủy liên kết nhanh (gỡ khỏi định mức)
    public function unlinkProduct(Request $request, int $id): JsonResponse
    {
        $v = $request->validate([
            'link_id' => 'required|integer',
            'link_type' => 'required|in:recipe,production',
        ]);
        if ($v['link_type'] === 'recipe') {
            $link = \App\Models\Recipe::where('id', $v['link_id'])->where('material_id', $id)->firstOrFail();
            $link->delete();
        } else {
            $link = \App\Models\ProductionRecipe::where('id', $v['link_id'])
                ->where(fn ($q) => $q->where('material_id', $id)->orWhere('raw_material_id', $id))
                ->firstOrFail();
            $link->delete();
        }
        return response()->json(['success' => true, 'message' => 'Đã hủy liên kết.']);
    }

    public function destroy(int $id): JsonResponse
    {
        // Gói 46: cho xóa khi tồn kho về 0 (xóa mềm, giữ lịch sử);
        // chặn khi còn trong định mức (BOM).
        $material = Material::findOrFail($id);

        // 1. Kiểm tra còn trong định mức món ăn / công thức chế biến không
        $productIds = \App\Models\Recipe::where('material_id', $id)->distinct()->pluck('product_id');
        $inProduction = \App\Models\ProductionRecipe::where('material_id', $id)
            ->orWhere('raw_material_id', $id)->exists();
        $dishCount = $productIds->count();
        if ($dishCount > 0 || $inProduction) {
            $extra = $inProduction ? ' và công thức chế biến' : '';
            return response()->json([
                'success' => false,
                'message' => "Không xóa được \"{$material->name}\": đang dùng trong {$dishCount} món{$extra}. Hãy gỡ khỏi định mức trước.",
            ], 422);
        }

        // 2. Kiểm tra tồn kho về 0 (mọi chi nhánh)
        $stock = (float) $material->batches()->sum('current_quantity');
        if ($stock > 0) {
            return response()->json([
                'success' => false,
                'message' => "Không xóa được \"{$material->name}\": tồn kho còn {$stock} {$material->unit}. Chỉ xóa được khi tồn về 0.",
            ], 422);
        }

        $material->delete(); // xóa mềm — lịch sử lô/phiếu vẫn giữ
        return response()->json(['success' => true, 'message' => "Đã xóa \"{$material->name}\" (lịch sử vẫn được giữ lại)."]);
    }

    // Gói 55 p11l: thao tác hàng loạt
    public function bulk(Request $request): JsonResponse
    {
        $v = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'exists:materials,id',
            'action' => 'required|in:delete,category,min_stock,status',
            'material_category_id' => 'nullable|exists:material_categories,id',
            'minimum_stock' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean', // Gói 55 p11w
        ]);

        $materials = Material::whereIn('id', $v['ids'])->get();
        $done = 0; $skipped = [];

        // Gói 55: bọc transaction để không dở dang khi lỗi giữa chừng
        DB::transaction(function () use ($materials, $v, &$done, &$skipped) {
        foreach ($materials as $m) {
            if ($v['action'] === 'delete') {
                // Kiểm tra như destroy
                $inRecipe = \App\Models\Recipe::where('material_id', $m->id)->exists();
                $inProduction = \App\Models\ProductionRecipe::where('material_id', $m->id)
                    ->orWhere('raw_material_id', $m->id)->exists();
                $stock = (float) $m->batches()->sum('current_quantity');
                if ($inRecipe || $inProduction) { $skipped[] = $m->name . ' (đang dùng trong định mức)'; continue; }
                if ($stock > 0) { $skipped[] = $m->name . ' (tồn kho còn ' . $stock . ')'; continue; }
                $m->delete();
                $done++;
            } elseif ($v['action'] === 'category') {
                $m->material_category_id = $v['material_category_id'] ?: null;
                $m->save();
                $done++;
            } elseif ($v['action'] === 'min_stock') {
                $m->minimum_stock = $v['minimum_stock'] ?? 0;
                $m->save();
                $done++;
            } elseif ($v['action'] === 'status') {
                // Gói 55 p11w: bật/tắt hoạt động hàng loạt
                $m->is_active = (bool) $v['is_active'];
                $m->save();
                $done++;
            }
        }
        });

        return response()->json([
            'success' => true,
            'message' => "Đã xử lý {$done} nguyên liệu." . ($skipped ? ' Bỏ qua: ' . implode('; ', $skipped) : ''),
            'done' => $done,
            'skipped' => $skipped,
        ]);
    }

    // Gói 55 p11z: bulk-update kiểu bảng tính như Products (rows: [{id, values}])
    // Fields: unit, material_category_id, minimum_stock, is_active, units_text (VD "chai=1000, thùng=12000")
    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'rows' => 'required|array|min:1|max:500',
            'rows.*.id' => 'required|integer|exists:materials,id',
            'rows.*.values' => 'required|array|min:1',
        ]);

        $fieldRules = [
            'unit' => 'string|max:20',
            'material_category_id' => 'nullable|exists:material_categories,id',
            'minimum_stock' => 'numeric|min:0',
            'is_active' => 'boolean',
            'units_text' => 'nullable|string|max:500',
        ];

        // Validate toàn bộ trước khi ghi
        $rules = [];
        foreach ($validated['rows'] as $i => $row) {
            foreach ($row['values'] as $field => $v) {
                if (isset($fieldRules[$field])) {
                    $rules["rows.{$i}.values.{$field}"] = $fieldRules[$field];
                } else {
                    return response()->json([
                        'success' => false,
                        'message' => "Dòng " . ($i + 1) . ": field không được phép '{$field}'.",
                    ], 422);
                }
            }
        }
        $validator = \Validator::make($validated, $rules);
        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => $validator->errors()->first(),
            ], 422);
        }

        $updated = 0; $skipped = [];
        DB::transaction(function () use ($validated, &$updated, &$skipped) {
            foreach ($validated['rows'] as $i => $row) {
                $m = Material::find($row['id']);
                if (!$m) continue;
                $values = $row['values'];
                $changed = false;

                if (array_key_exists('unit', $values)) {
                    // Không cho đổi đơn vị cơ sở nếu đã có lô nhập
                    if (!$m->batches()->exists()) {
                        $m->unit = $values['unit'];
                        $changed = true;
                    } else {
                        $skipped[] = $m->name . ' (đã có lô nhập, không đổi được đơn vị cơ sở)';
                    }
                }
                if (array_key_exists('material_category_id', $values)) {
                    $m->material_category_id = $values['material_category_id'] ?: null;
                    $changed = true;
                }
                if (array_key_exists('minimum_stock', $values)) {
                    $m->minimum_stock = $values['minimum_stock'];
                    $changed = true;
                }
                if (array_key_exists('is_active', $values)) {
                    $m->is_active = (bool) $values['is_active'];
                    $changed = true;
                }
                if ($changed) { $m->save(); $updated++; }

                // Đơn vị quy đổi: parse "Cái=30" nghĩa là 1 ĐV cơ sở = 30 ĐV mua
                // Gói 55 p11ab: đảo chiều — kho lưu conversion_rate = 1/30 để công thức nhập kho (SL_cơ_sở = SL_mua × rate) không đổi
                if (array_key_exists('units_text', $values) && trim($values['units_text']) !== '') {
                    $units = [];
                    foreach (explode(',', $values['units_text']) as $part) {
                        $kv = explode('=', $part, 2);
                        $name = trim($kv[0] ?? '');
                        $rate = trim($kv[1] ?? '');
                        if ($name !== '' && is_numeric($rate) && (float) $rate > 0) {
                            $units[] = ['unit_name' => $name, 'conversion_rate' => 1 / (float) $rate];
                        }
                    }
                    if (!empty($units)) {
                        $m->units()->delete();
                        foreach ($units as $u) $m->units()->create($u);
                        $m->purchase_unit = $units[0]['unit_name'];
                        $m->conversion_rate = $units[0]['conversion_rate'];
                        $m->save();
                        $updated++;
                    }
                }
            }
        });

        $msg = "Đã cập nhật {$updated} nguyên liệu.";
        if ($skipped) $msg .= ' Bỏ qua: ' . implode('; ', array_unique($skipped));
        return response()->json(['success' => true, 'message' => $msg, 'updated' => $updated]);
    }
}
