<?php

namespace App\Helpers;

use App\Models\Setting;

// Gói 55 p11ab: sinh mã theo quy tắc cấu hình trong Thiết lập
// Cấu hình: code_prefix_<type> (VD "XK"), code_digits_<type> (VD 4)
// $type: member, invoice, material, product, inbound, outbound, transfer, stocktake, receipt_income, receipt_expense
class CodeGenerator
{
    public static function defaults(): array
    {
        return [
            'member'    => ['prefix' => 'TV', 'digits' => 6],
            'invoice'   => ['prefix' => 'HD', 'digits' => 6],
            'material'  => ['prefix' => 'NL', 'digits' => 4],
            'product'   => ['prefix' => 'SP', 'digits' => 4],
            'inbound'   => ['prefix' => 'PN', 'digits' => 4],
            'outbound'  => ['prefix' => 'XK', 'digits' => 4],
            'transfer'  => ['prefix' => 'CK', 'digits' => 4],
            'stocktake' => ['prefix' => 'KK', 'digits' => 4],
            // Bổ sung 2026-10-20 (rà mã): phiếu thu/chi trước đây hardcode PT/PC trong Transaction::nextCode
            'receipt_income'  => ['prefix' => 'PT', 'digits' => 4],
            'receipt_expense' => ['prefix' => 'PC', 'digits' => 4],
        ];
    }

    public static function prefix(string $type): string
    {
        $d = static::defaults()[$type] ?? ['prefix' => 'MA', 'digits' => 4];
        return (string) Setting::get('code_prefix_' . $type, $d['prefix']);
    }

    public static function digits(string $type): int
    {
        $d = static::defaults()[$type] ?? ['prefix' => 'MA', 'digits' => 4];
        return max(1, (int) Setting::get('code_digits_' . $type, $d['digits']));
    }

    /**
     * Sinh mã dạng PREFIX0001 (hoặc PREFIXYYYYMMDD0001 nếu $withDate) — nối liền,
     * KHÔNG dấu gạch (luật định dạng Đại Vương chốt 2026-10-21 ~22:59; chỉ áp cho
     * mã sinh mới, mã cũ có dấu gạch trong DB giữ nguyên và tra cứu theo chuỗi đầy đủ).
     * $nextNumber: số thứ tự tiếp theo (caller tự tính, thường là count+1 trong transaction).
     */
    public static function generate(string $type, int $nextNumber, bool $withDate = false): string
    {
        $prefix = static::prefix($type);
        $digits = static::digits($type);
        $num = str_pad((string) max(1, $nextNumber), $digits, '0', STR_PAD_LEFT);
        if ($withDate) {
            return sprintf('%s%s%s', $prefix, now()->format('Ymd'), $num);
        }
        return sprintf('%s%s', $prefix, $num);
    }
}
