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
            // Giữ tương thích ngược (key cũ ngừng dùng cho trừ điểm từ Loyalty 2.0)
            'redeem_config' => [
                'points' => (int) Setting::get('points_redeem_points', 10),
                'amount' => (float) Setting::get('points_redeem_amount', 1000),
            ],
            // Loyalty 2.0: cấu hình toàn cục (spec mục 1.5) + Double Days + coupon chào hạng
            'loyalty_config' => $this->loyaltyConfig(),
        ]);
    }

    /** Đọc toàn bộ cấu hình Loyalty từ settings kèm mặc định theo spec. */
    private function loyaltyConfig(): array
    {
        $dd = \App\Services\LoyaltyService::doublePointsSettings();
        return [
            'tier_window_days' => (int) Setting::get('tier_window_days', 60),
            'tier_downgrade_notice_days' => (int) Setting::get('tier_downgrade_notice_days', 10),
            'tier_grace_first_cycle' => filter_var(Setting::get('tier_grace_first_cycle', '1'), FILTER_VALIDATE_BOOLEAN),
            'points_expire_months' => (int) Setting::get('points_expire_months', 12),
            'points_expiry_warn_days' => (int) Setting::get('points_expiry_warn_days', 30),
            'points_point_value' => (int) Setting::get('points_point_value', 100),
            'tier_up_promotion_id' => Setting::get('tier_up_promotion_id') ? (int) Setting::get('tier_up_promotion_id') : null,
            // Fix L1 (2026-10-21): khóa MỚI double_points_* (đọc qua helper có fallback khóa cũ)
            'double_points_enabled' => $dd['enabled'],
            'double_points_start' => $dd['start'],
            'double_points_end' => $dd['end'],
            'double_points_multiplier' => $dd['multiplier'],
        ];
    }

    /** Lưu cấu hình Loyalty (trang Thẻ thành viên — khu Cấu hình Loyalty). */
    public function updateLoyaltyConfig(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tier_window_days' => 'required|integer|min:1|max:3650',
            'tier_downgrade_notice_days' => 'required|integer|min:0|max:365',
            'tier_grace_first_cycle' => 'required|boolean',
            'points_expire_months' => 'required|integer|min:1|max:120',
            'points_expiry_warn_days' => 'required|integer|min:1|max:365',
            'points_point_value' => 'required|integer|min:0',
            'tier_up_promotion_id' => 'nullable|exists:promotions,id',
            // Fix L1 (2026-10-21): khóa MỚI double_points_* + công tắc bật/tắt riêng
            'double_points_enabled' => 'nullable|boolean',
            'double_points_start' => 'nullable|date',
            'double_points_end' => 'nullable|date|after_or_equal:double_points_start',
            'double_points_multiplier' => 'nullable|numeric|min:1|max:10',
        ]);
        Setting::set('tier_window_days', $validated['tier_window_days']);
        Setting::set('tier_downgrade_notice_days', $validated['tier_downgrade_notice_days']);
        Setting::set('tier_grace_first_cycle', $validated['tier_grace_first_cycle'] ? '1' : '0');
        Setting::set('points_expire_months', $validated['points_expire_months']);
        Setting::set('points_expiry_warn_days', $validated['points_expiry_warn_days']);
        Setting::set('points_point_value', $validated['points_point_value']);
        Setting::set('tier_up_promotion_id', $validated['tier_up_promotion_id'] ?? '');
        // Fix L1: ghi khóa MỚI double_points_* và XÓA khóa CŨ double_days_* để không còn 2 nguồn
        Setting::set('double_points_enabled', !empty($validated['double_points_enabled']) ? '1' : '0');
        Setting::set('double_points_start', $validated['double_points_start'] ?? '');
        Setting::set('double_points_end', $validated['double_points_end'] ?? '');
        Setting::set('double_points_multiplier', $validated['double_points_multiplier'] ?? '');
        Setting::query()->whereIn('key', ['double_days_start', 'double_days_end', 'double_days_multiplier'])->delete();
        return response()->json(['success' => true, 'message' => 'Đã lưu cấu hình Loyalty', 'loyalty_config' => $this->loyaltyConfig()]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'code' => 'nullable|string|max:50|unique:membership_tiers,code',
            'min_total_spent' => 'required|numeric|min:0',
            'min_spent_window' => 'nullable|numeric|min:0',
            'keep_spent_window' => 'nullable|numeric|min:0',
            'earn_per_amount' => 'required|numeric|min:1',
            'earn_points' => 'required|integer|min:1',
            'earn_multiplier' => 'nullable|numeric|min:0|max:100',
            'points_discount_pct' => 'nullable|integer|min:0|max:100',
            'benefits' => 'nullable|array',
            'is_default' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);
        $validated['code'] = $validated['code'] ?? \Illuminate\Support\Str::slug($validated['name'], '_');
        $validated['min_spent_window'] = $validated['min_spent_window'] ?? $validated['min_total_spent'];

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
            'code' => 'nullable|string|max:50|unique:membership_tiers,code,' . $id,
            'min_total_spent' => 'sometimes|numeric|min:0',
            'min_spent_window' => 'nullable|numeric|min:0',
            'keep_spent_window' => 'nullable|numeric|min:0',
            'earn_per_amount' => 'sometimes|numeric|min:1',
            'earn_points' => 'sometimes|integer|min:1',
            'earn_multiplier' => 'nullable|numeric|min:0|max:100',
            'points_discount_pct' => 'nullable|integer|min:0|max:100',
            'benefits' => 'nullable|array',
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
