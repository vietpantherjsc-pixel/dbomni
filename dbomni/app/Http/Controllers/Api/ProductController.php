<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductPrice;
use App\Models\Recipe;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

// Gói 8a (2026-10-05): form mặt hàng đầy đủ kiểu Sapo —
// nhóm tùy chọn, giá theo kênh, định mức nguyên liệu, thuế suất riêng.
class ProductController extends Controller
{
    public function index()
    {
        // Lấy danh sách mặt hàng kèm thông tin danh mục chứa nó
        // Gói 25: kèm hidden_branches (mảng {id, name}) để hiện badge "đang ẩn ở CN X"
        $hidden = \App\Models\BranchProductHidden::with('branch:id,name')->get()->groupBy('product_id');
        $products = Product::with(['category', 'prices.priceList'])->get()->map(function ($p) use ($hidden) {
            $p->hidden_branches = isset($hidden[$p->id])
                ? $hidden[$p->id]->map(fn($r) => ['id' => $r->branch->id, 'name' => $r->branch->name])->values()
                : [];
            return $p;
        });
        return response()->json($products);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'category_id' => 'nullable|exists:categories,id',
            'name' => 'required|string|max:255',
            'sku' => 'nullable|string|unique:products,sku',
            'slug' => 'nullable|string|unique:products,slug',
            'base_price' => 'required|numeric|min:0',
            'description' => 'nullable|string',
            'color' => 'nullable|string|max:7',
            'tax_rate' => 'nullable|numeric|min:0|max:100',
            'is_active' => 'boolean',
            'sell_on_pos' => 'boolean',
            'sell_on_zalo' => 'boolean',
            'price_on_demand' => 'boolean', // Gói 10c: giá nhập khi chọn món
            'image_url' => 'nullable|string|max:500',
            // Gói 8a
            'option_group_ids' => 'nullable|array',
            'option_group_ids.*' => 'exists:option_groups,id',
            'prices' => 'nullable|array',
            'prices.*.price_list_id' => 'required|exists:price_lists,id',
            'prices.*.price' => 'required|numeric|min:0',
            'prices.*.is_active' => 'boolean',
            'recipes' => 'nullable|array',
            'recipes.*.material_id' => 'required|exists:materials,id',
            'recipes.*.quantity' => 'required|numeric|min:0',
            'recipes.*.kind' => 'nullable|in:ingredient,packaging', // Gói 8c
            // Gói 8c: định mức theo món cho nhóm per_product
            'option_recipes' => 'nullable|array',
            'option_recipes.*.product_option_id' => 'required|exists:product_options,id',
            'option_recipes.*.material_id' => 'required|exists:materials,id',
            'option_recipes.*.quantity' => 'required|numeric|min:0',
            'option_recipes.*.kind' => 'nullable|in:ingredient,packaging',
        ]);

        $product = DB::transaction(function () use ($validated) {
            if (empty($validated['slug'])) {
                $validated['slug'] = Str::slug($validated['name']) . '-' . Str::random(4);
            }
            // Gói 8e: tách các khóa quan hệ ra khỏi attributes (tránh ghi vào cột products)
            $attributes = array_diff_key($validated, array_flip(['option_group_ids', 'prices', 'recipes', 'option_recipes']));
            $product = Product::create($attributes);

            if (!empty($validated['option_group_ids'])) {
                $product->optionGroups()->sync($validated['option_group_ids']);
            }
            $this->syncPrices($product, $validated['prices'] ?? []);
            $this->syncRecipes($product, $validated['recipes'] ?? []);
            $this->syncOptionRecipes($product, $validated['option_recipes'] ?? []);

            return $product;
        });

        return response()->json($this->loadFull($product), 201);
    }

    public function show(Product $product)
    {
        return response()->json($this->loadFull($product));
    }

    public function update(Request $request, Product $product)
    {
        $validated = $request->validate([
            'category_id' => 'nullable|exists:categories,id',
            'name' => 'sometimes|string|max:255',
            'sku' => 'nullable|string|unique:products,sku,' . $product->id,
            'slug' => 'sometimes|string|unique:products,slug,' . $product->id,
            'base_price' => 'sometimes|numeric|min:0',
            'description' => 'nullable|string',
            'color' => 'nullable|string|max:7',
            'tax_rate' => 'nullable|numeric|min:0|max:100',
            'is_active' => 'sometimes|boolean',
            'sell_on_pos' => 'sometimes|boolean',
            'sell_on_zalo' => 'sometimes|boolean',
            'price_on_demand' => 'sometimes|boolean', // Gói 10c
            'image_url' => 'nullable|string|max:500',
            // Gói 8a
            'option_group_ids' => 'nullable|array',
            'option_group_ids.*' => 'exists:option_groups,id',
            'prices' => 'nullable|array',
            'prices.*.price_list_id' => 'required|exists:price_lists,id',
            'prices.*.price' => 'required|numeric|min:0',
            'prices.*.is_active' => 'boolean',
            'recipes' => 'nullable|array',
            'recipes.*.material_id' => 'required|exists:materials,id',
            'recipes.*.quantity' => 'required|numeric|min:0',
            'recipes.*.kind' => 'nullable|in:ingredient,packaging', // Gói 8c
            // Gói 8c: định mức theo món cho nhóm per_product
            'option_recipes' => 'nullable|array',
            'option_recipes.*.product_option_id' => 'required|exists:product_options,id',
            'option_recipes.*.material_id' => 'required|exists:materials,id',
            'option_recipes.*.quantity' => 'required|numeric|min:0',
            'option_recipes.*.kind' => 'nullable|in:ingredient,packaging',
        ]);

        DB::transaction(function () use ($product, $validated) {
            // Gói 8e: tách các khóa quan hệ ra khỏi attributes (tránh ghi vào cột products)
            $attributes = array_diff_key($validated, array_flip(['option_group_ids', 'prices', 'recipes', 'option_recipes']));
            $product->update($attributes);

            if (array_key_exists('option_group_ids', $validated)) {
                $product->optionGroups()->sync($validated['option_group_ids'] ?? []);
            }
            if (array_key_exists('prices', $validated)) {
                $this->syncPrices($product, $validated['prices'] ?? []);
            }
            if (array_key_exists('recipes', $validated)) {
                $this->syncRecipes($product, $validated['recipes'] ?? []);
            }
            if (array_key_exists('option_recipes', $validated)) {
                $this->syncOptionRecipes($product, $validated['option_recipes'] ?? []);
            }
        });

        return response()->json($this->loadFull($product));
    }

    public function destroy(Product $product)
    {
        $product->delete();
        return response()->json(['message' => 'Đã xóa mặt hàng thành công']);
    }

    // Gói 9: bật/tắt món yêu thích (icon tim trong danh sách mặt hàng)
    public function toggleFavorite(Product $product)
    {
        $product->update(['is_favorite' => !$product->is_favorite]);
        return response()->json(['is_favorite' => (bool) $product->is_favorite]);
    }

    // =====================================================================
    // Gói 33 (2026-10-09): THAO TÁC HÀNG LOẠT mặt hàng — CHỈ admin cấp cao nhất
    // (route middleware permission:products.bulk).
    // POST /api/products/bulk-action {ids, action, params}
    // - change_category {category_id}
    // - set_channels {channels: {<price_list_code>: bool}} (+ pos/zalo -> sell_on_pos/sell_on_zalo)
    // - set_visibility {visible: bool} -> is_active
    // - delete -> xóa (giống single destroy)
    // =====================================================================
    public function bulkAction(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1|max:500',
            'ids.*' => 'integer|exists:products,id',
            'action' => 'required|in:change_category,set_channels,set_visibility,delete',
            'params' => 'nullable|array',
        ]);
        $ids = array_values(array_unique($validated['ids']));
        $action = $validated['action'];
        $params = $validated['params'] ?? [];

        $result = DB::transaction(function () use ($ids, $action, $params) {
            $done = 0;
            switch ($action) {
                case 'change_category': {
                    $categoryId = $params['category_id'] ?? null;
                    if ($categoryId !== null && !\App\Models\Category::where('id', $categoryId)->exists()) {
                        throw new \Exception('Danh mục không tồn tại.');
                    }
                    $done = Product::whereIn('id', $ids)->update(['category_id' => $categoryId]);
                    break;
                }
                case 'set_channels': {
                    $channels = $params['channels'] ?? [];
                    if (!is_array($channels) || empty($channels)) {
                        throw new \Exception('Thiếu params.channels {<mã kênh>: true/false}.');
                    }
                    $priceLists = PriceList::all()->keyBy('code');
                    foreach ($ids as $id) {
                        $product = Product::findOrFail($id);
                        $sellAttrs = [];
                        foreach ($channels as $code => $on) {
                            $on = (bool) $on;
                            if ($code === 'pos') { $sellAttrs['sell_on_pos'] = $on; continue; }
                            if ($code === 'zalo') { $sellAttrs['sell_on_zalo'] = $on; continue; }
                            $pl = $priceLists->get($code);
                            if (!$pl) throw new \Exception("Kênh không tồn tại: {$code}.");
                            $row = ProductPrice::firstOrNew([
                                'product_id' => $id, 'price_list_id' => $pl->id,
                            ]);
                            $row->is_active = $on;
                            if (!$row->exists) $row->price = $product->base_price; // bật kênh mới: lấy giá gốc
                            $row->save();
                        }
                        if ($sellAttrs) $product->update($sellAttrs);
                        $done++;
                    }
                    break;
                }
                case 'set_visibility': {
                    $visible = (bool) ($params['visible'] ?? true);
                    $done = Product::whereIn('id', $ids)->update(['is_active' => $visible]);
                    break;
                }
                case 'delete': {
                    foreach ($ids as $id) {
                        Product::findOrFail($id)->delete(); // giống single destroy (model events)
                        $done++;
                    }
                    break;
                }
            }
            return $done;
        });

        return response()->json(['success' => true, 'updated' => $result]);
    }

    // =====================================================================
    // Gói 33: CHỈNH SỬA NHANH hàng loạt (màn bulk edit kiểu Sapo).
    // POST /api/products/bulk-update {rows: [{id, values: {field: value}}]}
    // Fields: base_price, unit, print_label, category_id, cost_price,
    //         tax_rate, is_active, price_<price_list_code> (giá kênh).
    // Validate từng field theo rule của single update; lỗi nêu rõ dòng + tên field.
    // =====================================================================
    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'rows' => 'required|array|min:1|max:500',
            'rows.*.id' => 'required|integer|exists:products,id',
            'rows.*.values' => 'required|array|min:1',
        ]);

        $fieldRules = [
            'base_price' => 'numeric|min:0',
            'unit' => 'string|max:20',
            'print_label' => 'boolean',
            'category_id' => 'nullable|exists:categories,id',
            'cost_price' => 'numeric|min:0',
            'tax_rate' => 'nullable|numeric|min:0|max:100',
            'is_active' => 'boolean',
        ];

        // Validate toàn bộ trước khi ghi (fail rõ dòng + field)
        $allCodes = [];
        foreach ($validated['rows'] as $i => $row) {
            $rules = [];
            foreach ($row['values'] as $field => $v) {
                if (isset($fieldRules[$field])) {
                    $rules["rows.{$i}.values.{$field}"] = $fieldRules[$field];
                } elseif (str_starts_with($field, 'price_')) {
                    $code = substr($field, 6);
                    $allCodes[] = $code;
                    $rules["rows.{$i}.values.{$field}"] = 'numeric|min:0';
                } else {
                    return response()->json([
                        'success' => false, 'message' => "Dòng " . ($i + 1) . ": field không được phép '{$field}'.",
                    ], 422);
                }
            }
        }
        $validator = Validator::make($validated, $rules, [], ['*' => 'giá trị']);
        if ($validator->fails()) {
            return response()->json([
                'success' => false, 'message' => $validator->errors()->first(),
                'errors' => $validator->errors()->toArray(),
            ], 422);
        }

        $priceLists = PriceList::whereIn('code', array_unique($allCodes))->get()->keyBy('code');
        foreach (array_unique($allCodes) as $code) {
            if (!$priceLists->has($code)) {
                return response()->json([
                    'success' => false, 'message' => "Kênh không tồn tại: {$code}.",
                ], 422);
            }
        }

        $updated = DB::transaction(function () use ($validated, $fieldRules, $priceLists) {
            $n = 0;
            foreach ($validated['rows'] as $row) {
                $product = Product::findOrFail($row['id']);
                $attrs = [];
                foreach ($fieldRules as $field => $_) {
                    if (array_key_exists($field, $row['values'])) $attrs[$field] = $row['values'][$field];
                }
                if ($attrs) $product->update($attrs);
                foreach ($row['values'] as $field => $v) {
                    if (!str_starts_with($field, 'price_')) continue;
                    $pl = $priceLists->get(substr($field, 6));
                    $pp = ProductPrice::firstOrNew([
                        'product_id' => $row['id'], 'price_list_id' => $pl->id,
                    ]);
                    $pp->price = $v;
                    if (!$pp->exists) $pp->is_active = true;
                    $pp->save();
                }
                $n++;
            }
            return $n;
        });

        return response()->json(['success' => true, 'updated' => $updated]);
    }

    // ---- helpers ----

    private function loadFull(Product $product): Product
    {
        $product->load([
            'category',
            'optionGroups' => fn($q) => $q->orderBy('sort_order'),
            'optionGroups.options' => fn($q) => $q->orderBy('sort_order')->orderBy('id'),
            'prices.priceList',
            'recipes.material',
        ]);
        $product->option_group_ids = $product->optionGroups->pluck('id')->values();
        // Gói 8c: định mức theo món (product_id + option_id đều set)
        $product->option_recipes = Recipe::with('material')
            ->where('product_id', $product->id)
            ->whereNotNull('product_option_id')
            ->get();
        $product->cost_price = $this->calcCost($product);
        return $product;
    }

    private function syncPrices(Product $product, array $prices): void
    {
        $ids = [];
        foreach ($prices as $p) {
            $row = ProductPrice::updateOrCreate(
                ['product_id' => $product->id, 'price_list_id' => $p['price_list_id']],
                ['price' => $p['price'], 'is_active' => $p['is_active'] ?? true]
            );
            $ids[] = $row->id;
        }
        // Xóa các dòng giá không còn trong form (kênh bị bỏ tick)
        ProductPrice::where('product_id', $product->id)->whereNotIn('id', $ids)->delete();
    }

    private function syncRecipes(Product $product, array $recipes): void
    {
        // Định mức CƠ BẢN của món (product_option_id = null), gồm nguyên liệu + bao bì
        Recipe::where('product_id', $product->id)->whereNull('product_option_id')->delete();
        foreach ($recipes as $r) {
            if ((float) $r['quantity'] <= 0) continue;
            Recipe::create([
                'product_id' => $product->id,
                'product_option_id' => null,
                'material_id' => $r['material_id'],
                'quantity' => $r['quantity'],
                'kind' => $r['kind'] ?? 'ingredient',
            ]);
        }
    }

    // Gói 8c: định mức THEO MÓN cho nhóm per_product (VD: Size M của cà phê +40ml cà phê)
    private function syncOptionRecipes(Product $product, array $recipes): void
    {
        Recipe::where('product_id', $product->id)->whereNotNull('product_option_id')->delete();
        foreach ($recipes as $r) {
            if ((float) $r['quantity'] <= 0) continue;
            Recipe::create([
                'product_id' => $product->id,
                'product_option_id' => $r['product_option_id'],
                'material_id' => $r['material_id'],
                'quantity' => $r['quantity'],
                'kind' => $r['kind'] ?? 'ingredient',
            ]);
        }
    }

    // Gói 8a: giá vốn tự động = Σ (định lượng × đơn giá vốn mới nhất của nguyên liệu)
    private function calcCost(Product $product): float
    {
        $cost = 0;
        foreach ($product->recipes as $recipe) {
            if ($recipe->product_option_id) continue; // chỉ tính định mức cơ bản
            $material = $recipe->material;
            if (!$material) continue;
            $latest = $material->batches()->orderByDesc('id')->first();
            $unitCost = $latest ? (float) $latest->unit_cost : 0;
            // unit_cost đang theo đơn vị NHẬP -> quy về đơn vị cơ sở
            $rate = (float) ($material->conversion_rate ?: 1);
            if ($rate > 0) $unitCost = $unitCost / $rate;
            $cost += (float) $recipe->quantity * $unitCost;
        }
        return round($cost);
    }
}
