<?php

namespace Tests\Unit;

use App\Support\MediaFilename;
use PHPUnit\Framework\TestCase;

// Rule chuẩn hóa tên file media (2026-11-04): tên lưu trữ luôn ASCII sạch.
class MediaFilenameTest extends TestCase
{
    public function test_bo_dau_tieng_viet_day_du(): void
    {
        $this->assertSame('tra-sua-tran-chau.jpg', MediaFilename::clean('Trà Sữa Trân Châu.JPG'));
        $this->assertSame('ca-phe-da-01.png', MediaFilename::clean('cà-phê đá 01.png'));
        // Đủ 6 họ nguyên âm có dấu + đ, cả chữ hoa
        $this->assertSame('a-e-i-o-u-y-d', MediaFilename::cleanBase('Ắ Ệ Ị Ộ Ứ Ỵ Đ'));
        $this->assertSame('dak-lak-uot-at', MediaFilename::cleanBase('Đắk Lắk Ướt Át'));
        $this->assertSame('banh-uot-thit-nuong-moi.webp', MediaFilename::clean('Bánh Ướt Thịt Nướng (mới).webp'));
    }

    public function test_khoang_trang_va_ky_tu_la_thanh_gach_ngang(): void
    {
        $this->assertSame('anh-dep-nhieu-khoang-trang.png', MediaFilename::clean('ảnh đẹp   nhiều   khoảng trắng.png'));
        $this->assertSame('file.png', MediaFilename::clean('!!!.png'));
        $this->assertSame('file', MediaFilename::cleanBase('---'));
    }

    public function test_ten_da_sach_giu_nguyen_va_idempotent(): void
    {
        $this->assertSame('product_tra-2024.jpg', MediaFilename::clean('product_tra-2024.jpg'));
        $once = MediaFilename::clean('Trà Sữa Trân Châu.JPG');
        $this->assertSame($once, MediaFilename::clean($once));
    }

    public function test_unique_them_hau_to_khi_trung(): void
    {
        $dir = sys_get_temp_dir() . '/mediafilename_test_' . getmypid();
        mkdir($dir, 0755, true);
        try {
            file_put_contents($dir . '/tra-sua.jpg', 'x');
            $this->assertSame('tra-sua-2.jpg', MediaFilename::unique($dir, 'tra-sua.jpg'));
            $this->assertSame('moi.jpg', MediaFilename::unique($dir, 'moi.jpg'));
        } finally {
            @unlink($dir . '/tra-sua.jpg');
            @rmdir($dir);
        }
    }
}
