<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

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
     */
    public static function verifyTokens(string $accessToken, ?string $phoneToken): array
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
                $infoResp = Http::timeout(10)->get('https://graph.zalo.me/v2.0/me/info', [
                    'access_token' => $accessToken,
                    'code' => $phoneToken,
                    'appsecret_proof' => $proof,
                ]);
                if ($infoResp->successful()) {
                    $number = preg_replace('/\D/', '', (string) ($infoResp->json('data.number') ?? ''));
                    if (str_starts_with($number, '84') && strlen($number) >= 11) {
                        $number = '0' . substr($number, 2);
                    }
                    $verifiedPhone = $number;
                }
            } catch (\Throwable $e) {
                $verifiedPhone = ''; // lỗi mạng -> coi như chưa xác thực SĐT
            }
        }

        return ['ok' => true, 'zalo_id' => $zaloId, 'verified_phone' => $verifiedPhone, 'me' => $me];
    }
}
