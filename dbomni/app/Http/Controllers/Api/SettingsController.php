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
            // Gói 26: phụ cấp ăn + tỷ lệ BHXH
            'meal_allowance_min_hours' => Setting::get('meal_allowance_min_hours', '8'),
            'meal_allowance_amount' => Setting::get('meal_allowance_amount', '25000'),
            'bhxh_emp_bhxh' => Setting::get('bhxh_emp_bhxh', '8'),
            'bhxh_emp_bhyt' => Setting::get('bhxh_emp_bhyt', '1.5'),
            'bhxh_emp_bhtn' => Setting::get('bhxh_emp_bhtn', '1'),
            'bhxh_employer_rate' => Setting::get('bhxh_employer_rate', '21.5'),
            // Gói 37: hạn chót đăng ký ca (thứ 0=Thứ 2..6=CN, giờ HH:MM)
            'shift_reg_deadline_weekday' => Setting::get('shift_reg_deadline_weekday', '5'),
            'shift_reg_deadline_time' => Setting::get('shift_reg_deadline_time', '20:00'),
            // Gói 37e: địa chỉ máy chủ cho QR chấm công (IP LAN, VD http://192.168.1.50:3000)
            'qr_base_url' => Setting::get('qr_base_url', ''),
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
