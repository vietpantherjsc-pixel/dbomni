<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

// Gói 59 (2026-10-15): QR hub nhân viên (/nhan-vien).
// - 1 mã chung cho toàn hệ thống (không theo chi nhánh).
// - Admin xem / tạo lại trong Thiết lập; tạo lại → QR cũ hết hiệu lực ngay.
class StaffHubQrController extends Controller
{
    private const TOKEN_KEY = 'staff_hub_token';

    private function baseUrl(): string
    {
        $b = Setting::get('qr_base_url', '');
        return rtrim($b !== '' ? $b : config('app.url'), '/');
    }

    private function currentToken(): string
    {
        $token = Setting::get(self::TOKEN_KEY, '');
        if ($token === '') {
            $token = Str::random(32);
            Setting::set(self::TOKEN_KEY, $token);
        }
        return $token;
    }

    private function payload(string $token): array
    {
        return [
            'token' => $token,
            'url' => $this->baseUrl() . '/nhan-vien?t=' . $token,
        ];
    }

    // Lấy QR hiện tại (kèm URL để in)
    public function show(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $this->payload($this->currentToken())]);
    }

    // Tạo lại mã (QR cũ hết hiệu lực ngay)
    public function regenerate(): JsonResponse
    {
            $token = Str::random(32);
        Setting::set(self::TOKEN_KEY, $token);
        return response()->json([
            'success' => true,
            'message' => 'Đã tạo mã QR mới. Hãy in lại và dán tại quầy.',
            'data' => $this->payload($token),
        ]);
    }
}
