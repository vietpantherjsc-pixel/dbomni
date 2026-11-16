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
            'consent_agreed' => 'nullable|boolean',
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

        // Vá dứt điểm NĐ13 (Đại Vương phán 2026-11-13): CHỈ đóng dấu mốc
        // đồng ý khi request mang cờ consent_agreed = true. Đường này là
        // khách CŨ đăng nhập lại bằng cặp SĐT + mã (không tạo khách mới)
        // — việc đăng nhập không tự nó là một lần đồng ý NĐ13, nên thiếu/
        // sai cờ thì vẫn đăng nhập bình thường nhưng KHÔNG ghi mốc. Đã
        // có mốc thì không ghi đè, như luật các đường khác.
        if (!empty($v['consent_agreed']) && empty($customer->consent_agreed_at)) {
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

    // POST /customer/oa-follow — đồng bộ trạng thái quan tâm OA (spec
    // Quan tâm OA trong app 2026-11-12 mục 2). Nguồn sự thật là Zalo:
    // client đọc followedOA rồi báo về; server chỉ giữ BẢN SAO cho
    // Admin. Khách lấy từ PHIÊN (bearer token) — payload KHÔNG mang mã
    // khách, có gửi cũng bị bỏ qua. Idempotent: trạng thái không đổi
    // thì không ghi lại (mốc oa_followed_at giữ lần đầu ghi nhận).
    public function updateOaFollow(Request $request): JsonResponse
    {
        $customer = CustomerSessionService::customerFromRequest($request);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'], 401);
        }
        $v = $request->validate([
            'followed' => 'required|boolean',
            'id_by_oa' => 'nullable|string|max:100',
        ]);

        $updates = [];
        if ($v['followed'] && empty($customer->oa_followed_at)) {
            $updates['oa_followed_at'] = now();
        }
        if (!$v['followed'] && !empty($customer->oa_followed_at)) {
            $updates['oa_followed_at'] = null;
        }
        if (!empty($v['id_by_oa']) && $v['id_by_oa'] !== $customer->zalo_oa_uid) {
            $updates['zalo_oa_uid'] = $v['id_by_oa'];
        }
        if ($updates) {
            $customer->update($updates);
            Log::info('[QuanTamOA] Dong bo trang thai quan tam OA', ['customer_id' => $customer->id, 'followed' => $v['followed'], 'ip' => $request->ip()]);
        }

        return response()->json(['success' => true, 'data' => CustomerPasswordController::profilePayload($customer->fresh())]);
    }
}
