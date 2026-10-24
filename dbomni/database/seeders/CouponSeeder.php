<?php

namespace Database\Seeders;

use App\Models\Promotion;
use Illuminate\Database\Seeder;

// SPEC-02: Seed bộ 10 coupon CP-01→CP-10.
// Mọi tham số nằm trong DB (value, auto_config) — code chỉ đọc, KHÔNG hardcode số.
class CouponSeeder extends Seeder
{
    public function run(): void
    {
        $coupons = [
            [
                'code' => 'CP-01',
                'name' => 'Cốc chào mừng 0đ',
                'type' => 'gift',
                'coupon_type' => 'gift',
                'value' => 0,
                'max_discount_amount' => 45000,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'first_order',
                    'valid_days' => 7,
                    'max_per_customer' => 1,
                    'max_gift_value' => 45000,
                    // Danh sách 6 món best-seller do Admin chọn (product IDs)
                    'gift_product_ids' => [],
                ],
            ],
            [
                'code' => 'CP-02',
                'name' => 'Mời bạn — cả hai cùng được',
                'type' => 'percent',
                'value' => 50,
                'max_discount_amount' => 30000,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'referral',
                    'valid_days' => 30,
                    'max_per_customer' => 10,
                    'referral_min_order' => 50000,
                ],
            ],
            [
                'code' => 'CP-03',
                'name' => 'Tích tem đổi quà',
                'type' => 'gift',
                'coupon_type' => 'stamp',
                'value' => 0,
                'max_discount_amount' => 45000,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'stamp',
                    'valid_days' => 30,
                    'window_days' => 30, // SPEC-02: cửa sổ tính tem (ngày)
                    'min_cups_per_order' => 1,
                    'stamps_required' => 5,
                    'max_gift_value' => 45000,
                    // Mốc merch: [số tem => quà]
                    'merch_tiers' => [
                        ['stamps' => 15, 'gift' => 'Túi canvas'],
                        ['stamps' => 30, 'gift' => 'Ly sứ'],
                    ],
                ],
            ],
            [
                'code' => 'CP-04',
                'name' => 'Deal bữa sáng',
                'type' => 'percent',
                'value' => 30,
                'max_discount_amount' => 25000,
                'is_active' => true,
                'channels' => ['online'],
                'time_from' => '07:00',
                'time_to' => '09:00',
                'days_of_week' => [2, 3, 4], // T3-T5
                'auto_config' => [
                    'trigger' => 'manual', // khách tự lấy trong ví
                    'valid_days' => 1,
                    'max_per_customer' => 100,
                ],
            ],
            [
                'code' => 'CP-05',
                'name' => 'Deal trà chiều',
                'type' => 'percent',
                'value' => 25,
                'max_discount_amount' => 25000,
                'is_active' => true,
                'channels' => ['online'],
                'time_from' => '14:00',
                'time_to' => '17:00',
                'days_of_week' => [2, 3, 4], // T3-T5
                'auto_config' => [
                    'trigger' => 'manual',
                    'valid_days' => 1,
                    'max_per_customer' => 100,
                ],
            ],
            [
                'code' => 'CP-06',
                'name' => '"Nhớ bạn"',
                'type' => 'percent',
                'value' => 40,
                'max_discount_amount' => 35000,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'inactive',
                    'valid_days' => 3, // 72h
                    'max_per_customer' => 12, // tối đa 1 lần/tháng
                    'inactive_days' => 14,
                ],
            ],
            [
                'code' => 'CP-07',
                'name' => 'Sinh nhật',
                'type' => 'gift',
                'coupon_type' => 'gift',
                'value' => 0,
                'max_discount_amount' => 55000,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'birthday',
                    'valid_days' => 30, // trong tháng sinh nhật
                    'max_per_customer' => 1,
                    'max_gift_value' => 55000,
                ],
            ],
            [
                'code' => 'CP-08',
                'name' => 'Thử món mới',
                'type' => 'percent',
                'value' => 20,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'new_product',
                    'valid_days' => 7,
                    'max_per_customer' => 5,
                    // SKU món mới + nhóm món tương tự do Admin chọn
                    'new_product_ids' => [],
                    'target_category_ids' => [],
                ],
            ],
            [
                'code' => 'CP-09',
                'name' => 'BOGO moment',
                'type' => 'fixed',
                'coupon_type' => 'bogo',
                'value' => 0,
                'is_active' => true,
                'channels' => ['online'],
                'auto_config' => [
                    'trigger' => 'manual', // Admin tạo đợt
                    'valid_days' => 3,
                    'max_per_customer' => 10,
                    'max_campaigns_per_quarter' => 2, // chặn đợt thứ 3
                    'buy_product_id' => null,
                    'gift_product_id' => null,
                ],
            ],
            [
                'code' => 'CP-10',
                'name' => 'Coupon hóa đơn kế tiếp',
                'type' => 'percent',
                'value' => 15,
                'is_active' => true,
                'channels' => ['online'], // chỉ Mini App (quy tắc #4)
                'auto_config' => [
                    'trigger' => 'next_order',
                    'valid_days' => 7,
                    'max_per_customer' => 100,
                ],
            ],
        ];

        foreach ($coupons as $c) {
            Promotion::updateOrCreate(
                ['code' => $c['code']],
                $c
            );
        }
    }
}
