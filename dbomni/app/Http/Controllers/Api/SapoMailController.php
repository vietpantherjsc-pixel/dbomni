<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SapoMailLog;
use App\Services\Sapo\SapoMailService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

// =====================================================================
// Cầu nối Sapo — Phần C (2026-10-21): API cấu hình hộp thư IMAP + kiểm tra mail.
// Mật khẩu: chỉ ghi (mã hóa Crypt phía server), KHÔNG bao giờ trả ra — API chỉ
// trả cờ password_set để UI hiển thị "đã lưu".
// =====================================================================
class SapoMailController extends Controller
{
    public function __construct(private SapoMailService $service)
    {
    }

    public function config(): JsonResponse
    {
        $cfg = SapoMailService::config();
        unset($cfg['password']); // tuyệt đối không trả mật khẩu
        return response()->json(['success' => true, 'data' => $cfg]);
    }

    public function updateConfig(Request $request): JsonResponse
    {
        $data = $request->validate([
            'host' => 'required|string|max:190',
            'port' => 'required|integer|min:1|max:65535',
            'encryption' => ['required', Rule::in(['ssl', 'starttls', 'none'])],
            'user' => 'required|string|max:190',
            'folder' => 'nullable|string|max:60',
            'password' => 'nullable|string|max:255', // trống = giữ mật khẩu cũ
        ]);
        SapoMailService::saveConfig($data, $data['password'] ?? null);
        return response()->json(['success' => true, 'message' => 'Đã lưu cấu hình hộp thư.']);
    }

    /** POST /api/sapo/mail/check-now — nút "Kiểm tra mail ngay" trong Admin */
    public function checkNow(): JsonResponse
    {
        $summary = $this->service->check(false);
        if (!empty($summary['error'])) {
            return response()->json(['success' => false, 'message' => $summary['error'], 'data' => $summary], 422);
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã quét ' . $summary['scanned'] . ' mail: import ' . $summary['imported']
                . ', anchor không khớp ' . $summary['anchor_unmatched'] . ', hết hạn ' . $summary['expired']
                . ', lỗi ' . $summary['errors'] . '.',
            'data' => $summary,
        ]);
    }

    /** GET /api/sapo/mail/logs — nhật ký mail + cảnh báo gần đây */
    public function logs(): JsonResponse
    {
        $logs = SapoMailLog::with('branch:id,name')
            ->orderByDesc('id')
            ->limit(50)
            ->get();
        return response()->json(['success' => true, 'data' => $logs]);
    }
}
