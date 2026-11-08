<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\MembershipTier;
use App\Services\CustomerSessionService;
use App\Services\ZaloAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

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
            // Spec đăng ký Zalo B §3.3: mã mời từ ?ref= đã lưu ở thiết bị — chỉ gắn khi tạo mới.
            'referred_by' => 'nullable|string|max:20',
        ]);

        // Spec đăng nhập SĐT + mật khẩu §4: đổi token + lấy SĐT đã xác thực
        // qua service dùng chung với /customer/password/zalo-set.
        $verified = ZaloAuthService::verifyTokens($v['access_token'], $v['phone_token'] ?? null, 'auth');
        if (!$verified['ok']) {
            return response()->json(['success' => false, 'message' => $verified['message']], $verified['status']);
        }
        $me = $verified['me'];
        $zaloId = $verified['zalo_id'];
        $verifiedPhone = $verified['verified_phone'];

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
        // Spec đăng ký Zalo B §2.2 (B3): từ chối quyền SĐT → KHÔNG tạo tài khoản.
        // (Trước đây nhánh tạo chạy cả khi chưa xác thực SĐT và còn sập ở member_code — F2.)
        if (!$customer && $verifiedPhone === '') {
            return response()->json([
                'success' => false,
                'code' => 'phone_permission_required',
                'message' => 'Cần số điện thoại đã xác thực từ Zalo để tạo tài khoản. Vui lòng cấp quyền số điện thoại rồi thử lại.',
            ], 422);
        }
        if (!$customer) {
            // F2 (đã kiểm chứng tĩnh — xem báo cáo gói): nhánh cũ tạo khách mà không
            // truyền member_code, trong khi cột là NOT NULL UNIQUE không giá trị mặc
            // định → MySQL strict ném 1364. Nay tạo đầy đủ như mọi đường tạo khách khác.
            $tier = MembershipTier::where('is_default', true)->first()
                ?? MembershipTier::orderBy('sort_order')->first();
            $customer = Customer::create([
                'phone' => $verifiedPhone,
                'name' => $v['name'] ?? ($me['name'] ?? 'Khách Zalo'),
                'zalo_id' => $zaloId,
                'avatar' => $v['avatar'] ?? ($me['picture']['data']['url'] ?? null),
                'member_code' => $this->generateMemberCode(),
                'membership_tier_id' => $tier?->id,
                'referred_by' => $v['referred_by'] ?? null,
                'consent_agreed_at' => now(),
                'consent_source' => 'zalo_register',
            ]);
        } else {
            $updates = [];
            if (!$customer->zalo_id) $updates['zalo_id'] = $zaloId;
            if (empty($customer->phone) && $verifiedPhone !== '') $updates['phone'] = $verifiedPhone;
            if (empty($customer->avatar) && !empty($v['avatar'])) $updates['avatar'] = $v['avatar'];
            if ($updates) $customer->update($updates);
        }

        // F3 (§5.2): mã IMP coi như đã lộ theo thiết kế — ngay khi chủ tài khoản
        // chứng minh danh tính lần đầu qua Zalo, xoay sang mã ngẫu nhiên, mã cũ chết tại chỗ.
        // (Tài khoản đã tồn tại không bị sửa referred_by — không chiếm công mời ngược.)
        $codeRotated = false;
        if (!$customer->wasRecentlyCreated
            && is_string($customer->member_code)
            && str_starts_with($customer->member_code, 'IMP')) {
            $customer->update(['member_code' => $this->generateMemberCode()]);
            $codeRotated = true;
        }

        // Spec đăng nhập SĐT + mật khẩu §3.1/§3.4: mọi đăng nhập thành công
        // đều phát hành 1 token phiên (180 ngày); member_code vẫn trả để
        // HIỂN THỊ (thẻ thành viên, QR) — client bản mới không được lưu nó
        // làm chứng thực nữa.
        $issued = CustomerSessionService::issue($customer, 'zalo', $request);
        return response()->json(['success' => true, 'data' => [
            'customer_id' => $customer->id,
            'member_code' => $customer->member_code,
            'phone' => $customer->phone,
            'name' => $customer->name,
            'zalo_id' => $zaloId,
            // Spec §3.4: client dựa vào 2 cờ để chọn màn chào mừng/thông báo mã mới.
            'is_new' => $customer->wasRecentlyCreated,
            'code_rotated' => $codeRotated,
            'session_token' => $issued['token'],
            'session_expires_at' => $issued['expires_at']->toIso8601String(),
            'has_password' => !empty($customer->password_hash),
        ]]);
    }

    // Mẫu mã thành viên như CustomerController::generateMemberCode — tiền tố +
    // hậu tố ngẫu nhiên (không số thứ tự, không suy từ SĐT), kiểm trùng vòng lặp.
    private function generateMemberCode(): string
    {
        $prefix = \App\Helpers\CodeGenerator::prefix('member');
        $len = max(4, \App\Helpers\CodeGenerator::digits('member'));
        do {
            $code = $prefix . strtoupper(Str::random($len));
        } while (Customer::where('member_code', $code)->exists());
        return $code;
    }
}
