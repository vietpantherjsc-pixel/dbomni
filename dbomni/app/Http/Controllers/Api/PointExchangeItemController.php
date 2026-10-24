<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PointExchangeItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Loyalty 2.0 (2026-10-21): Admin CRUD món trong Cửa hàng điểm (spec mục 6.3).
// Admin tự cài đặt theo mùa — không hardcode danh sách món khởi điểm.
class PointExchangeItemController extends Controller
{
    public function index(): JsonResponse
    {
        $items = PointExchangeItem::with(['promotion:id,name,code', 'minTier:id,name'])
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
        return response()->json(['success' => true, 'data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'icon' => 'nullable|string|max:50',
            'promotion_id' => 'required|exists:promotions,id',
            'points_cost' => 'required|integer|min:1',
            'min_tier_id' => 'nullable|exists:membership_tiers,id',
            'daily_limit' => 'nullable|integer|min:1',
            'per_customer_limit' => 'nullable|integer|min:1',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);
        $item = PointExchangeItem::create($validated);
        return response()->json(['success' => true, 'data' => $item->load(['promotion:id,name,code', 'minTier:id,name'])], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $item = PointExchangeItem::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:150',
            'icon' => 'nullable|string|max:50',
            'promotion_id' => 'sometimes|exists:promotions,id',
            'points_cost' => 'sometimes|integer|min:1',
            'min_tier_id' => 'nullable|exists:membership_tiers,id',
            'daily_limit' => 'nullable|integer|min:1',
            'per_customer_limit' => 'nullable|integer|min:1',
            'sort_order' => 'nullable|integer|min:0',
            'is_active' => 'nullable|boolean',
        ]);
        $item->update($validated);
        return response()->json(['success' => true, 'data' => $item->load(['promotion:id,name,code', 'minTier:id,name'])]);
    }

    public function destroy(int $id): JsonResponse
    {
        $item = PointExchangeItem::findOrFail($id);
        $item->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa món đổi điểm.']);
    }
}
