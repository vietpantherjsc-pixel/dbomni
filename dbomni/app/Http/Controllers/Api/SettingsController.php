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
            // Gói 55 p11ac: bỏ price_includes_tax — key chết, không nơi nào đọc
            'default_tax_rate' => Setting::get('default_tax_rate', '8'),
            'theme_primary' => Setting::get('theme_primary', '#24305E'),
            'brand_logo' => Setting::get('brand_logo', ''), // Logo sidebar Admin (2026-10-21)
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
            // Gói 55 p11ab: quy tắc sinh mã (prefix + số chữ số)
            'code_prefix_member' => Setting::get('code_prefix_member', 'TV'),
            'code_digits_member' => Setting::get('code_digits_member', '6'),
            'code_prefix_invoice' => Setting::get('code_prefix_invoice', 'HD'),
            'code_digits_invoice' => Setting::get('code_digits_invoice', '6'),
            'code_prefix_material' => Setting::get('code_prefix_material', 'NL'),
            'code_digits_material' => Setting::get('code_digits_material', '4'),
            'code_prefix_product' => Setting::get('code_prefix_product', 'SP'),
            'code_digits_product' => Setting::get('code_digits_product', '4'),
            'code_prefix_inbound' => Setting::get('code_prefix_inbound', 'PN'),
            'code_digits_inbound' => Setting::get('code_digits_inbound', '4'),
            'code_prefix_outbound' => Setting::get('code_prefix_outbound', 'XK'),
            'code_digits_outbound' => Setting::get('code_digits_outbound', '4'),
            'code_prefix_transfer' => Setting::get('code_prefix_transfer', 'CK'),
            'code_digits_transfer' => Setting::get('code_digits_transfer', '4'),
            'code_prefix_stocktake' => Setting::get('code_prefix_stocktake', 'KK'),
            'code_digits_stocktake' => Setting::get('code_digits_stocktake', '4'),
            'code_prefix_receipt_income' => Setting::get('code_prefix_receipt_income', 'PT'),
            'code_digits_receipt_income' => Setting::get('code_digits_receipt_income', '4'),
            'code_prefix_receipt_expense' => Setting::get('code_prefix_receipt_expense', 'PC'),
            'code_digits_receipt_expense' => Setting::get('code_digits_receipt_expense', '4'),
            // Gói 55 p11af (P0-13): trần % giảm giá. Công tắc cộng dồn toàn cục
            // promo_allow_stack ĐÃ BỎ (Đại Vương chốt 2026-10-21 ~22:45) — quyền
            // cộng dồn nằm ở từng chương trình KM/coupon, không còn trả key này.
            'promo_max_discount_pct' => Setting::get('promo_max_discount_pct', '50'),
            // Gói 55 p11af (P0-14): ngưỡng cảnh báo Food cost % trên Dashboard
            'food_cost_alert_pct' => Setting::get('food_cost_alert_pct', '30'),
            // Gói 55 p11ag: ngưỡng kiểm soát kho & nhập hàng (chống thất thoát)
            'inventory_adjust_threshold' => Setting::get('inventory_adjust_threshold', '500000'),
            'price_increase_alert_pct' => Setting::get('price_increase_alert_pct', '10'),
            'stocktake_diff_threshold' => Setting::get('stocktake_diff_threshold', '200000'),
            // Gói SEC: 9 key mẫu in (Gói 52)
            'show_logo' => Setting::get('show_logo', '1'),
            'show_address' => Setting::get('show_address', '1'),
            'show_hotline' => Setting::get('show_hotline', '1'),
            'show_qr' => Setting::get('show_qr', '1'),
            'show_thankyou' => Setting::get('show_thankyou', '1'),
            'label_show_code' => Setting::get('label_show_code', '1'),
            'label_show_name' => Setting::get('label_show_name', '1'),
            'label_show_opts' => Setting::get('label_show_opts', '1'),
            'thankyou_text' => Setting::get('thankyou_text', 'Cảm ơn quý khách! Hẹn gặp lại!'),
        ]);
    }

    // Gói 7p: lấy màu chủ đạo giao diện (admin)
    public function theme(): JsonResponse
    {
        return response()->json([
            'primary' => Setting::get('theme_primary', '#24305E'),
            // Logo sidebar Admin (2026-10-21): AdminLayout đọc cùng đường theme
            'logo' => Setting::get('brand_logo', ''),
        ]);
    }

    // Gói 7p: lấy màu chủ đạo giao diện (public cho Mini App)
    // Gói 47: kèm font chữ
    // Gói 48: kèm thời gian trượt banner KM
    public function publicTheme(): JsonResponse
    {
        return response()->json([
            'primary' => Setting::get('theme_primary', '#24305E'),
            'font_family' => Setting::get('font_family', 'Inter'),
            'promo_slide_interval' => (int) Setting::get('promo_slide_interval', 5),
            // Demo "Quan tâm OA" v2 (Đại Vương chốt 2026-10-19): công tắc + headline card OA
            'oa_card_enabled' => Setting::get('oa_card_enabled', '1'),
            'oa_card_headline' => Setting::get('oa_card_headline', 'Quan tâm để nhận các chương trình ưu đãi đặc quyền !'),
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
