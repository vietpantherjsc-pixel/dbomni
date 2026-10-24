<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

// Spec P4-P5 (khắc phục kiểm duyệt Zalo): định danh user Zalo phía server.
// Mini App gửi access_token (từ zmp-sdk) → server đổi qua graph.zalo.me kèm appsecret_proof
// → xác thực user → link với customers theo SĐT/zalo_id (ưu tiên SĐT đã có).
// App Secret chỉ nằm trong .env (ZALO_APP_SECRET), TUYỆT ĐỐI không commit.
class ZaloAuthController extends Controller
{
    public function auth(Request $request): JsonResponse
    {
        $v = $request->validate([
            'access_token' => 'required|string',
            'phone' => 'nullable|string|max:20', // SĐT từ getPhoneNumber (đã mã hóa/giải mã ở client)
            'phone_token' => 'nullable|string', // Token SĐT mã hóa từ zmp-sdk getPhoneNumber
            'name' => 'nullable|string|max:150',
            'avatar' => 'nullable|string|max:500',
        ]);

        $appId = config('services.zalo.app_id') ?: env('ZALO_APP_ID');
        $appSecret = env('ZALO_APP_SECRET');
        if (!$appId || !$appSecret) {
            return response()->json(['success' => false, 'message' => 'Chưa cấu hình Zalo App (ZALO_APP_ID/ZALO_APP_SECRET).'], 500);
        }

        // appsecret_proof = HMAC-SHA256(access_token, app_secret)
        $proof = hash_hmac('sha256', $v['access_token'], $appSecret);

        try {
            $resp = Http::timeout(10)->get('https://graph.zalo.me/v2.0/me', [
                'access_token' => $v['access_token'],
                'appsecret_proof' => $proof,
                'fields' => 'id,name,picture',
            ]);
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => 'Không kết nối được Zalo.'], 502);
        }

        if (!$resp->successful()) {
            return response()->json(['success' => false, 'message' => 'Token Zalo không hợp lệ.'], 401);
        }
        $me = $resp->json();
        $zaloId = (string) ($me['id'] ?? '');
        if (!$zaloId) {
            return response()->json(['success' => false, 'message' => 'Không xác định được user Zalo.'], 401);
        }

        // Audit 2026-10-23 BM-01: SĐT client tự khai KHÔNG còn giá trị định danh.
        // Chỉ SĐT do Zalo xác thực phía server mới được dùng để liên kết:
        // đổi phone_token (từ getPhoneNumber của zmp-sdk) qua graph.zalo.me/v2.0/me/info
        // kèm appsecret_proof — cùng mẫu xác thực access_token ở trên.
        $verifiedPhone = '';
        $phoneToken = trim((string) ($v['phone_token'] ?? ''));
        if ($phoneToken !== '') {
            try {
                $infoResp = Http::timeout(10)->get('https://graph.zalo.me/v2.0/me/info', [
                    'access_token' => $v['access_token'],
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
                $verifiedPhone = ''; // lỗi mạng -> coi như chưa xác thực SĐT, không chặn cả luồng
            }
        }

        // Link customer: (1) theo zalo_id đã liên kết; (2) theo SĐT ĐÃ XÁC THỰC; (3) tạo mới.
        $customer = Customer::where('zalo_id', $zaloId)->first();
        if (!$customer && $verifiedPhone !== '') {
            $customer = Customer::where('phone', $verifiedPhone)->first();
            if ($customer && (string) $customer->zalo_id !== $zaloId) {
                // SĐT đã qua xác thực Zalo là neo định danh: gán/đổi zalo_id theo
                // người đang giữ SĐT đã xác thực (kể cả trường hợp thuê bao đổi chủ).
                $customer->update(['zalo_id' => $zaloId]);
            }
        }
        if (!$customer) {
            $customer = Customer::create([
                'phone' => $verifiedPhone ?: null,
                'name' => $v['name'] ?? ($me['name'] ?? 'Khách Zalo'),
                'zalo_id' => $zaloId,
                'avatar' => $v['avatar'] ?? ($me['picture']['data']['url'] ?? null),
            ]);
        } else {
            $updates = [];
            if (!$customer->zalo_id) $updates['zalo_id'] = $zaloId;
            if (empty($customer->phone) && $verifiedPhone !== '') $updates['phone'] = $verifiedPhone;
            if (empty($customer->avatar) && !empty($v['avatar'])) $updates['avatar'] = $v['avatar'];
            if ($updates) $customer->update($updates);
        }

        // Token định danh cho các API online (đơn giản: mã thành viên hiện có)
        return response()->json(['success' => true, 'data' => [
            'customer_id' => $customer->id,
            'member_code' => $customer->member_code,
            'phone' => $customer->phone,
            'name' => $customer->name,
            'zalo_id' => $zaloId,
        ]]);
    }
}
