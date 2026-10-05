<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MembershipTier;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 5 (2026-10-05): Hạng thành viên + cấu hình quy đổi điểm.
class MembershipTierController extends Controller
{
    public function index(): JsonResponse
    {
        $tiers = MembershipTier::withCount('customers')->orderBy('sort_order')->get();
        return response()->json([
            'success' => true,
            'data' => $tiers,
            'redeem_config' => [
                'points' => (int) Setting::get('points_redeem_points', 10),
                'amount' => (float) Setting::get('points_redeem_amount', 1000),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'min_total_spent' => 'required|numeric|min:0',
            'earn_per_amount' => 'required|numeric|min:1',
            'earn_points' => 'required|integer|min:1',
            'is_default' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        if (!empty($validated['is_default'])) {
            MembershipTier::where('is_default', true)->update(['is_default' => false]);
        }

        $tier = MembershipTier::create($validated);
        return response()->json(['success' => true, 'data' => $tier], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $tier = MembershipTier::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'min_total_spent' => 'sometimes|numeric|min:0',
            'earn_per_amount' => 'sometimes|numeric|min:1',
            'earn_points' => 'sometimes|integer|min:1',
            'is_default' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);

        if (!empty($validated['is_default'])) {
            MembershipTier::where('is_default', true)->where('id', '!=', $id)->update(['is_default' => false]);
        }

        $tier->update($validated);
        return response()->json(['success' => true, 'data' => $tier]);
    }

    public function destroy(int $id): JsonResponse
    {
        $tier = MembershipTier::findOrFail($id);
        if ($tier->customers()->exists()) {
            return response()->json(['success' => false, 'message' => 'Hạng đang có thành viên, không thể xóa.'], 400);
        }
        $tier->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa hạng']);
    }

    // Cấu hình quy đổi điểm: X điểm = Y đồng (VD: 10 điểm = 1.000đ)
    public function updateRedeemConfig(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'points' => 'required|integer|min:1',
            'amount' => 'required|numeric|min:1',
        ]);
        Setting::set('points_redeem_points', $validated['points']);
        Setting::set('points_redeem_amount', $validated['amount']);
        return response()->json(['success' => true, 'message' => 'Đã lưu cấu hình quy đổi điểm']);
    }
}
