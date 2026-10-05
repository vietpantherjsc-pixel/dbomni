<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 6 (2026-10-05): Cập nhật cấu hình hệ thống (phí ship...).
class SettingsController extends Controller
{
    // Gói 8a: lấy toàn bộ cấu hình (thuế, giá...)
    public function index(): JsonResponse
    {
        return response()->json([
            'price_includes_tax' => Setting::get('price_includes_tax', '1'),
            'default_tax_rate' => Setting::get('default_tax_rate', '8'),
            'theme_primary' => Setting::get('theme_primary', '#24305E'),
            // Gói 8f: số thập phân
            'decimals_price' => Setting::get('decimals_price', '0'),
            'decimals_quantity' => Setting::get('decimals_quantity', '1'),
            'decimals_tax' => Setting::get('decimals_tax', '0'),
            'decimals_discount' => Setting::get('decimals_discount', '0'),
            // Gói 9: cover Mini App + điểm thưởng giới thiệu
            'shop_cover_url' => Setting::get('shop_cover_url', ''),
            'ref_bonus_points' => Setting::get('ref_bonus_points', '100'),
        ]);
    }

    // Gói 7p: lấy màu chủ đạo giao diện (admin)
    public function theme(): JsonResponse
    {
        return response()->json([
            'primary' => Setting::get('theme_primary', '#24305E'),
        ]);
    }

    // Gói 7p: lấy màu chủ đạo giao diện (public cho Mini App)
    public function publicTheme(): JsonResponse
    {
        return response()->json([
            'primary' => Setting::get('theme_primary', '#24305E'),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'settings' => 'required|array',
            'settings.*' => 'nullable|string|max:255',
        ]);

        foreach ($validated['settings'] as $key => $value) {
            Setting::set($key, $value ?? '');
        }

        return response()->json(['success' => true, 'message' => 'Đã lưu cấu hình.']);
    }
}
