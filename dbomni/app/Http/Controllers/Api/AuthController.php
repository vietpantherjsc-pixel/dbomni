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
            $user->tokens()->delete();
            $token = $user->createToken('auth_token')->plainTextToken;
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
            $emp->tokens()->delete();
            $token = $emp->createToken('employee_token')->plainTextToken;
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