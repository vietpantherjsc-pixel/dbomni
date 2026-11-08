<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

// Spec đăng nhập SĐT + mật khẩu §4: phần đổi token + lấy SĐT đã xác thực
// của ZaloAuthController tách thành service dùng chung cho cả /zalo/auth
// và /customer/password/zalo-set — không chép hai bản.
// Chỉ làm đúng việc xác thực phía server, KHÔNG liên kết/tạo tài khoản
// (phần đó ở từng controller gọi).
class ZaloAuthService
{
    /**
     * Đổi access_token + phone_token qua graph.zalo.me kèm appsecret_proof.
     * Trả ['ok' => true, 'zalo_id' => ..., 'verified_phone' => ..., 'me' => ...]
     * hoặc ['ok' => false, 'status' => 401|500|502, 'message' => ...].
     * verified_phone = '' khi không có phone_token hoặc Zalo không trả SĐT
     * (caller tự quyết định: /zalo/auth cần SĐT để tạo mới; zalo-set thì
     * trả 422 phone_permission_required).
     * $caller ('auth' | 'zalo-set') chỉ để gắn nhãn vào log chẩn đoán bước
     * đổi /me/info (châm 2026-11-07) — không ảnh hưởng logic xác thực.
     */
    public static function verifyTokens(string $accessToken, ?string $phoneToken, string $caller = 'unknown'): array
    {
        $appId = config('services.zalo.app_id') ?: env('ZALO_APP_ID');
        $appSecret = env('ZALO_APP_SECRET');
        if (!$appId || !$appSecret) {
            return ['ok' => false, 'status' => 500, 'message' => 'Chưa cấu hình Zalo App (ZALO_APP_ID/ZALO_APP_SECRET).'];
        }

        $proof = hash_hmac('sha256', $accessToken, $appSecret);

        try {
            $resp = Http::timeout(10)->get('https://graph.zalo.me/v2.0/me', [
                'access_token' => $accessToken,
                'appsecret_proof' => $proof,
                'fields' => 'id,name,picture',
            ]);
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 502, 'message' => 'Không kết nối được Zalo.'];
        }

        if (!$resp->successful()) {
            return ['ok' => false, 'status' => 401, 'message' => 'Token Zalo không hợp lệ.'];
        }
        $me = $resp->json();
        $zaloId = (string) ($me['id'] ?? '');
        if (!$zaloId) {
            return ['ok' => false, 'status' => 401, 'message' => 'Không xác định được user Zalo.'];
        }

        // BM-01: SĐT client tự khai KHÔNG có giá trị định danh — chỉ SĐT do
        // Zalo xác thực phía server (đổi phone_token qua /me/info) mới dùng được.
        $verifiedPhone = '';
        $phoneToken = trim((string) ($phoneToken ?? ''));
        if ($phoneToken !== '') {
            try {
                // Vá 2026-11-07 (vá dự phòng, lệnh PM sau lượt thử 15:12): vẫn
                // lỗi 117 dù secret đã đối chiếu trùng từng byte với app —
                // endpoint /me/info dùng credential secret_key THÔ theo tài
                // liệu riêng của getPhoneNumber (bộ tham số access_token ·
                // code · secret_key); appsecret_proof chỉ đúng cho /me ở
                // trên. Chỉ đổi đúng lời gọi này, /me giữ nguyên proof.
                $infoResp = Http::timeout(10)->get('https://graph.zalo.me/v2.0/me/info', [
                    'access_token' => $accessToken,
                    'code' => $phoneToken,
                    'secret_key' => $appSecret,
                ]);
                if ($infoResp->successful()) {
                    $number = preg_replace('/\D/', '', (string) ($infoResp->json('data.number') ?? ''));
                    if (str_starts_with($number, '84') && strlen($number) >= 11) {
                        $number = '0' . substr($number, 2);
                    }
                    $verifiedPhone = $number;
                    if ($verifiedPhone === '') {
                        // Châm chẩn đoán SĐT (2026-11-07): HTTP thành công
                        // nhưng Zalo không trả số — ghi lại để phân định
                        // với nhánh lỗi HTTP ở dưới.
                        Log::warning('ZaloAuthService /me/info empty_number', [
                            'caller' => $caller, 'zalo_id' => $zaloId, 'token_present' => true,
                            'http_status' => $infoResp->status(),
                            'zalo_error' => $infoResp->json('error'),
                            'zalo_message' => $infoResp->json('message'),
                        ]);
                    }
                } else {
                    // Châm chẩn đoán SĐT (2026-11-07): giữ lại status + mã
                    // lỗi Zalo trả — TUYỆT ĐỐI không log token hay SĐT.
                    Log::warning('ZaloAuthService /me/info exchange_failed', [
                        'caller' => $caller, 'zalo_id' => $zaloId, 'token_present' => true,
                        'http_status' => $infoResp->status(),
                        'zalo_error' => $infoResp->json('error'),
                        'zalo_message' => $infoResp->json('message'),
                    ]);
                }
            } catch (\Throwable $e) {
                // Châm chẩn đoán SĐT (2026-11-07): chỉ log LOẠI exception —
                // message của HTTP client có thể chứa URL kèm access_token,
                // phone_token và appsecret_proof, cấm ghi ra log.
                Log::warning('ZaloAuthService /me/info exception', [
                    'caller' => $caller, 'zalo_id' => $zaloId, 'token_present' => true,
                    'exception' => $e::class,
                ]);
                $verifiedPhone = ''; // lỗi mạng -> coi như chưa xác thực SĐT
            }
        }

        return ['ok' => true, 'zalo_id' => $zaloId, 'verified_phone' => $verifiedPhone, 'me' => $me];
    }
}
