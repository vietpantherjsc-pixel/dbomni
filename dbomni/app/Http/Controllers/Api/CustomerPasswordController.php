<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Services\CustomerSessionService;
use App\Services\ZaloAuthService;
use App\Support\CustomerPasswordValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

// Spec đăng nhập SĐT + mật khẩu (Đại Vương chốt 2026-11-05 ~14:16):
// đường phụ đăng nhập bằng mật khẩu do khách tự đặt; khôi phục qua Zalo.
// Cả 4 điểm đặt mật khẩu dùng CHUNG CustomerPasswordValidator (T-09) —
// không điểm nào validate riêng lẻ.
class CustomerPasswordController extends Controller
{
    public const LOCK_ATTEMPTS = 5;
    public const LOCK_MINUTES = 15;

    /** Thông tin khách trả về ở các endpoint mật khẩu/phiên (hiển thị, không bí mật). */
    public static function profilePayload(Customer $customer): array
    {
        return [
            'customer_id' => $customer->id,
            'phone' => $customer->phone,
            'name' => $customer->name,
            'member_code' => $customer->member_code,
            'has_password' => !empty($customer->password_hash),
            'email' => $customer->email,
            'has_consented' => !empty($customer->consent_agreed_at),
        ];
    }

    private function passwordErrorsResponse(array $errors): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => 'weak_password',
            'message' => $errors[0] ?? 'Mật khẩu chưa đạt yêu cầu.',
            'errors' => $errors,
        ], 422);
    }

    private function newPasswordInput(Request $request): array
    {
        $v = $request->validate([
            'new_password' => 'required|string',
            'new_password_confirmation' => 'required|string',
        ]);
        if ($v['new_password'] !== $v['new_password_confirmation']) {
            return [null, response()->json([
                'success' => false,
                'code' => 'password_mismatch',
                'message' => 'Mật khẩu nhập lại chưa khớp.',
                'errors' => ['Mật khẩu nhập lại chưa khớp.'],
            ], 422)];
        }
        return [$v['new_password'], null];
    }

    // POST /customer/password/login — SĐT + mật khẩu → token phiên.
    public function login(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'required|string|max:20',
            'password' => 'required|string',
        ]);
        $phone = trim($v['phone']);
        $generic = 'SĐT hoặc mật khẩu chưa đúng.';

        $customer = Customer::where('phone', $phone)->first();
        // Chống liệt kê: không lộ tài khoản có/không có mật khẩu.
        if (!$customer || empty($customer->password_hash)) {
            return response()->json(['success' => false, 'message' => $generic], 401);
        }

        // Khóa tạm theo tài khoản: sai 5 lần liên tiếp → khóa 15 phút;
        // trong thời gian khóa kể cả mật khẩu đúng cũng bị từ chối.
        if ($customer->password_locked_until && $customer->password_locked_until->isFuture()) {
            $minutes = max(1, (int) ceil(now()->diffInSeconds($customer->password_locked_until) / 60));
            return response()->json([
                'success' => false,
                'code' => 'account_locked',
                'message' => "Tài khoản đang bị khóa tạm thời. Vui lòng thử lại sau {$minutes} phút.",
                'locked_minutes' => $minutes,
            ], 423);
        }
        // Hết hạn khóa → bộ đếm về 0 trước khi xét lần thử mới.
        // T-05: ghi 2 cột khóa bằng gán trực tiếp + save() (không qua
        // update()): chúng là trạng thái nội bộ do server quản, không nằm
        // trong Customer::$fillable nên update() bị Eloquent lặng lẽ bỏ qua.
        if ($customer->password_locked_until && $customer->password_locked_until->isPast()) {
            $customer->password_failed_attempts = 0;
            $customer->password_locked_until = null;
            $customer->save();
        }

        if (!Hash::check($v['password'], $customer->password_hash)) {
            $attempts = (int) $customer->password_failed_attempts + 1;
            $customer->password_failed_attempts = $attempts;
            if ($attempts >= static::LOCK_ATTEMPTS) {
                $customer->password_locked_until = now()->addMinutes(static::LOCK_MINUTES);
                Log::info('[MatKhauKhach] Khoa tai khoan do sai mat khau', ['customer_id' => $customer->id, 'ip' => $request->ip()]);
            }
            $customer->save();
            return response()->json(['success' => false, 'message' => $generic], 401);
        }

        $customer->password_failed_attempts = 0;
        $customer->password_locked_until = null;
        $customer->save();
        $issued = CustomerSessionService::issue($customer, 'password', $request);
        Log::info('[MatKhauKhach] Dang nhap bang mat khau', ['customer_id' => $customer->id, 'ip' => $request->ip()]);

        return response()->json(['success' => true, 'data' => array_merge(
            static::profilePayload($customer),
            [
                'session_token' => $issued['token'],
                'session_expires_at' => $issued['expires_at']->toIso8601String(),
            ]
        )]);
    }

    // POST /customer/password/zalo-set — đặt lần đầu (đang ở ngoài) VÀ đặt
    // lại khi quên: một cơ chế duy nhất, xác thực Zalo phía server.
    public function zaloSet(Request $request): JsonResponse
    {
        $v = $request->validate([
            'access_token' => 'required|string',
            'phone_token' => 'nullable|string',
        ]);
        [$newPassword, $errResp] = $this->newPasswordInput($request);
        if ($errResp) return $errResp;

        $verified = ZaloAuthService::verifyTokens($v['access_token'], $v['phone_token'] ?? null);
        if (!$verified['ok']) {
            return response()->json(['success' => false, 'message' => $verified['message']], $verified['status']);
        }
        $verifiedPhone = $verified['verified_phone'];
        if ($verifiedPhone === '') {
            return response()->json([
                'success' => false,
                'code' => 'phone_permission_required',
                'message' => 'Cần số điện thoại đã xác thực từ Zalo để đặt mật khẩu. Vui lòng cấp quyền số điện thoại rồi thử lại.',
            ], 422);
        }

        $customer = Customer::where('phone', $verifiedPhone)->first();
        if (!$customer) {
            return response()->json([
                'success' => false,
                'code' => 'account_not_found',
                'message' => 'Số Zalo này chưa gắn với tài khoản thành viên nào. Khách mới hãy đăng ký bằng Zalo; khách cũ mà số Zalo khác số thành viên thì đặt mật khẩu tại quầy.',
            ], 422);
        }

        // Xung đột định danh: zalo_id đã xác thực đang thuộc tài khoản khác
        // → dừng, rẽ quầy; tuyệt đối không tự gán lại.
        $zaloId = $verified['zalo_id'];
        $other = Customer::where('zalo_id', $zaloId)->where('id', '!=', $customer->id)->first();
        if ($other) {
            return response()->json([
                'success' => false,
                'code' => 'zalo_conflict',
                'message' => 'Số Zalo này đang gắn với một tài khoản khác. Vui lòng đặt mật khẩu tại quầy để nhân viên hỗ trợ.',
            ], 422);
        }

        $errors = CustomerPasswordValidator::errors($newPassword, $verifiedPhone);
        if ($errors) return $this->passwordErrorsResponse($errors);

        $codeRotated = false;
        DB::transaction(function () use ($customer, $newPassword, $zaloId, &$codeRotated) {
            // Tài khoản IMP: đặt qua zalo-set thành công thì xoay mã ngẫu nhiên
            // trong cùng giao dịch (như spec B §5).
            if (is_string($customer->member_code) && str_starts_with($customer->member_code, 'IMP')) {
                $customer->member_code = $this->generateMemberCode();
                $codeRotated = true;
            }
            $customer->password_hash = Hash::make($newPassword);
            $customer->password_set_at = now();
            $customer->password_failed_attempts = 0;
            $customer->password_locked_until = null;
            // SĐT khớp và zalo_id trống/chưa-ai-dùng → cập nhật theo người
            // đang giữ SĐT đã xác thực (đúng neo BM-01).
            $customer->zalo_id = $zaloId;
            $customer->save();
            CustomerSessionService::revokeAll($customer);
        });
        Log::info('[MatKhauKhach] Dat mat khau qua Zalo', ['customer_id' => $customer->id, 'ip' => $request->ip()]);

        $issued = CustomerSessionService::issue($customer->fresh(), 'zalo_set', $request);
        return response()->json(['success' => true, 'data' => array_merge(
            static::profilePayload($customer->fresh()),
            [
                'session_token' => $issued['token'],
                'session_expires_at' => $issued['expires_at']->toIso8601String(),
                'code_rotated' => $codeRotated,
            ]
        )]);
    }

    // POST /customer/password/set — đặt lần đầu khi ĐANG đăng nhập
    // (phiên token bất kỳ) — chỉ khi password_hash đang trống.
    public function set(Request $request): JsonResponse
    {
        $customer = CustomerSessionService::customerFromRequest($request);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'], 401);
        }
        if (!empty($customer->password_hash)) {
            return response()->json(['success' => false, 'message' => 'Tài khoản đã có mật khẩu. Dùng Đổi mật khẩu.'], 422);
        }
        [$newPassword, $errResp] = $this->newPasswordInput($request);
        if ($errResp) return $errResp;

        $errors = CustomerPasswordValidator::errors($newPassword, $customer->phone);
        if ($errors) return $this->passwordErrorsResponse($errors);

        $customer->password_hash = Hash::make($newPassword);
        $customer->password_set_at = now();
        $customer->save();
        // Thu hồi mọi phiên token khác; các thiết bị còn giữ cặp cũ tự rớt
        // vì luật cặp ở CustomerIdentityService.
        $current = CustomerSessionService::sessionFromRequest($request);
        CustomerSessionService::revokeOthers($customer, $current?->id);
        Log::info('[MatKhauKhach] Dat mat khau lan dau (dang dang nhap)', ['customer_id' => $customer->id, 'ip' => $request->ip()]);

        return response()->json(['success' => true, 'data' => static::profilePayload($customer->fresh())]);
    }

    // PATCH /customer/password/change — đổi mật khẩu khi đang đăng nhập.
    public function change(Request $request): JsonResponse
    {
        $customer = CustomerSessionService::customerFromRequest($request);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'], 401);
        }
        $v = $request->validate([
            'current_password' => 'required|string',
        ]);
        if (empty($customer->password_hash) || !Hash::check($v['current_password'], $customer->password_hash)) {
            return response()->json(['success' => false, 'message' => 'Mật khẩu hiện tại chưa đúng.'], 422);
        }
        [$newPassword, $errResp] = $this->newPasswordInput($request);
        if ($errResp) return $errResp;

        $errors = CustomerPasswordValidator::errors($newPassword, $customer->phone);
        if ($errors) return $this->passwordErrorsResponse($errors);

        $customer->password_hash = Hash::make($newPassword);
        $customer->password_set_at = now();
        $customer->password_failed_attempts = 0;
        $customer->password_locked_until = null;
        $customer->save();
        $current = CustomerSessionService::sessionFromRequest($request);
        CustomerSessionService::revokeOthers($customer, $current?->id);
        Log::info('[MatKhauKhach] Doi mat khau', ['customer_id' => $customer->id, 'ip' => $request->ip()]);

        return response()->json(['success' => true, 'data' => static::profilePayload($customer->fresh())]);
    }

    // POST /customer/password/counter-set — đặt trong cửa sổ hỗ trợ tại quầy.
    // Chống liệt kê: không có tài khoản / không có cửa sổ / hết hạn / đã dùng
    // đều trả cùng một thông báo chung.
    public function counterSet(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'required|string|max:20',
        ]);
        [$newPassword, $errResp] = $this->newPasswordInput($request);
        if ($errResp) return $errResp;

        $generic = 'Cửa sổ hỗ trợ đã hết hạn hoặc không hợp lệ. Nhờ nhân viên mở lại tại quầy.';
        $customer = Customer::where('phone', trim($v['phone']))->first();
        if (!$customer || !$customer->password_setup_until || $customer->password_setup_until->isPast()) {
            return response()->json(['success' => false, 'message' => $generic], 422);
        }

        $errors = CustomerPasswordValidator::errors($newPassword, $customer->phone);
        if ($errors) return $this->passwordErrorsResponse($errors);

        DB::transaction(function () use ($customer, $newPassword) {
            $customer->password_hash = Hash::make($newPassword);
            $customer->password_set_at = now();
            $customer->password_failed_attempts = 0;
            $customer->password_locked_until = null;
            // Đóng cửa sổ ngay (một lần dùng) + ghi mốc đặt qua quầy.
            $customer->password_setup_until = null;
            $customer->password_setup_at = now();
            $customer->save();
            CustomerSessionService::revokeAll($customer);
        });
        Log::info('[MatKhauKhach] Dat mat khau tai quay', ['customer_id' => $customer->id, 'ip' => $request->ip()]);

        $issued = CustomerSessionService::issue($customer->fresh(), 'counter_set', $request);
        return response()->json(['success' => true, 'data' => array_merge(
            static::profilePayload($customer->fresh()),
            [
                'session_token' => $issued['token'],
                'session_expires_at' => $issued['expires_at']->toIso8601String(),
            ]
        )]);
    }

    // Mẫu mã thành viên như CustomerController::generateMemberCode.
    private function generateMemberCode(): string
    {
        $prefix = \App\Helpers\CodeGenerator::prefix('member');
        $len = max(4, \App\Helpers\CodeGenerator::digits('member'));
        do {
            $code = $prefix . strtoupper(\Illuminate\Support\Str::random($len));
        } while (Customer::where('member_code', $code)->exists());
        return $code;
    }
}
