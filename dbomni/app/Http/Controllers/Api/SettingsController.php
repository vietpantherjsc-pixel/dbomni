<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Models\User;
use App\Support\CatalogCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 6 (2026-10-05): Cập nhật cấu hình hệ thống (phí ship...).
class SettingsController extends Controller
{
    // §3.4(d): khóa BÍ MẬT — chỉ Chủ Sở Hữu được đọc/ghi; backend không bao
    // giờ trả lại giá trị (chỉ cờ "đã cấu hình" ở endpoint riêng). Khóa
    // ZaloPay nằm trong .env, không qua bảng settings.
    public const SECRET_KEYS = ['sapo_imap_password_enc', 'staff_hub_token'];
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
            // Gói 9: cover Mini App
            'shop_cover_url' => Setting::get('shop_cover_url', ''),
            // Gói Mini App 2026-10-30: công tắc hiện mục "Quét QR tích điểm" ở
            // trang Tài khoản Mini App — mặc định TẮT (Đại Vương phán tạm ẩn vì
            // luồng bán POS đang hoãn); bật lại ở trang Zalo Mini App (Admin).
            'miniapp_qr_claim_entry' => Setting::get('miniapp_qr_claim_entry', '0'),
            // Gói chính sách Mini App vào Cài đặt Admin: nội dung chính sách
            // (đã giải mã; chưa từng sửa → bản mặc định + is_default = true).
            'miniapp_privacy_policy' => $this->privacyPolicyData(),
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

        // §3.4(d): khóa bí mật chỉ Chủ Sở Hữu được ghi — actor khác (kể cả
        // Employee có settings.general.edit) gửi key bí mật -> 403.
        $actor = $request->user();
        if (!($actor instanceof User && $actor->isOwner())) {
            $blocked = array_intersect(array_keys($validated['settings']), self::SECRET_KEYS);
            if ($blocked !== []) {
                return response()->json(['success' => false, 'message' => 'Khóa cấu hình này chỉ Chủ Sở Hữu được thay đổi.'], 403);
            }
        }

        foreach ($validated['settings'] as $key => $value) {
            Setting::set($key, $value ?? '');
        }

        // Bộ nhớ đệm thực đơn: shop-info đọc 2 key này — đổi thì tăng phiên bản catalog.
        if (array_intersect_key($validated['settings'], array_flip(['shop_cover_url', 'miniapp_qr_claim_entry']))) {
            CatalogCache::bump();
        }

