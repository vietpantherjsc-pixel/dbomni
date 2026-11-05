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
            // Đợt fix rà soát VPS (S5): thu hồi theo MỤC ĐÍCH — đăng nhập Admin chỉ
            // thu hồi token 'auth_token' (phiên Admin), không đụng token mục đích khác.
            $user->tokens()->where('name', 'auth_token')->delete();
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
}