<?php

namespace App\Support;

// Chương trình chỉ số 360 — Đợt 2, N-2 (Phụ lục khóa 2026-11-15):
// DANH MỤC NGUYÊN NHÂN hoàn/hủy DÙNG CHUNG — 1 hằng duy nhất cho backend
// validate + báo cáo + FE (enum cố định trong code, KHÔNG dùng nhóm
// shared-category — Admin sửa/xóa được sẽ làm mất ổn định gom báo cáo).
// Cột text cũ (cancel_reason / reason) giữ vai trò ghi chú tự do.
class CancelReasonCodes
{
    public const WRONG_ITEM = 'wrong_item';
    public const OUT_OF_STOCK_AFTER_PAYMENT = 'out_of_stock_after_payment';
    public const TOO_SLOW = 'too_slow';
    public const PAYMENT_ERROR = 'payment_error';
    public const CUSTOMER_CHANGED_MIND = 'customer_changed_mind';
    public const OTHER = 'other';

    public const ALL = [
        self::WRONG_ITEM,
        self::OUT_OF_STOCK_AFTER_PAYMENT,
        self::TOO_SLOW,
        self::PAYMENT_ERROR,
        self::CUSTOMER_CHANGED_MIND,
        self::OTHER,
    ];

    // Mã phía quán → "lỗi quán" trong CL-2 (by_cause); khách đổi ý → phía
    // khách; other/NULL → chưa rõ.
    public const SHOP_CODES = [
        self::WRONG_ITEM,
        self::OUT_OF_STOCK_AFTER_PAYMENT,
        self::TOO_SLOW,
        self::PAYMENT_ERROR,
    ];

    public const LABELS = [
        self::WRONG_ITEM => 'Sai món',
        self::OUT_OF_STOCK_AFTER_PAYMENT => 'Hết món sau thu tiền',
        self::TOO_SLOW => 'Chậm quá lâu',
        self::PAYMENT_ERROR => 'Lỗi thanh toán',
        self::CUSTOMER_CHANGED_MIND => 'Khách đổi ý',
        self::OTHER => 'Khác',
    ];

    public static function label(?string $code): string
    {
        return self::LABELS[$code] ?? 'Chưa phân loại';
    }

    public static function isValid(?string $code): bool
    {
        return in_array($code, self::ALL, true);
    }
}
