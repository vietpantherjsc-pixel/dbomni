<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use App\Models\User;
use App\Models\Employee;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        // 1. Kiểm tra dữ liệu đầu vào
        $request->validate([
            'email' => 'required|string',
            'password' => 'required',
        ]);

        // 2. Xác thực tài khoản admin (users)
        if (Auth::attempt(['email' => $request->email, 'password' => $request->password])) {
            $user = User::where('email', $request->email)->firstOrFail();
            // Phán của Đại Vương 2026-11-08: GIỮ hạn token 30 ngày (Sanctum),
            // BỎ cơ chế giết phiên chéo — đăng nhập mới cấp thêm phiên độc
            // lập, KHÔNG thu hồi token 'auth_token' cũ (trước đây mỗi lần
            // đăng nhập ở máy/trình duyệt khác là phiên Admin đang dùng bị
            // chết theo). Kết thúc phiên kể từ nay đi qua POST /logout (thu
            // hồi đúng token đang gọi) hoặc các điểm thu hồi chủ động khác.
            $token = $user->createToken('auth_token', ['*'])->plainTextToken;
            return response()->json([
                'message' => 'Đăng nhập thành công',
                'access_token' => $token,
                'token_type' => 'Bearer',
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'type' => 'user',
                    'roles' => $user->getRoleNames(),
                    'permissions' => $user->getAllPermissions()->pluck('name'),
                    // Cây phân quyền §2.0A: tầng tài khoản + CN sở hữu + cờ bắt
                    // buộc đổi mật khẩu tạm (frontend ép đổi ở lần đầu).
                    'account_tier' => $user->account_tier,
                    'owner_branch_id' => $user->owner_branch_id,
                    'must_change_password' => (bool) $user->must_change_password,
                ]
            ]);
        }

        // 2b. Gói 26: thử đăng nhập nhân viên bằng username
        $emp = Employee::with(['role:id,name,permissions', 'branch:id,name'])
            ->where('username', $request->string('email'))
            ->where('is_active', true)
            ->first();
        if ($emp && $emp->password && Hash::check($request->string('password'), $emp->password)) {
            // S5: chỉ thu hồi phiên Admin của chính NV ('employee_token') — trước đây
            // xóa TOÀN BỘ token nên đăng nhập Admin giết cả phiên Hub/chấm công/đăng ký ca.
            $emp->tokens()->where('name', 'employee_token')->delete();
            // Audit 2026-10-23 BM-10: token NV có hạn 7 ngày
            $token = $emp->createToken('employee_token', ['employee'], now()->addDays(7))->plainTextToken;
            return response()->json([
                'message' => 'Đăng nhập thành công',
                'access_token' => $token,
                'token_type' => 'Bearer',
                'user' => [
                    'id' => $emp->id,
                    'name' => $emp->full_name,
                    'type' => 'employee',
                    'roles' => $emp->role ? [$emp->role->name] : [],
                    'permissions' => $emp->role?->permissions ?? [],
                    'branch_id' => $emp->branch_id,
                    'branch_name' => $emp->branch?->name,
                ]
            ]);
        }

        return response()->json([
            'message' => 'Email/tên đăng nhập hoặc mật khẩu không chính xác.'
        ], 401);
    }

    // §2.0A: đổi mật khẩu tạm ở lần đăng nhập đầu — dùng chung luật mạnh
    // với khách (CustomerPasswordValidator: min 8 + chữ + IN HOA + ký tự
    // đặc biệt, cấm chuỗi liên tiếp). Route này KHÔNG gắn middleware
    // permission (người đang bị cờ must_change_password vẫn đổi được).
    public function changePassword(Request $request)
    {
        $actor = $request->user();
        if (!($actor instanceof User)) {
            return response()->json(['success' => false, 'message' => 'Chỉ tài khoản quản trị đổi mật khẩu tại đây.'], 403);
        }
        $v = $request->validate([
            'current_password' => 'required|string',
            'password' => 'required|string',
            'password_confirmation' => 'required|string|same:password',
        ]);
        if (!Hash::check($v['current_password'], $actor->password)) {
            return response()->json(['success' => false, 'message' => 'Mật khẩu hiện tại không đúng.'], 422);
        }
        $errors = \App\Support\CustomerPasswordValidator::errors($v['password']);
        if ($errors !== []) {
            return response()->json(['success' => false, 'message' => 'Mật khẩu chưa đạt yêu cầu.', 'errors' => $errors], 422);
        }
        $actor->update(['password' => $v['password'], 'must_change_password' => false]);
        return response()->json(['success' => true, 'message' => 'Đã đổi mật khẩu.']);
    }

    // Đăng xuất thật phía server (2026-11-08): thu hồi ĐÚNG token đang gọi
    // — các phiên khác của cùng tài khoản không bị đụng. Áp cho mọi token
    // API (User/Employee) qua nhóm auth:sanctum; KHÔNG thay đổi chính sách
    // đăng nhập 1-phiên của nhánh Employee trong login().
    public function logout(Request $request)
    {
        $accessToken = $request->user()?->currentAccessToken();
        if ($accessToken instanceof \Laravel\Sanctum\PersonalAccessToken) {
            $accessToken->delete();
        }
        return response()->json(['success' => true, 'message' => 'Đã đăng xuất.']);
    }
}