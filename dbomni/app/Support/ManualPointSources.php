<?php

namespace App\Support;

// Chương trình chỉ số 360 — Đợt 2, N-4 (Phụ lục khóa 2026-11-15): danh
// mục nguồn điểm ghi tay — áp cả cộng lẫn trừ qua adjustPoints().
// Không tái dùng source_type 'adjust' (đã dùng chung cho cộng tay + hoàn
// điểm hệ thống). 'other' bắt buộc ghi chú.
class ManualPointSources
{
    public const COMPENSATION = 'compensation';
    public const CARE_PROMO = 'care_promo';
    public const BALANCE_CORRECTION = 'balance_correction';
    public const OTHER = 'other';

    public const CODES = [
        self::COMPENSATION,
        self::CARE_PROMO,
        self::BALANCE_CORRECTION,
        self::OTHER,
    ];

    public const LABELS = [
        self::COMPENSATION => 'Đền bù lỗi quán',
        self::CARE_PROMO => 'Chăm sóc / khuyến mãi',
        self::BALANCE_CORRECTION => 'Sửa sai số dư',
        self::OTHER => 'Khác',
    ];

    public static function isValid(?string $code): bool
    {
        return $code !== null && in_array($code, self::CODES, true);
    }

    public static function label(?string $code): string
    {
        if ($code === null) return 'Ghi tay — chưa phân loại';
        return self::LABELS[$code] ?? $code;
    }
}
