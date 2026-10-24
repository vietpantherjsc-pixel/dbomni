<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

// Gói 35: QR chấm công cố định theo chi nhánh (admin xem / tạo lại).
class AttendanceQrController extends Controller
{
    // Gói 37e: base URL cho QR — ưu tiên setting qr_base_url (IP LAN do Đại Vương nhập),
    // fallback APP_URL. Để trống setting = dùng APP_URL như cũ.
    private function baseUrl(): string
    {
        $b = Setting::get('qr_base_url', '');
        return rtrim($b !== '' ? $b : config('app.url'), '/');
    }

    // Lấy QR của 1 chi nhánh (kèm URL để in)
    public function show(\Illuminate\Http\Request $request, int $id): JsonResponse
    {
        $branch = Branch::findOrFail($id);
        // Audit 2026-10-23 A3-6: quản lý là Employee chỉ xem QR của CN mình được
        // phân công (trước đây xem được mọi CN + lần đầu xem còn tự tạo token)
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $id, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Chi nhánh ngoài phạm vi phân công của bạn.'], 403);
        }
        if (!$branch->attendance_qr_token) {
            $branch->attendance_qr_token = Str::random(32);
            $branch->save();
        }
        return response()->json([
            'success' => true,
            'data' => [
                'branch_id' => $branch->id,
                'branch_name' => $branch->name,
                'token' => $branch->attendance_qr_token,
                'url' => $this->baseUrl() . '/cham-cong?b=' . $branch->id . '&t=' . $branch->attendance_qr_token,
            ],
        ]);
    }

    // Tạo lại mã QR (QR cũ hết hiệu lực)
    public function regenerate(\Illuminate\Http\Request $request, int $id): JsonResponse
    {
        $branch = Branch::findOrFail($id);
        // Bổ sung Mảng 4 (TESTER rà soát) A3-6: khóa CN người gọi như show() —
        // tránh NV có staff.edit tạo lại QR của CN khác (làm chết QR đang dán
        // tại CN đó và nhận token mới)
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $id, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Chi nhánh ngoài phạm vi phân công của bạn.'], 403);
        }
        $branch->attendance_qr_token = Str::random(32);
        $branch->save();
        return response()->json([
            'success' => true,
            'message' => 'Đã tạo mã QR mới. Hãy in lại và dán tại quán.',
            'data' => [
                'branch_id' => $branch->id,
                'token' => $branch->attendance_qr_token,
                'url' => $this->baseUrl() . '/cham-cong?b=' . $branch->id . '&t=' . $branch->attendance_qr_token,
            ],
        ]);
    }
}
