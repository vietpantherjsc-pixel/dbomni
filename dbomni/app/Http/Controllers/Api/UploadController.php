<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 10f (2026-10-05): Upload ảnh cover cho trang chủ Mini App.
// - Nhận jpg/png/webp, tối đa 1MB (theo chốt của Đại Vương)
// - Server tự resize + crop giữa về 1200×500 (giữ nguyên tỷ lệ, không méo hình)
// - branch_id null => cover chung; có branch_id => cover riêng chi nhánh đó
// - Gói 10f-fix: ghi thẳng vào public/covers (như ảnh sản phẩm public/images),
//   không qua storage:link vì symlink bị web server chặn 403 trên Docker.
class UploadController extends Controller
{
    public function cover(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'image' => 'required|image|mimes:jpg,jpeg,png,webp|max:1024',
            'branch_id' => 'nullable|exists:branches,id',
        ]);

        $file = $validated['image'];
        $branchId = $validated['branch_id'] ?? null;
        $scope = $branchId ? "branch_{$branchId}" : 'common';

        $dir = public_path('covers');
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        // Xóa file cover cũ của scope này (tránh rác)
        foreach (glob($dir . '/' . $scope . '_*.jpg') ?: [] as $old) {
            @unlink($old);
        }

        $filename = $scope . '_' . time() . '.jpg';
        $tmpSrc = $file->getRealPath();
        $dstPath = $dir . '/' . $filename;

        if (extension_loaded('gd')) {
            $this->coverCrop($tmpSrc, $dstPath, 1200, 500);
        } else {
            // Không có GD: lưu gốc (vẫn đảm bảo jpg/png/webp <= 1MB)
            $file->move($dir, $filename);
        }

        $url = url('covers/' . $filename);

        if ($branchId) {
            Branch::where('id', $branchId)->update(['cover_url' => $url]);
        } else {
            Setting::set('shop_cover_url', $url);
        }

        return response()->json(['success' => true, 'data' => ['url' => $url]]);
    }

    /**
     * Resize ảnh sao cho phủ kín $tw×$th rồi crop giữa (giữ nguyên tỷ lệ, không méo).
     * Xuất luôn JPG chất lượng 85 cho nhẹ.
     */
    private function coverCrop(string $srcPath, string $dstPath, int $tw, int $th): void
    {
        [$sw, $sh, $type] = getimagesize($srcPath);
        $src = match ($type) {
            IMAGETYPE_JPEG => imagecreatefromjpeg($srcPath),
            IMAGETYPE_PNG => imagecreatefrompng($srcPath),
            IMAGETYPE_WEBP => imagecreatefromwebp($srcPath),
            default => throw new \RuntimeException('Định dạng ảnh không hỗ trợ.'),
        };

        // Tỷ lệ để ảnh phủ kín khung
        $scale = max($tw / $sw, $th / $sh);
        $nw = (int) ceil($sw * $scale);
        $nh = (int) ceil($sh * $scale);

        $resized = imagecreatetruecolor($nw, $nh);
        // Nền trắng cho ảnh PNG trong suốt
        imagefill($resized, 0, 0, imagecolorallocate($resized, 255, 255, 255));
        imagecopyresampled($resized, $src, 0, 0, 0, 0, $nw, $nh, $sw, $sh);

        // Crop giữa
        $cx = (int) (($nw - $tw) / 2);
        $cy = (int) (($nh - $th) / 2);
        $final = imagecreatetruecolor($tw, $th);
        imagecopy($final, $resized, 0, 0, $cx, $cy, $tw, $th);
        imagejpeg($final, $dstPath, 85);

        imagedestroy($src);
        imagedestroy($resized);
        imagedestroy($final);
    }
}
