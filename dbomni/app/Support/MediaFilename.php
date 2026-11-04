<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;

// RULE CHUẨN HÓA TÊN FILE MEDIA (Đại Vương lệnh 2026-11-04) — quy định đứng của hệ thống:
// MỌI file ghi vào thư mục public (covers/, images/...) đều phải sinh tên qua helper này.
// Tên lưu trữ luôn thuần ASCII: bỏ dấu tiếng Việt đầy đủ (ă/â/đ/ê/ô/ơ/ư + thanh điệu),
// chữ thường, khoảng trắng/ký tự lạ → '-', giữ đuôi file, chống trùng bằng hậu tố
// thời gian + ngẫu nhiên (như cơ chế cũ) hoặc '-2', '-3' khi cần tên cố định.
// Lệnh `media:normalize-paths` dùng chính helper này để dọn dữ liệu cũ — 1 rule duy nhất.
class MediaFilename
{
    /** Bảng bỏ dấu: chữ gốc => mọi biến thể có dấu (thường; hoa suy ra bằng mb_strtoupper). */
    private static function groups(): array
    {
        return [
            'a' => 'àáảãạăằắẳẵặâầấẩẫậ',
            'e' => 'èéẻẽẹêềếểễệ',
            'i' => 'ìíỉĩị',
            'o' => 'òóỏõọôồốổỗộơờớởỡợ',
            'u' => 'ùúủũụưừứửữự',
            'y' => 'ỳýỷỹỵ',
            'd' => 'đ',
        ];
    }

    /** Map ký tự có dấu (cả thường + hoa) => chữ gốc thường, dùng cho strtr(). */
    public static function charMap(): array
    {
        static $map = null;
        if ($map !== null) {
            return $map;
        }
        $map = [];
        foreach (self::groups() as $base => $chars) {
            foreach (mb_str_split($chars) as $ch) {
                $map[$ch] = $base;
                $map[mb_strtoupper($ch)] = $base;
            }
        }
        return $map;
    }

    /** Chuẩn hóa phần tên (không đuôi): bỏ dấu, chữ thường, ký tự lạ => '-'. Rỗng => 'file'. */
    public static function cleanBase(string $name): string
    {
        $s = strtr($name, self::charMap());
        $s = strtolower($s);
        // '_' được giữ (tên hệ thống tự sinh dùng '_' — product_/promo_/share_... phải idempotent)
        $s = preg_replace('/[^a-z0-9_]+/', '-', $s) ?? '';
        $s = trim($s, '-_');
        if (strlen($s) > 80) {
            $s = rtrim(substr($s, 0, 80), '-_');
        }
        return $s !== '' ? $s : 'file';
    }

    /** Chuẩn hóa 1 tên file đầy đủ (giữ đuôi file, đuôi cũng làm sạch + chữ thường). */
    public static function clean(string $filename): string
    {
        $filename = trim($filename);
        $base = $filename;
        $ext = '';
        $dot = strrpos($filename, '.');
        if ($dot !== false && $dot > 0) {
            $ext = strtolower(preg_replace('/[^a-zA-Z0-9]/', '', substr($filename, $dot + 1)) ?? '');
            $base = substr($filename, 0, $dot);
        }
        $base = self::cleanBase($base);
        return $ext !== '' ? $base . '.' . $ext : $base;
    }

    /**
     * Sinh tên lưu trữ cho 1 file upload: {prefix}_{tên gốc đã bỏ dấu}_{time}_{hex8}.{ext}
     * — giữ cơ chế chống trùng cũ (time + random), tên gốc chỉ còn dạng ASCII sạch.
     * $ext: đuôi do server quyết (theo MIME) nếu có; null => lấy theo file client (đã làm sạch).
     */
    public static function forUpload(string $prefix, UploadedFile $file, ?string $ext = null): string
    {
        $base = self::cleanBase(pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME));
        $ext = $ext ?? strtolower($file->getClientOriginalExtension());
        $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?? '';
        if ($ext === '') {
            $ext = 'bin';
        }
        return $prefix . '_' . $base . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    }

    /** Đảm bảo không trùng tên trong thư mục: trùng thì thêm '-2', '-3', ... trước đuôi file. */
    public static function unique(string $dir, string $filename): string
    {
        if (!file_exists($dir . '/' . $filename)) {
            return $filename;
        }
        $dot = strrpos($filename, '.');
        $base = $dot === false ? $filename : substr($filename, 0, $dot);
        $suffix = $dot === false ? '' : substr($filename, $dot);
        for ($i = 2; ; $i++) {
            $candidate = $base . '-' . $i . $suffix;
            if (!file_exists($dir . '/' . $candidate)) {
                return $candidate;
            }
        }
    }
}
