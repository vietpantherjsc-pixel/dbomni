<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\CustomerIdentityService;
use App\Services\CustomerSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

// Spec đăng nhập SĐT + mật khẩu §3.3/§3.5 + §7.3: phiên chuyển đổi cho
// thiết bị cũ, đăng xuất, và email tự nguyện của khách.
class CustomerSessionController extends Controller
{
    // POST /customer/session/code-login — đường chuyển đổi cho thiết bị đang
    // đăng nhập sẵn kiểu cặp cũ (49g): đủ điều kiện (cặp còn hiệu lực theo
    // luật 3.2) → phát hành token; không đủ → client xóa cặp, về chưa đăng nhập.
    public function codeLogin(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'required|string|max:20',
            'member_code' => 'required|string|max:20',
        ]);
        $customer = Customer::where('phone', trim($v['phone']))
            ->where('member_code', trim($v['member_code']))
            ->first();
        if (!$customer || !CustomerIdentityService::pairUsable($customer)) {
            return response()->json([
                'success' => false,
                'code' => 'code_login_expired',
                'message' => 'Phiên đăng nhập cũ đã hết hiệu lực. Vui lòng đăng nhập lại bằng Zalo hoặc mật khẩu.',
            ], 401);
        }

        if (empty($customer->consent_agreed_at)) {
            $customer->consent_agreed_at = now();
            $customer->consent_source = 'code_login';
            $customer->save();
        }

        $issued = CustomerSessionService::issue($customer, 'code_exchange', $request);
        return response()->json(['success' => true, 'data' => array_merge(
            CustomerPasswordController::profilePayload($customer->fresh()),
            [
                'session_token' => $issued['token'],
                'session_expires_at' => $issued['expires_at']->toIso8601String(),
            ]
        )]);
    }

    // POST /customer/session/logout — thu hồi đúng phiên hiện tại.
    public function logout(Request $request): JsonResponse
    {
        $session = CustomerSessionService::sessionFromRequest($request);
        if ($session) {
            $session->update(['revoked_at' => now()]);
            Log::info('[MatKhauKhach] Dang xuat (thu hoi phien)', ['customer_id' => $session->customer_id, 'ip' => $request->ip()]);
        }
        return response()->json(['success' => true]);
    }

    // PATCH /customer/profile/email — khách tự thêm/xóa email (spec §7.3).
    // Email chỉ điền khi hồ sơ đang trống ở đường checkout; ở đây khách tự
    // đổi ở trang Tài khoản nên ghi đè được. Để trống = xóa.
    public function updateEmail(Request $request): JsonResponse
    {
        $customer = CustomerSessionService::customerFromRequest($request);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'], 401);
        }
        $v = $request->validate([
            'email' => 'nullable|email:rfc|max:150',
        ]);
        if (!array_key_exists('email', $v)) {
            return response()->json(['success' => true, 'data' => CustomerPasswordController::profilePayload($customer)]);
        }
        $email = $v['email'] !== null ? trim((string) $v['email']) : null;
        if ($email === '') $email = null;

        $updates = ['email' => $email];
        if ($email !== null && $email !== $customer->email) {
            $updates['email_added_at'] = now();
        }
        $customer->update($updates);
        Log::info('[MatKhauKhach] Khach tu cap nhat email', ['customer_id' => $customer->id, 'ip' => $request->ip()]);

        return response()->json(['success' => true, 'data' => CustomerPasswordController::profilePayload($customer->fresh())]);
    }
}
