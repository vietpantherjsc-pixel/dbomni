<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PriceList;
use App\Models\SharedCategory;
use Database\Seeders\SharedCategorySeeder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

// Spec danh mục dùng chung (Đại Vương chốt 2026-10-19): CRUD 13 tab danh mục nghiệp vụ.
// - GET /api/shared-categories?group= : public, chỉ bản ghi active (dropdown).
//   Riêng group=payment_channels là ẢO — đọc động từ price_lists (kênh active).
// - Các endpoint còn lại cần quyền settings.edit (route).
class SharedCategoryController extends Controller
{
    // Public: dropdown — [{code, name}] active, theo sort_order
    public function index(Request $request): JsonResponse
    {
        $group = (string) $request->query('group', '');
        if ($group === 'payment_channels') {
            $pls = PriceList::where('is_active', true)->orderBy('sort_order')->orderBy('id')->get(['code', 'name', 'category']);
            $out = $pls->map(fn($pl) => ['code' => $pl->code, 'name' => $pl->name, 'category' => $pl->category ?? 'partner'])->all();
            return response()->json(['success' => true, 'data' => $out]);
        }
        if (!isset(SharedCategorySeeder::GROUPS[$group])) {
            return response()->json(['success' => false, 'message' => 'Nhóm danh mục không hợp lệ.'], 422);
        }
        // Fallback DEFAULTS khi chưa migrate
        if (!\Illuminate\Support\Facades\Schema::hasTable('shared_categories')) {
            $rows = collect(SharedCategory::defaultMap($group))->map(fn($name, $code) => ['code' => $code, 'name' => $name])->values();
            return response()->json(['success' => true, 'data' => $rows]);
        }
        $rows = SharedCategory::where('group', $group)->where('is_active', true)
            ->orderBy('sort_order')->orderBy('id')
            ->get(['code', 'name']);
        if ($rows->isEmpty()) {
            $rows = collect(SharedCategory::defaultMap($group))->map(fn($name, $code) => ['code' => $code, 'name' => $name])->values();
        }
        return response()->json(['success' => true, 'data' => $rows]);
    }

    // Admin: xem tất cả (kể cả đã tắt) theo nhóm
    public function adminIndex(Request $request): JsonResponse
    {
        $group = (string) $request->query('group', '');
        if (!isset(SharedCategorySeeder::GROUPS[$group]) || $group === 'payment_channels') {
            return response()->json(['success' => false, 'message' => 'Nhóm danh mục không hợp lệ.'], 422);
        }
        $rows = SharedCategory::where('group', $group)->orderBy('sort_order')->orderBy('id')->get();
        return response()->json(['success' => true, 'data' => $rows]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'group' => ['required', Rule::in(array_keys(SharedCategorySeeder::GROUPS))],
            'code' => 'required|string|max:50',
            'name' => 'required|string|max:150',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);
        if ($validated['group'] === 'payment_channels') {
            return response()->json(['success' => false, 'message' => 'Kênh PTTT đọc từ Kênh bán hàng, không thêm tay ở đây.'], 422);
        }
        $exists = SharedCategory::where('group', $validated['group'])->where('code', $validated['code'])->exists();
        if ($exists) {
            return response()->json(['success' => false, 'message' => 'Mã này đã tồn tại trong nhóm.'], 422);
        }
        if (!isset($validated['sort_order'])) {
            $validated['sort_order'] = (int) (SharedCategory::where('group', $validated['group'])->max('sort_order') ?? -1) + 1;
        }
        $row = SharedCategory::create($validated);
        SharedCategory::flushCache($validated['group']);
        return response()->json(['success' => true, 'data' => $row], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $row = SharedCategory::findOrFail($id);
        $validated = $request->validate([
            'code' => 'sometimes|string|max:50',
            'name' => 'sometimes|string|max:150',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);
        if (isset($validated['code']) && $validated['code'] !== $row->code) {
            $exists = SharedCategory::where('group', $row->group)->where('code', $validated['code'])->exists();
            if ($exists) {
                return response()->json(['success' => false, 'message' => 'Mã này đã tồn tại trong nhóm.'], 422);
            }
        }
        $row->update($validated);
        SharedCategory::flushCache($row->group);
        return response()->json(['success' => true, 'data' => $row]);
    }

    public function destroy(int $id): JsonResponse
    {
        $row = SharedCategory::findOrFail($id);
        $group = $row->group;
        $row->delete();
        SharedCategory::flushCache($group);
        return response()->json(['success' => true]);
    }

    // Nút "Khôi phục mặc định": thêm lại code mặc định bị thiếu/tắt (không xóa custom)
    public function restoreDefaults(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'group' => ['required', Rule::in(array_keys(SharedCategorySeeder::GROUPS))],
        ]);
        if ($validated['group'] === 'payment_channels') {
            return response()->json(['success' => false, 'message' => 'Nhóm này đọc động, không cần khôi phục.'], 422);
        }
        $added = SharedCategorySeeder::restoreGroup($validated['group']);
        SharedCategory::flushCache($validated['group']);
        return response()->json(['success' => true, 'restored' => $added]);
    }

    // Danh sách 13 tab cho UI (tên nhóm)
    public function groups(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => SharedCategorySeeder::GROUPS]);
    }
}
