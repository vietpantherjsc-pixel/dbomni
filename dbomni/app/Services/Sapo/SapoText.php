<?php

namespace App\Services\Sapo;

// Cầu nối Sapo (2026-10-21): chuẩn hóa text để so khớp tên cột / text map.
// Quy tắc: chữ thường → bỏ dấu tiếng Việt → mọi dãy ký tự không phải chữ/số
// thành 1 khoảng trắng → trim. VD: "Tổng tiền thanh toán \n(1 + 2 + 3 - 4 + 5)"
// → "tong tien thanh toan 1 2 3 4 5"; "Điạ chỉ giao hàng" → "dia chi giao hang".
class SapoText
{
    private static ?array $map = null;

    public static function normalize(?string $value): string
    {
        if ($value === null) {
            return '';
        }
        $s = mb_strtolower(trim((string) $value), 'UTF-8');
        $s = strtr($s, self::diacritics());
        $s = preg_replace('/[^a-z0-9]+/u', ' ', $s) ?? '';
        return trim(preg_replace('/\s+/', ' ', $s) ?? '');
    }

    private static function diacritics(): array
    {
        if (self::$map !== null) {
            return self::$map;
        }
        $groups = [
            'a' => 'àáảãạăắằẳẵặâấầẩẫậ',
            'e' => 'èéẻẽẹêếềểễệ',
            'i' => 'ìíỉĩị',
            'o' => 'òóỏõọôốồổỗộơớờởỡợ',
            'u' => 'ùúủũụưứừửữự',
            'y' => 'ỳýỷỹỵ',
            'd' => 'đ',
        ];
        $map = [];
        foreach ($groups as $base => $chars) {
            foreach (mb_str_split($chars) as $ch) {
                $map[$ch] = $base;
            }
        }
        return self::$map = $map;
    }
}
