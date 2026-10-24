<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Material;
use App\Models\OptionGroup;
use App\Models\PayrollLock;
use App\Models\PrepaidExpense;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductPrice;
use App\Models\RdFixedCost;
use App\Models\RdProduct;
use App\Models\RdProductPrice;
use App\Models\RdRecipe;
use App\Models\Recipe;
use App\Models\Setting;
use App\Models\Transaction;
use App\Models\TransactionCategory;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// SPEC R&D (2026-10-21, Đại Vương chốt):
// - Menu cấp 1 "R&D" (ngoại lệ UI-MAP đã được duyệt), trang /admin/rd 3 tab.
// - Phân quyền: XEM = products.manage hoặc reports.view; GHI/DUYỆT = products.manage.
// - Giá vốn nháp tính ĐÚNG logic ProductController::calcCost (lô mới nhất ÷ hệ số quy đổi).
// - Hòa vốn đúng công thức spec 5.2 (số bán thật; biến phí gồm giá vốn NL + chiết khấu kênh).
class RDController extends Controller
{
    // ================= dùng chung =================

    /**
     * Quyền xem: products.manage HOẶC reports.view.
     * Mirror ĐÚNG ngữ nghĩa CheckPermission (Gói 26): User (admin) = full quyền;
     * Employee = còn hoạt động + ma trận roles.permissions qua Role::hasPermission().
     * Không dùng Spatie can() — User không được gán quyền Spatie (hotfix 2026-10-21).
     */
    private function canView(Request $request): bool
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\User) {
            return true;
        }
        if ($actor instanceof \App\Models\Employee) {
            if (!$actor->is_active) {
                return false;
            }
            $role = $actor->role;
            return $role && ($role->hasPermission('products.manage') || $role->hasPermission('reports.view'));
        }
        return false;
    }

    /** Giá vốn 1 NL theo đúng calcCost: đơn giá lô MỚI NHẤT ÷ hệ số quy đổi. */
    private function materialUnitCost(Material $m): float
    {
        $latest = $m->batches()->orderByDesc('id')->first();
        $unitCost = $latest ? (float) $latest->unit_cost : 0.0;
        $rate = (float) ($m->conversion_rate ?: 1);
        if ($rate > 0) {
            $unitCost = $unitCost / $rate;
        }
        return $unitCost;
    }

    /**
     * Giá vốn món nháp = Σ định lượng ĐỊNH MỨC CƠ BẢN × đơn giá NL (giống hệt calcCost
     * của món thật — định mức theo tùy chọn không tính vào giá vốn cơ bản).
     */
    private function draftCost(RdProduct $p): float
    {
        $cost = 0.0;
        foreach ($p->recipes as $r) {
            if ($r->product_option_id) {
                continue;
            }
            if (!$r->material) {
                continue;
            }
            $cost += (float) $r->quantity * $this->materialUnitCost($r->material);
        }
        return round($cost);
    }

    /** Serialize 1 nháp kèm các chỉ số R&D cho danh sách. */
    private function serializeDraft(RdProduct $p): array
    {
        $cost = $this->draftCost($p);
        $price = (float) $p->expected_price;
        $alertPct = (float) Setting::get('food_cost_alert_pct', '30');
        $foodCostPct = $price > 0 ? round($cost / $price * 100, 1) : null;

        return [
            'id' => $p->id,
            'name' => $p->name,
            'category_id' => $p->category_id,
            'category_name' => $p->category?->name,
            'unit' => $p->unit,
            'image_url' => $p->image_url,
            'expected_price' => $price,
            'status' => $p->status,
            'approved_product_id' => $p->approved_product_id,
            'materials_count' => $p->recipes->whereNull('product_option_id')->count(),
            'cost_price' => $cost,
            'food_cost_pct' => $foodCostPct,
            'gross_profit' => $price > 0 ? round($price - $cost) : null,
            'margin_pct' => $price > 0 ? round(($price - $cost) / $price * 100, 1) : null,
            'alert_level' => $foodCostPct === null ? null
                : ($foodCostPct > $alertPct + 10 ? 'red' : ($foodCostPct > $alertPct ? 'orange' : null)),
            'created_at' => $p->created_at,
            'approved_at' => $p->approved_at,
        ];
    }

    // ================= Meta cho form =================

    /** GET /rd/meta — dữ liệu nền cho cả 3 tab. */
    public function meta(Request $request): JsonResponse
    {
        if (!$this->canView($request)) {
            return response()->json(['success' => false, 'message' => 'Không có quyền xem R&D.'], 403);
        }

        $materials = Material::orderBy('name')->get()->map(function ($m) {
            return [
                'id' => $m->id,
                'name' => $m->name,
                'unit' => $m->unit,
                // Đơn giá đã quy về đơn vị cơ sở (đúng calcCost) để frontend tính giá vốn trực tiếp
                'cost_per_base' => $this->materialUnitCost($m),
            ];
        });

        return response()->json(['success' => true, 'data' => [
            'categories' => Category::orderBy('name')->get(['id', 'name']),
            'branches' => Branch::orderBy('name')->get(['id', 'name']),
            'materials' => $materials,
            'option_groups' => OptionGroup::with(['options' => fn($q) => $q->orderBy('sort_order')->orderBy('id')])
                ->orderBy('sort_order')->get(),
            'price_lists' => PriceList::orderBy('id')->get(['id', 'name']),
            'food_cost_alert_pct' => (float) Setting::get('food_cost_alert_pct', '30'),
            'expense_categories' => TransactionCategory::where('type', 'expense')->orderBy('name')->get(['id', 'name']),
            'utilities_category_id' => $this->utilitiesCategoryId(),
        ]]);
    }

    // ================= TAB 1 — MÓN NHÁP =================

    /** GET /rd/products — danh sách nháp (lọc trạng thái/danh mục/tìm kiếm). */
    public function index(Request $request): JsonResponse
    {
        if (!$this->canView($request)) {
            return response()->json(['success' => false, 'message' => 'Không có quyền xem R&D.'], 403);
        }

        $query = RdProduct::with(['category', 'recipes.material'])->orderByDesc('id');
        $status = $request->query('status', 'draft');
        if ($status !== 'all') {
            $query->where('status', $status);
        }
        if ($request->filled('category_id')) {
            $query->where('category_id', $request->query('category_id'));
        }
        if ($request->filled('search')) {
            $s = trim($request->query('search'));
            $query->where('name', 'like', "%{$s}%");
        }

        $list = $query->get()->map(fn($p) => $this->serializeDraft($p));
        return response()->json(['success' => true, 'data' => $list]);
    }

    /** GET /rd/products/{id} — chi tiết đầy đủ cho form sửa. */
    public function show(Request $request, int $id): JsonResponse
    {
        if (!$this->canView($request)) {
            return response()->json(['success' => false, 'message' => 'Không có quyền xem R&D.'], 403);
        }

        $p = RdProduct::with(['recipes.material', 'optionGroups', 'prices'])->findOrFail($id);
        $data = $this->serializeDraft($p);
        $data['description'] = $p->description;
        $data['option_group_ids'] = $p->optionGroups->pluck('id')->values();
        $data['prices'] = $p->prices->map(fn($pr) => ['price_list_id' => $pr->price_list_id, 'price' => (float) $pr->price])->values();
        $data['recipes'] = $p->recipes->whereNull('product_option_id')->values()->map(fn($r) => [
            'material_id' => $r->material_id, 'material_name' => $r->material?->name,
            'quantity' => (float) $r->quantity, 'kind' => $r->kind,
        ])->values();
        $data['option_recipes'] = $p->recipes->whereNotNull('product_option_id')->values()->map(fn($r) => [
            'product_option_id' => $r->product_option_id, 'material_id' => $r->material_id,
            'material_name' => $r->material?->name, 'quantity' => (float) $r->quantity, 'kind' => $r->kind,
        ])->values();
        return response()->json(['success' => true, 'data' => $data]);
    }

    private function draftRules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'unit' => 'nullable|string|max:50',
            'description' => 'nullable|string',
            'image_url' => 'nullable|string|max:500',
            'expected_price' => 'nullable|numeric|min:0',
            'option_group_ids' => 'nullable|array',
            'option_group_ids.*' => 'exists:option_groups,id',
            'prices' => 'nullable|array',
            'prices.*.price_list_id' => 'required|exists:price_lists,id',
            'prices.*.price' => 'required|numeric|min:0',
            'recipes' => 'nullable|array',
            'recipes.*.material_id' => 'required|exists:materials,id',
            'recipes.*.quantity' => 'required|numeric|min:0',
            'recipes.*.kind' => 'nullable|in:ingredient,packaging',
            'option_recipes' => 'nullable|array',
            'option_recipes.*.product_option_id' => 'required|exists:product_options,id',
            'option_recipes.*.material_id' => 'required|exists:materials,id',
            'option_recipes.*.quantity' => 'required|numeric|min:0',
            'option_recipes.*.kind' => 'nullable|in:ingredient,packaging',
        ];
    }

    /** Ghi toàn bộ quan hệ của nháp (định mức 2 loại + nhóm tùy chọn + giá kênh). */
    private function syncDraft(RdProduct $p, array $v): void
    {
        RdRecipe::where('rd_product_id', $p->id)->whereNull('product_option_id')->delete();
        foreach ($v['recipes'] ?? [] as $r) {
            if ((float) $r['quantity'] <= 0) {
                continue;
            }
            RdRecipe::create([
                'rd_product_id' => $p->id,
                'product_option_id' => null,
                'material_id' => $r['material_id'],
                'quantity' => $r['quantity'],
                'kind' => $r['kind'] ?? 'ingredient',
            ]);
        }
        RdRecipe::where('rd_product_id', $p->id)->whereNotNull('product_option_id')->delete();
        foreach ($v['option_recipes'] ?? [] as $r) {
            if ((float) $r['quantity'] <= 0) {
                continue;
            }
            RdRecipe::create([
                'rd_product_id' => $p->id,
                'product_option_id' => $r['product_option_id'],
                'material_id' => $r['material_id'],
                'quantity' => $r['quantity'],
                'kind' => $r['kind'] ?? 'ingredient',
            ]);
        }
        if (array_key_exists('option_group_ids', $v)) {
            $p->optionGroups()->sync($v['option_group_ids'] ?? []);
        }
        if (array_key_exists('prices', $v)) {
            foreach ($v['prices'] ?? [] as $pr) {
                if ((float) $pr['price'] <= 0) {
                    continue; // trống/0 = dùng giá dự kiến cho kênh đó
                }
                RdProductPrice::updateOrCreate(
                    ['rd_product_id' => $p->id, 'price_list_id' => $pr['price_list_id']],
                    ['price' => $pr['price']]
                );
            }
        }
    }

    /** POST /rd/products — tạo nháp. */
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate($this->draftRules());
        $p = DB::transaction(function () use ($request, $v) {
            $p = RdProduct::create([
                'name' => $v['name'],
                'category_id' => $v['category_id'] ?? null,
                'unit' => $v['unit'] ?? null,
                'description' => $v['description'] ?? null,
                'image_url' => $v['image_url'] ?? null,
                'expected_price' => $v['expected_price'] ?? 0,
                'status' => 'draft',
                'created_by' => $request->user()?->id,
            ]);
            $this->syncDraft($p, $v);
            return $p;
        });
        return response()->json(['success' => true, 'data' => $this->showDraftData($p)], 201);
    }

    /** PUT /rd/products/{id} — sửa nháp (đã duyệt = chỉ đọc). */
    public function update(Request $request, int $id): JsonResponse
    {
        $p = RdProduct::findOrFail($id);
        if ($p->status === 'approved') {
            return response()->json(['success' => false, 'message' => 'Nháp đã duyệt — chỉ đọc. Muốn biến thể mới hãy Nhân bản.'], 422);
        }
        $v = $request->validate($this->draftRules());
        DB::transaction(function () use ($p, $v) {
            $p->update([
                'name' => $v['name'],
                'category_id' => $v['category_id'] ?? null,
                'unit' => $v['unit'] ?? null,
                'description' => $v['description'] ?? null,
                'image_url' => $v['image_url'] ?? null,
                'expected_price' => $v['expected_price'] ?? 0,
            ]);
            $this->syncDraft($p, $v);
        });
        return response()->json(['success' => true, 'data' => $this->showDraftData($p->fresh())]);
    }

    private function showDraftData(RdProduct $p): array
    {
        $full = RdProduct::with(['recipes.material', 'optionGroups', 'prices', 'category'])->find($p->id);
        return $this->serializeDraft($full) + ['id' => $full->id];
    }

    /** Sửa nhanh giá dự kiến ngay ở danh sách (PUT /rd/products/{id}/quick-price). */
    public function quickPrice(Request $request, int $id): JsonResponse
    {
        $p = RdProduct::findOrFail($id);
        if ($p->status === 'approved') {
            return response()->json(['success' => false, 'message' => 'Nháp đã duyệt — chỉ đọc.'], 422);
        }
        $v = $request->validate(['expected_price' => 'required|numeric|min:0']);
        $p->update(['expected_price' => $v['expected_price']]);
        $p->load(['recipes.material', 'category']);
        return response()->json(['success' => true, 'data' => $this->serializeDraft($p)]);
    }

    /** POST /rd/products/{id}/clone — nhân bản thành nháp mới. */
    public function clone(Request $request, int $id): JsonResponse
    {
        $src = RdProduct::with(['recipes', 'prices', 'optionGroups'])->findOrFail($id);
        $p = DB::transaction(function () use ($request, $src) {
            $p = RdProduct::create([
                'name' => $src->name . ' — bản sao',
                'category_id' => $src->category_id,
                'unit' => $src->unit,
                'description' => $src->description,
                'image_url' => $src->image_url,
                'expected_price' => $src->expected_price,
                'status' => 'draft',
                'created_by' => $request->user()?->id,
            ]);
            foreach ($src->recipes as $r) {
                RdRecipe::create([
                    'rd_product_id' => $p->id,
                    'product_option_id' => $r->product_option_id,
                    'material_id' => $r->material_id,
                    'quantity' => $r->quantity,
                    'kind' => $r->kind,
                ]);
            }
            foreach ($src->prices as $pr) {
                RdProductPrice::create([
                    'rd_product_id' => $p->id,
                    'price_list_id' => $pr->price_list_id,
                    'price' => $pr->price,
                ]);
            }
            $p->optionGroups()->sync($src->optionGroups->pluck('id')->all());
            return $p;
        });
        return response()->json(['success' => true, 'data' => $this->showDraftData($p)], 201);
    }

    /**
     * POST /rd/products/{id}/approve — DUYỆT nháp thành món thật.
     * 1 transaction, dùng lại đúng logic ProductController@store: tạo products +
     * sync nhóm tùy chọn + upsert giá kênh + copy định mức (cơ bản + theo tùy chọn).
     */
    public function approve(Request $request, int $id): JsonResponse
    {
        $p = RdProduct::with(['recipes', 'prices', 'optionGroups'])->findOrFail($id);
        if ($p->status === 'approved') {
            return response()->json(['success' => false, 'message' => 'Nháp này đã được duyệt rồi.'], 422);
        }
        if ($p->status === 'discarded') {
            return response()->json(['success' => false, 'message' => 'Nháp đã bị loại — khôi phục về Nháp trước khi duyệt.'], 422);
        }
        if (trim($p->name) === '' || (float) $p->expected_price <= 0) {
            return response()->json(['success' => false, 'message' => 'Chưa duyệt được: cần tên món và Giá bán dự kiến > 0.'], 422);
        }
        if ($p->recipes->count() === 0) {
            return response()->json(['success' => false, 'message' => 'Chưa duyệt được: cần ít nhất 1 dòng định mức nguyên liệu.'], 422);
        }

        $product = DB::transaction(function () use ($request, $p) {
            $product = Product::create([
                'name' => $p->name,
                'category_id' => $p->category_id,
                'unit' => $p->unit,
                'slug' => Str::slug($p->name) . '-' . Str::random(4),
                'base_price' => $p->expected_price,
                'description' => $p->description,
                'image_url' => $p->image_url,
                // Cờ mặc định như tạo món thường
                'is_active' => true,
                'sell_on_pos' => true,
                'sell_on_zalo' => false,
            ]);

            if ($p->optionGroups->isNotEmpty()) {
                $product->optionGroups()->sync($p->optionGroups->pluck('id')->all());
            }
            // Giá kênh dự kiến → product_prices (upsert như syncPrices của store)
            foreach ($p->prices as $pr) {
                ProductPrice::updateOrCreate(
                    ['product_id' => $product->id, 'price_list_id' => $pr->price_list_id],
                    ['price' => $pr->price, 'is_active' => true]
                );
            }
            // Định mức → recipes (cơ bản product_option_id null + theo tùy chọn)
            foreach ($p->recipes as $r) {
                Recipe::create([
                    'product_id' => $product->id,
                    'product_option_id' => $r->product_option_id,
                    'material_id' => $r->material_id,
                    'quantity' => $r->quantity,
                    'kind' => $r->kind,
                ]);
            }

            $p->update([
                'status' => 'approved',
                'approved_product_id' => $product->id,
                'approved_by' => $request->user()?->id,
                'approved_at' => now(),
            ]);
            return $product;
        });

        return response()->json([
            'success' => true,
            'message' => 'Đã duyệt — món thật đã tạo ở Danh sách mặt hàng. Cần xếp vào Thực đơn mới bán được trên POS/Mini App.',
            'data' => ['product_id' => $product->id, 'product_name' => $product->name],
        ]);
    }

    /** POST /rd/products/{id}/discard — loại nháp (ẩn, khôi phục được). */
    public function discard(int $id): JsonResponse
    {
        $p = RdProduct::findOrFail($id);
        if ($p->status === 'approved') {
            return response()->json(['success' => false, 'message' => 'Nháp đã duyệt không loại được.'], 422);
        }
        $p->update(['status' => 'discarded']);
        return response()->json(['success' => true]);
    }

    /** POST /rd/products/{id}/restore — khôi phục nháp đã loại về draft. */
    public function restore(int $id): JsonResponse
    {
        $p = RdProduct::findOrFail($id);
        if ($p->status !== 'discarded') {
            return response()->json(['success' => false, 'message' => 'Chỉ khôi phục được nháp đang ở trạng thái Đã loại.'], 422);
        }
        $p->update(['status' => 'draft']);
        return response()->json(['success' => true]);
    }

    /** DELETE /rd/products/{id} — xóa hẳn CHỈ khi chưa từng duyệt. */
    public function destroy(int $id): JsonResponse
    {
        $p = RdProduct::findOrFail($id);
        if ($p->status === 'approved' || $p->approved_product_id) {
            return response()->json(['success' => false, 'message' => 'Nháp đã duyệt không xóa được (giữ để tra cứu).'], 422);
        }
        $p->delete();
        return response()->json(['success' => true]);
    }

    // ================= TAB 2 — CHI PHÍ CỐ ĐỊNH =================

    /** N tháng TRỌN gần nhất (không gồm tháng hiện tại): [{ym:'2026-09', label:'09/2026'}...] */
    private function lastFullMonths(int $n): array
    {
        $out = [];
        $cursor = now()->startOfMonth()->subMonths($n);
        for ($i = 0; $i < $n; $i++) {
            $out[] = ['ym' => $cursor->format('Y-m'), 'label' => $cursor->format('m/Y')];
            $cursor->addMonth();
        }
        return $out;
    }

    /** Nhãn kỳ cho các tháng trọn: "TB 3 tháng 07–09/2026". */
    private function periodNote(array $months): string
    {
        $first = $months[0] ?? null;
        $last = $months[count($months) - 1] ?? null;
        if (!$first || !$last) {
            return '';
        }
        $f = Carbon::createFromFormat('Y-m', $first['ym']);
        $l = Carbon::createFromFormat('Y-m', $last['ym']);
        return 'TB ' . count($months) . ' tháng ' . $f->format('m') . '–' . $l->format('m/Y');
    }

    /** Danh mục chi cho khoản Điện nước: id lưu ở setting; mặc định danh mục tên "Điện nước". */
    private function utilitiesCategoryId(): ?int
    {
        $id = (int) Setting::get('rd_utilities_category_id', '0');
        if ($id > 0 && TransactionCategory::where('id', $id)->where('type', 'expense')->exists()) {
            return $id;
        }
        $cat = TransactionCategory::where('type', 'expense')->where('name', 'Điện nước')->first();
        if ($cat) {
            Setting::set('rd_utilities_category_id', (string) $cat->id);
            return $cat->id;
        }
        return null;
    }

    /** PUT /rd/utilities-category — đổi danh mục chi dùng cho khoản Điện nước tự động. */
    public function setUtilitiesCategory(Request $request): JsonResponse
    {
        $v = $request->validate(['category_id' => 'required|exists:transaction_categories,id']);
        Setting::set('rd_utilities_category_id', (string) $v['category_id']);
        return response()->json(['success' => true]);
    }

    /** Tính số TỰ ĐỘNG cho 1 nguồn + nhãn kỳ tính. Trả [amount, note]. */
    private function autoAmount(string $source, ?int $branchId): array
    {
        $months = $this->lastFullMonths(3);
        $noteBase = $this->periodNote($months);

        if ($source === 'auto_salary') {
            $salary = app(SalaryController::class);
            $total = 0.0;
            $allLocked = $branchId === null;
            foreach ($months as $m) {
                if ($branchId === null) {
                    $lock = PayrollLock::get($m['ym']);
                    if ($lock) {
                        $total += (float) $lock->net_total;
                        continue;
                    }
                    $allLocked = false;
                }
                [, $grand] = $salary->buildPayrollData($m['ym'], $branchId);
                $total += (float) $grand;
            }
            $note = $noteBase . ($allLocked ? ' — theo kỳ lương đã chốt' : ' — ước tính từ giờ công');
            return [round($total / 3), $note];
        }

        if ($source === 'auto_rent') {
            $q = PrepaidExpense::where('category', 'rent')->where('is_active', true);
            if ($branchId !== null) {
                $q->where('branch_id', $branchId);
            }
            $sum = 0.0;
            foreach ($q->get() as $pe) {
                $sum += $pe->monthlyAmount();
            }
            return [round($sum), 'Từ Chi phí trả trước — mặt bằng, phân bổ đều theo tháng'];
        }

        if ($source === 'auto_utilities') {
            $catId = $this->utilitiesCategoryId();
            if (!$catId) {
                return [0, 'Chưa chọn danh mục chi cho điện nước'];
            }
            $from = Carbon::createFromFormat('Y-m', $months[0]['ym'])->startOfMonth();
            $to = Carbon::createFromFormat('Y-m', $months[count($months) - 1]['ym'])->endOfMonth();
            $q = Transaction::where('type', 'expense')->where('status', 'paid')
                ->where('category_id', $catId)
                ->whereBetween('paid_at', [$from->toDateString(), $to->toDateString()]);
            if ($branchId !== null) {
                $q->where('branch_id', $branchId);
            }
            $sum = (float) $q->sum('amount');
            $catName = TransactionCategory::find($catId)?->name ?? '';
            return [round($sum / 3), $noteBase . ' — phiếu chi đã trả, danh mục "' . $catName . '"'];
        }

        return [0, ''];
    }

    /** Seed 3 khoản tự động cho 1 phạm vi nếu chưa có (mỗi phạm vi có bộ dòng riêng). */
    private function ensureSeed(?int $branchId): void
    {
        $defaults = [
            'auto_salary' => 'Lương nhân viên',
            'auto_rent' => 'Mặt bằng',
            'auto_utilities' => 'Điện nước',
        ];
        foreach ($defaults as $source => $name) {
            $exists = RdFixedCost::where('source', $source)
                ->where(function ($q) use ($branchId) {
                    $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                })->exists();
            if (!$exists) {
                [$amount, $note] = $this->autoAmount($source, $branchId);
                RdFixedCost::create([
                    'branch_id' => $branchId,
                    'name' => $name,
                    'amount' => $amount,
                    'source' => $source,
                    'source_note' => $note,
                    'is_overridden' => false,
                ]);
            }
        }
    }

    /** Nạp danh sách CP cố định của phạm vi (tự làm tươi dòng auto chưa bị ghi đè) + tổng. */
    private function loadFixedCosts(?int $branchId): array
    {
        $this->ensureSeed($branchId);
        $scope = function ($q) use ($branchId) {
            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        };
        $rows = RdFixedCost::where($scope)->orderBy('id')->get();

        foreach ($rows as $row) {
            if ($row->source !== 'manual' && !$row->is_overridden) {
                [$amount, $note] = $this->autoAmount($row->source, $branchId);
                if ((float) $row->amount !== (float) $amount || $row->source_note !== $note) {
                    $row->update(['amount' => $amount, 'source_note' => $note]);
                }
            }
        }
        $rows = RdFixedCost::where($scope)->orderBy('id')->get();
        $total = (float) RdFixedCost::where($scope)->sum('amount');

        return [$rows, $total];
    }

    /** GET /rd/fixed-costs?branch_id= (trống = toàn hệ thống). */
    public function fixedCosts(Request $request): JsonResponse
    {
        if (!$this->canView($request)) {
            return response()->json(['success' => false, 'message' => 'Không có quyền xem R&D.'], 403);
        }
        $branchId = $request->filled('branch_id') ? (int) $request->query('branch_id') : null;
        [$rows, $total] = $this->loadFixedCosts($branchId);
        return response()->json(['success' => true, 'data' => [
            'rows' => $rows,
            'total' => $total,
            'utilities_category_id' => $this->utilitiesCategoryId(),
        ]]);
    }

    /** POST /rd/fixed-costs — thêm dòng nhập tay. */
    public function storeFixedCost(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'required|string|max:100',
            'amount' => 'required|numeric|min:0',
        ]);
        $row = RdFixedCost::create([
            'branch_id' => $v['branch_id'] ?? null,
            'name' => $v['name'],
            'amount' => $v['amount'],
            'source' => 'manual',
            'source_note' => 'Nhập tay',
            'is_overridden' => false,
            'updated_by' => $request->user()?->id,
        ]);
        return response()->json(['success' => true, 'data' => $row], 201);
    }

    /**
     * PUT /rd/fixed-costs/{id} — sửa tay (dòng auto → is_overridden, ngừng tự cập nhật)
     * hoặc reset_auto=true để "Lấy lại số tự động".
     */
    public function updateFixedCost(Request $request, int $id): JsonResponse
    {
        $row = RdFixedCost::findOrFail($id);

        if ($request->boolean('reset_auto') && $row->source !== 'manual') {
            [$amount, $note] = $this->autoAmount($row->source, $row->branch_id);
            $row->update([
                'amount' => $amount,
                'source_note' => $note,
                'is_overridden' => false,
                'updated_by' => $request->user()?->id,
            ]);
            return response()->json(['success' => true, 'data' => $row->fresh()]);
        }

        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'amount' => 'sometimes|numeric|min:0',
        ]);
        $data = $v + ['updated_by' => $request->user()?->id];
        if ($row->source !== 'manual') {
            $data['is_overridden'] = true;
        }
        $row->update($data);
        return response()->json(['success' => true, 'data' => $row->fresh()]);
    }

    /** DELETE /rd/fixed-costs/{id} — chỉ xóa dòng nhập tay (dòng auto sẽ tự seed lại). */
    public function destroyFixedCost(int $id): JsonResponse
    {
        $row = RdFixedCost::findOrFail($id);
        if ($row->source !== 'manual') {
            return response()->json(['success' => false, 'message' => 'Khoản tự động không xóa được — hãy sửa số tiền về 0 hoặc ghi đè tay.'], 422);
        }
        $row->delete();
        return response()->json(['success' => true]);
    }

    // ================= TAB 3 — ĐIỂM HÒA VỐN (công thức spec 5.2) =================

    /**
     * Giá vốn NL của 1 tập dòng đơn — ĐÚNG thuật toán ReportController::bomCost:
     * ưu tiên unit_cost đã chốt lúc trừ kho; không có thì fallback BOM (giá vốn BQ
     * theo lô active, kèm định mức theo tùy chọn).
     */
    private function bomCostForItems($items, ?int $branchId): float
    {
        if ($items->isEmpty()) {
            return 0.0;
        }
        $lockedCost = 0.0;
        $hasLocked = false;
        foreach ($items as $it) {
            if ($it->unit_cost !== null) {
                $hasLocked = true;
                $lockedCost += (float) $it->unit_cost * (float) $it->quantity;
            }
        }
        if ($hasLocked) {
            return $lockedCost;
        }
        $recipes = \App\Models\Recipe::query()->select('product_id', 'product_option_id', 'material_id', 'quantity')->get();
        if ($recipes->isEmpty()) {
            return 0.0;
        }
        $costQ = \App\Models\Batch::query()->where('status', 'active')->where('current_quantity', '>', 0);
        if ($branchId) {
            $costQ->where('branch_id', $branchId);
        }
        $avgCost = [];
        foreach ($costQ->select('material_id', 'current_quantity', 'unit_cost')->get() as $b) {
            $mid = $b->material_id;
            if (!isset($avgCost[$mid])) {
                $avgCost[$mid] = ['q' => 0.0, 'c' => 0.0];
            }
            $avgCost[$mid]['q'] += (float) $b->current_quantity;
            $avgCost[$mid]['c'] += (float) $b->current_quantity * (float) $b->unit_cost;
        }
        foreach ($avgCost as $mid => $a) {
            $avgCost[$mid] = $a['q'] > 0 ? $a['c'] / $a['q'] : 0.0;
        }
        $total = 0.0;
        foreach ($items as $it) {
            $itemOptionIds = [];
            if (!empty($it->product_option_id)) {
                $itemOptionIds[] = (int) $it->product_option_id;
            }
            $opts = $it->options ? (array) $it->options : [];
            foreach (array_keys($opts) as $oid) {
                $itemOptionIds[] = (int) $oid;
            }
            $itemOptionIds = array_values(array_unique($itemOptionIds));
            foreach ($recipes as $r) {
                if ((int) $r->product_id !== (int) $it->product_id) {
                    continue;
                }
                if ($r->product_option_id !== null && !in_array((int) $r->product_option_id, $itemOptionIds, true)) {
                    continue;
                }
                $total += (float) $r->quantity * (float) $it->quantity * ($avgCost[$r->material_id] ?? 0.0);
            }
        }
        return $total;
    }

    /** CM% thay thế: tỷ suất LN bình quân các món đang bán (đúng cách Menu Engineering). */
    private function fallbackMarginPct(?int $branchId): ?float
    {
        $rows = DB::table('order_items as oi')
            ->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->where('o.status', '!=', 'cancelled')
            ->where('o.payment_status', 'paid')
            ->when($branchId, fn($q) => $q->where('o.branch_id', $branchId))
            ->groupBy('oi.product_id')
            ->selectRaw('SUM(oi.quantity * oi.price) as revenue')
            ->selectRaw('SUM(oi.quantity * COALESCE(oi.unit_cost, 0)) as cogs')
            ->get();
        $margins = [];
        foreach ($rows as $r) {
            $rev = (float) $r->revenue;
            if ($rev > 0) {
                $margins[] = ($rev - (float) $r->cogs) / $rev * 100;
            }
        }
        if (empty($margins)) {
            return null;
        }
        return round(array_sum($margins) / count($margins), 2);
    }

    /** GET /rd/break-even?branch_id=&months=1|3|6 — điểm hòa vốn theo công thức 5.2. */
    public function breakEven(Request $request): JsonResponse
    {
        if (!$this->canView($request)) {
            return response()->json(['success' => false, 'message' => 'Không có quyền xem R&D.'], 403);
        }
        $branchId = $request->filled('branch_id') ? (int) $request->query('branch_id') : null;
        $monthsCount = (int) $request->query('months', 3);
        if (!in_array($monthsCount, [1, 3, 6], true)) {
            $monthsCount = 3;
        }

        // F — tổng CP cố định/tháng của phạm vi (Tab 2)
        [, $fixedTotal] = $this->loadFixedCosts($branchId);

        // Kỳ tính: N tháng trọn gần nhất
        $months = $this->lastFullMonths($monthsCount);
        $from = Carbon::createFromFormat('Y-m', $months[0]['ym'])->startOfMonth();
        $to = Carbon::createFromFormat('Y-m', $months[count($months) - 1]['ym'])->endOfMonth();

        $orders = \App\Models\Order::where('payment_status', 'paid')
            ->where('status', '!=', 'cancelled')
            ->whereBetween('created_at', [$from->toDateTimeString(), $to->toDateTimeString()])
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->get(['id', 'subtotal_amount', 'discount_amount', 'commission_amount']);
        $orderCount = $orders->count();
        $revenue = (float) $orders->sum(fn($o) => (float) $o->subtotal_amount - (float) $o->discount_amount);
        $commission = (float) $orders->sum('commission_amount');
        $items = \App\Models\OrderItem::whereIn('order_id', $orders->pluck('id')->all())->get();
        $bomCost = $this->bomCostForItems($items, $branchId);
        $variableCost = $bomCost + $commission;

        // CM% theo công thức 5.2; kỳ thiếu dữ liệu → CM% thay thế (ghi rõ nguồn)
        $cmPct = null;
        $cmSource = 'sales';
        $lowData = $orderCount < 30 || $revenue <= 0;
        if (!$lowData) {
            $cmPct = ($revenue - $variableCost) / $revenue * 100;
            if ($cmPct <= 0) {
                $lowData = true;
            }
        }
        if ($lowData) {
            $cmPct = $this->fallbackMarginPct($branchId);
            $cmSource = 'menu_engineering_avg';
        }

        // Tháng hiện tại: thực tế + dự phóng theo nhịp
        $cmFrom = now()->startOfMonth();
        $cmOrders = \App\Models\Order::where('payment_status', 'paid')
            ->where('status', '!=', 'cancelled')
            ->where('created_at', '>=', $cmFrom->toDateTimeString())
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->get(['subtotal_amount', 'discount_amount']);
        $actualRevenue = (float) $cmOrders->sum(fn($o) => (float) $o->subtotal_amount - (float) $o->discount_amount);
        $daysInMonth = now()->daysInMonth;
        $dayOfMonth = max(1, (int) now()->format('d'));
        $projectedRevenue = $actualRevenue / $dayOfMonth * $daysInMonth;

        $breakevenRevenue = null;
        $ordersPerDay = null;
        $revenuePerDay = null;
        $progressPct = null;
        $verdict = null;
        if ($cmPct !== null && $cmPct > 0) {
            $breakevenRevenue = $fixedTotal / ($cmPct / 100);
            $revenuePerDay = $breakevenRevenue / $daysInMonth;
            $aov = $orderCount > 0 ? $revenue / $orderCount : null;
            $ordersPerDay = $aov && $aov > 0 ? $breakevenRevenue / $aov / $daysInMonth : null;
            $progressPct = $breakevenRevenue > 0 ? round($projectedRevenue / $breakevenRevenue * 100, 1) : null;
            if ($progressPct !== null) {
                $verdict = $progressPct >= 100
                    ? 'Đang trên hòa vốn ~' . round($progressPct - 100) . '%'
                    : 'Đang dưới hòa vốn ~' . round(100 - $progressPct) . '%';
            }
        }

        return response()->json(['success' => true, 'data' => [
            'branch_id' => $branchId,
            'period' => [
                'months' => $monthsCount,
                'from' => $from->toDateString(),
                'to' => $to->toDateString(),
                'label' => $this->periodNote($months),
            ],
            'fixed_total' => round($fixedTotal),
            'orders_count' => $orderCount,
            'revenue' => round($revenue),
            'bom_cost' => round($bomCost),
            'commission' => round($commission),
            'variable_cost' => round($variableCost),
            'cm_pct' => $cmPct !== null ? round($cmPct, 2) : null,
            'cm_source' => $cmSource,
            'low_data_warning' => $lowData,
            'aov' => $orderCount > 0 ? round($revenue / $orderCount) : null,
            'breakeven_revenue' => $breakevenRevenue !== null ? round($breakevenRevenue) : null,
            'orders_per_day_needed' => $ordersPerDay !== null ? round($ordersPerDay, 1) : null,
            'revenue_per_day_needed' => $revenuePerDay !== null ? round($revenuePerDay) : null,
            'current_month' => [
                'actual_revenue' => round($actualRevenue),
                'projected_revenue' => round($projectedRevenue),
                'progress_pct' => $progressPct,
                'verdict' => $verdict,
            ],
        ]]);
    }
}