        return response()->json(['success' => true, 'message' => 'Đã lưu cấu hình.']);
    }

    // ===== Gói chính sách Mini App vào Cài đặt Admin (spec đã chốt 2026-11-05) =====
    // Nội dung "Chính sách — Điều khoản Mini App" lưu ở MỘT khóa settings dạng
    // JSON {sections: [{title, content} × 5], updated_at} — đúng 5 mục riêng
    // biệt theo cấu trúc Zalo kiểm duyệt yêu cầu. Đường lưu RIÊNG vì đường lưu
    // chung ở update() chặn mọi giá trị ở 255 ký tự. Chưa từng sửa (chưa có
    // khóa) → dùng bản mặc định nguyên văn dưới đây; khôi phục mặc định = xóa
    // khóa. Không migration, không seed.
    private const POLICY_KEY = 'miniapp_privacy_policy';
    private const POLICY_DEFAULT_UPDATED_TEXT = 'Cập nhật lần cuối: tháng 10/2026. Daybreak có thể cập nhật chính sách này; phiên bản mới nhất luôn hiển thị tại đây.';

    /** Bản mặc định NGUYÊN VĂN nội dung popup hiện tại (trước gói này viết cứng ở Mini App). */
    private function defaultPolicySections(): array
    {
        return [
            ['title' => 'Đơn vị chủ quản', 'content' => 'Daybreak Tea & Coffee — hệ thống cửa hàng trà & cà phê. Mọi thông tin liên hệ hiển thị tại trang chủ ứng dụng theo từng chi nhánh.'],
            ['title' => 'Dữ liệu chúng tôi thu thập', 'content' => 'Khi bạn sử dụng ứng dụng, chúng tôi có thể thu thập: số điện thoại, tên, địa chỉ giao hàng, vị trí hiện tại (chỉ khi bạn cho phép, để tính phí giao hàng), lịch sử đơn hàng, điểm tích lũy và thông tin thiết bị cơ bản. Email chỉ được thu thập khi bạn tự nguyện cung cấp — chỉ dùng cho thông báo bảo mật và hỗ trợ khôi phục tài khoản, không dùng cho quảng cáo.'],
            ['title' => 'Mục đích sử dụng', 'content' => 'Dữ liệu được dùng để: xử lý đơn đặt món, giao hàng, quản lý tài khoản thành viên, tích điểm & đổi ưu đãi, gửi thông báo về đơn hàng và chương trình khuyến mại (nếu bạn đồng ý).'],
            ['title' => 'Thời gian lưu trữ', 'content' => 'Dữ liệu được lưu trữ trong suốt thời gian bạn sử dụng dịch vụ và tối đa 24 tháng sau lần tương tác cuối cùng, trừ khi pháp luật yêu cầu lưu lâu hơn (ví dụ dữ liệu hóa đơn).'],
            ['title' => 'Rút lại đồng ý & liên hệ', 'content' => 'Bạn có thể rút lại sự đồng ý xử lý dữ liệu bất cứ lúc nào bằng cách liên hệ trực tiếp cửa hàng qua số điện thoại hiển thị tại trang chủ, hoặc yêu cầu xóa tài khoản thành viên. Việc rút lại đồng ý không ảnh hưởng đến tính hợp pháp của việc xử lý trước đó. Bạn vẫn có thể xem thực đơn và đặt món mà không cần đăng nhập thành viên.'],
        ];
    }

    /** Hình dạng hợp lệ: đúng 5 mục, tiêu đề + nội dung đều không trống. */
    private function policySectionsValid($sections): bool
    {
        if (!is_array($sections) || count($sections) !== 5) {
            return false;
        }
        foreach ($sections as $s) {
            if (!is_array($s)
                || trim((string) ($s['title'] ?? '')) === ''
                || trim((string) ($s['content'] ?? '')) === '') {
                return false;
            }
        }
        return true;
    }

    /**
     * Bản chính sách HIỆU LỰC: đã lưu hợp lệ → bản đã lưu; chưa có khóa hoặc
     * dữ liệu lưu bị hỏng hình dạng → bản mặc định (endpoint không bao giờ
     * trả popup rỗng / thiếu mục).
     */
    private function privacyPolicyData(): array
    {
        $raw = Setting::get(self::POLICY_KEY);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded) && $this->policySectionsValid($decoded['sections'] ?? null)) {
            $updatedAt = isset($decoded['updated_at']) && is_string($decoded['updated_at']) && $decoded['updated_at'] !== ''
                ? $decoded['updated_at'] : null;
            return [
                'sections' => array_values(array_map(
                    fn($s) => ['title' => (string) $s['title'], 'content' => (string) $s['content']],
                    $decoded['sections']
                )),
                'updated_at' => $updatedAt,
                'updated_text' => $updatedAt
                    ? 'Cập nhật lần cuối: ' . \Carbon\Carbon::parse($updatedAt)->format('d/m/Y') . '. Daybreak có thể cập nhật chính sách này; phiên bản mới nhất luôn hiển thị tại đây.'
                    : self::POLICY_DEFAULT_UPDATED_TEXT,
                'is_default' => false,
            ];
        }
        return [
            'sections' => $this->defaultPolicySections(),
            'updated_at' => null,
            'updated_text' => self::POLICY_DEFAULT_UPDATED_TEXT,
            'is_default' => true,
        ];
    }

    /** GET /online/privacy-policy — công khai cho Mini App (mở popup mới gọi). */
    public function publicPrivacyPolicy(): JsonResponse
    {
        $d = $this->privacyPolicyData();
        return response()->json(['success' => true, 'data' => [
            'sections' => $d['sections'],
            'updated_text' => $d['updated_text'],
        ]]);
    }

    /** POST /settings/privacy-policy — lưu riêng (permission:settings.general.edit ở route). */
    public function updatePrivacyPolicy(Request $request): JsonResponse
    {
        $v = $request->validate([
            'sections' => 'required|array|size:5',
            'sections.*.title' => 'required|string',
            'sections.*.content' => 'required|string',
        ]);

        $sections = [];
        foreach ($v['sections'] as $s) {
            // Nội dung là VĂN BẢN THUẦN: bóc mọi thẻ HTML trước khi kiểm
            // trần ký tự + độ trống (spec mục 2.2).
            $title = trim(strip_tags((string) $s['title']));
            $content = trim(strip_tags((string) $s['content']));
            if ($title === '' || $content === '' || mb_strlen($title) > 120 || mb_strlen($content) > 5000) {
                return response()->json([
                    'success' => false,
                    'message' => 'Mỗi mục cần tiêu đề (tối đa 120 ký tự) và nội dung (tối đa 5.000 ký tự), không được để trống.',
                ], 422);
            }
            $sections[] = ['title' => $title, 'content' => $content];
        }

        // updated_at do SERVER ghi (mốc giờ VN) — client gửi kèm cũng bị bỏ qua.
        Setting::set(self::POLICY_KEY, json_encode([
            'sections' => $sections,
            'updated_at' => now('Asia/Ho_Chi_Minh')->toIso8601String(),
        ], JSON_UNESCAPED_UNICODE));

        return response()->json([
            'success' => true,
            'message' => 'Đã lưu chính sách.',
            'data' => $this->privacyPolicyData(),
        ]);
    }

    /** POST /settings/privacy-policy/reset — xóa khóa, quay về bản mặc định. */
    public function resetPrivacyPolicy(): JsonResponse
    {
        Setting::where('key', self::POLICY_KEY)->delete();
        return response()->json([
            'success' => true,
            'message' => 'Đã khôi phục nội dung mặc định.',
            'data' => $this->privacyPolicyData(),
        ]);
    }
}
