<?php

namespace App\Support;

// Spec đăng nhập SĐT + mật khẩu §6.2 — MỘT validator dùng chung duy nhất
// cho cả 4 điểm đặt mật khẩu (set · zalo-set · change · counter-set).
// Không điểm đặt nào được validate riêng lẻ (checklist T-09).
// Lỗi khi ĐẶT trả dạng danh sách, mỗi luật một thông điệp riêng; lỗi khi
// ĐĂNG NHẬP giữ chung chung ở controller (không dùng validator này).
class CustomerPasswordValidator
{
    public const MIN_LENGTH = 8;
    public const MAX_LENGTH = 72; // giới hạn thật của bcrypt

    /**
     * Trả về danh sách thông điệp vi phạm (rỗng = đạt luật).
     * $phone là SĐT đang lưu của chính tài khoản (so khớp nguyên chuỗi).
     */
    public static function errors(string $password, ?string $phone = null): array
    {
        $errors = [];
        $len = mb_strlen($password);

        if ($len < self::MIN_LENGTH) {
            $errors[] = 'Mật khẩu cần tối thiểu 8 ký tự.';
        }
        if ($len > self::MAX_LENGTH) {
            $errors[] = 'Mật khẩu tối đa 72 ký tự.';
        }
        // "Chữ cái/chữ hoa" tính trên bảng chữ Latin không dấu (A–Z, a–z) —
        // chữ có dấu được phép có mặt nhưng không tính vào 2 điều kiện này.
        if (!preg_match('/[A-Za-z]/', $password)) {
            $errors[] = 'Mật khẩu cần có ít nhất 1 chữ cái (A–Z, a–z).';
        }
        if (!preg_match('/[A-Z]/', $password)) {
            $errors[] = 'Mật khẩu cần có ít nhất 1 chữ in hoa (A–Z).';
        }
        // Ký tự đặc biệt = không phải chữ cái (Unicode) và không phải chữ số;
        // khoảng trắng không tính.
        if (!preg_match('/[^\p{L}\p{N}\s]/u', $password)) {
            $errors[] = 'Mật khẩu cần có ít nhất 1 ký tự đặc biệt (ví dụ ! @ # $ %).';
        }
        if ($phone !== null && $phone !== '' && $password === $phone) {
            $errors[] = 'Mật khẩu không được trùng với số điện thoại.';
        }
        if (static::hasSequentialRun($password)) {
            $errors[] = 'Mật khẩu không được chứa chuỗi liên tiếp như 1234, abcd hay qwer.';
        }
        if (static::isTrivialPattern($password)) {
            $errors[] = 'Mật khẩu quá đơn giản (ký tự lặp lại).';
        }
        return $errors;
    }

    public static function valid(string $password, ?string $phone = null): bool
    {
        return static::errors($password, $phone) === [];
    }

    /**
     * Chứa đoạn con ≥ 4 ký tự thuộc: dãy số tăng/giảm (không vòng 9→0),
     * dãy chữ tăng/giảm Latin không phân biệt hoa/thường (không vòng z→a),
     * dãy bàn phím tăng/giảm trên 3 hàng qwerty/asdf/zxcv.
     */
    public static function hasSequentialRun(string $password): bool
    {
        $lower = mb_strtolower($password);
        $len = mb_strlen($lower);
        if ($len < 4) return false;
        $sequences = [
            '0123456789', '9876543210',
            'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba',
            'qwertyuiop', 'poiuytrewq',
            'asdfghjkl', 'lkjhgfdsa',
            'zxcvbnm', 'mnbvcxz',
        ];
        for ($i = 0; $i <= $len - 4; $i++) {
            $window = mb_substr($lower, $i, 4);
            foreach ($sequences as $seq) {
                if (str_contains($seq, $window)) return true;
            }
        }
        return false;
    }

    /**
     * Mẫu tầm thường: toàn một ký tự lặp lại, một khối ngắn lặp lại suốt
     * chuỗi (kể cả khối cuối cụt), hoặc toàn chuỗi chỉ dùng ≤ 2 ký tự khác nhau.
     * Ghi nhận về spec: mục 6.2 ghi "khối ≤ 2 ký tự" nhưng chính các ví dụ
     * của nó (`Aa@Aa@Aa`, `12!12!12`) và ca T-09 dùng khối 3 ký tự — nên
     * khối lặp được kiểm tới chu kỳ 3 để khớp ví dụ + bảng ca T-09.
     * Ca `@@@AAAAA` của T-09 rơi vào nhánh "chỉ dùng ≤ 2 ký tự khác nhau".
     */
    public static function isTrivialPattern(string $password): bool
    {
        $len = mb_strlen($password);
        if ($len === 0) return false;
        $chars = mb_str_split($password);
        if (count(array_unique($chars)) <= 2) return true;
        // Khối lặp: chuỗi có chu kỳ ngắn (1–3 ký tự) — kể cả khi khối cuối
        // cụt (vd `Aa@Aa@Aa`, `12!12!12` dài 8, khối 3 lặp 2 lần + dư `Aa`/`12`).
        for ($period = 1; $period <= 3; $period++) {
            $periodic = true;
            for ($i = $period; $i < $len; $i++) {
                if ($chars[$i] !== $chars[$i - $period]) { $periodic = false; break; }
            }
            if ($periodic) return true;
        }
        return false;
    }
}
