<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Models\User;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        // 1. Kiểm tra dữ liệu đầu vào
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        // 2. Xác thực tài khoản
        if (!Auth::attempt($request->only('email', 'password'))) {
            return response()->json([
                'message' => 'Email hoặc mật khẩu không chính xác.'
            ], 401);
        }

        // 3. Lấy thông tin user
        $user = User::where('email', $request->email)->firstOrFail();
        
        // (Tùy chọn) Xóa token cũ nếu muốn giới hạn 1 thiết bị đăng nhập cùng lúc
        $user->tokens()->delete(); 

        // 4. Cấp Access Token mới
        $token = $user->createToken('auth_token')->plainTextToken;

        // 5. Trả về Token và danh sách quyền hạn (phục vụ Frontend ẩn/hiện menu)
        return response()->json([
            'message' => 'Đăng nhập thành công',
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'roles' => $user->getRoleNames(),
                'permissions' => $user->getAllPermissions()->pluck('name'),
            ]
        ]);
    }
}