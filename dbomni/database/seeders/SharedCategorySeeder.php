<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

// Spec danh mục dùng chung (Đại Vương chốt 2026-10-19): 13 tab.
// - DEFAULTS là nguồn sự thật cho seed migration + nút "Khôi phục mặc định".
// - Idempotent: chỉ thêm code thiếu, không xóa code do người dùng tự thêm.
// - Tab payment_channels là ẢO (đọc động từ price_lists) — không seed ở đây.
class SharedCategorySeeder extends Seeder
{
    public const GROUPS = [
        'payment_types' => 'Loại phương thức thanh toán',
        'payment_channels' => 'Kênh áp dụng PTTT',
        'order_types' => 'Loại đơn hàng',
        'promotion_types' => 'Loại khuyến mại',
        'promotion_scopes' => 'Phạm vi khuyến mại',
        'import_suffixes' => 'Hậu tố kênh import',
        'partner_types' => 'Loại đối tác',
        'bonus_types' => 'Loại thưởng',
        'leave_types' => 'Loại nghỉ phép',
        'outbound_reasons' => 'Lý do xuất kho',
        'account_types' => 'Loại quỹ',
        'violation_groups' => 'Nhóm lỗi vi phạm',
        'cancel_reasons' => 'Lý do hủy đơn',
    ];

    // [group => [[code, name], ...]] — thứ tự mảng = sort_order
    public const DEFAULTS = [
        'payment_types' => [
            ['transfer', 'Chuyển khoản'],
            ['cash', 'Tiền mặt'],
            ['debit_card', 'Thẻ ghi nợ'],
            ['credit_card', 'Thẻ tín dụng'],
            ['ewallet', 'Ví điện tử'],
            ['other', 'Khác'],
        ],
        'order_types' => [
            ['takeaway', 'Mang đi'],
            ['delivery', 'Giao hàng'],
            ['dine_in', 'Tại bàn'],
        ],
        'promotion_types' => [
            ['percent', 'Theo %'],
            ['fixed', 'Theo số tiền'],
            ['fixed_price', 'Đồng giá'],
            ['gift', 'Tặng món'],
            ['shipping', 'Freeship'],
            ['bogo', 'Mua 1 tặng 1'],
        ],
        'promotion_scopes' => [
            ['order', 'Hóa đơn'],
            ['category', 'Danh mục'],
            ['product', 'Mặt hàng'],
            ['menu', 'Thực đơn'],
        ],
        'import_suffixes' => [
            ['CH', 'CH'],
            ['KM Giờ Vàng', 'KM Giờ Vàng'],
            ['Grab', 'Grab'],
            ['GrabFood', 'GrabFood'],
            ['Shopee', 'Shopee'],
            ['ShopeeFood', 'ShopeeFood'],
            ['Be', 'Be'],
            ['BeFood', 'BeFood'],
            ['Zalo', 'Zalo'],
            ['Online', 'Online'],
            ['Mang Về', 'Mang Về'],
            ['Tại Bàn', 'Tại Bàn'],
            ['Tại Quán', 'Tại Quán'],
            ['Giao Hàng', 'Giao Hàng'],
        ],
        'partner_types' => [
            ['supplier', 'Nhà cung cấp'],
            ['customer', 'Khách hàng'],
            ['other', 'Khác'],
        ],
        'bonus_types' => [
            ['performance', 'Hiệu suất'],
            ['birthday', 'Sinh nhật'],
            ['other', 'Khác'],
        ],
        'leave_types' => [
            ['nghi', 'Nghỉ'],
            ['doica', 'Đổi ca'],
            ['other', 'Khác'],
        ],
        'outbound_reasons' => [
            ['damaged', 'Hủy hàng'],
            ['internal_use', 'Dùng nội bộ'],
            ['sale', 'Xuất bán'],
            ['other', 'Khác'],
        ],
        'account_types' => [
            ['cash', 'Tiền mặt'],
            ['safe', 'Két sắt'],
            ['bank', 'Ngân hàng'],
            ['ewallet', 'Ví điện tử'],
        ],
        'violation_groups' => [
            ['chuyen_can', 'Chuyên Cần'],
            ['chuyen_mon', 'Chuyên Môn'],
            ['chuyen_nghiep', 'Chuyên Nghiệp'],
        ],
        'cancel_reasons' => [
            ['customer_cancel', 'Khách hủy'],
            ['out_of_stock', 'Hết nguyên liệu'],
            ['wrong_entry', 'Nhập nhầm'],
            ['other', 'Khác'],
        ],
    ];

    public function run(): void
    {
        $now = now();
        foreach (self::DEFAULTS as $group => $items) {
            foreach ($items as $i => [$code, $name]) {
                $exists = DB::table('shared_categories')
                    ->where('group', $group)->where('code', $code)->exists();
                if ($exists) continue;
                DB::table('shared_categories')->insert([
                    'group' => $group,
                    'code' => $code,
                    'name' => $name,
                    'sort_order' => $i,
                    'is_active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    // Nút "Khôi phục mặc định": thêm lại các code mặc định bị thiếu/tắt (không xóa custom)
    public static function restoreGroup(string $group): int
    {
        $added = 0;
        $now = now();
        foreach (self::DEFAULTS[$group] ?? [] as $i => [$code, $name]) {
            $row = DB::table('shared_categories')->where('group', $group)->where('code', $code)->first();
            if (!$row) {
                DB::table('shared_categories')->insert([
                    'group' => $group, 'code' => $code, 'name' => $name,
                    'sort_order' => $i, 'is_active' => true,
                    'created_at' => $now, 'updated_at' => $now,
                ]);
                $added++;
            } elseif (!$row->is_active) {
                DB::table('shared_categories')->where('id', $row->id)->update(['is_active' => true, 'updated_at' => $now]);
                $added++;
            }
        }
        return $added;
    }
}
