<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// CC-R1: Chặn NV đã bị tắt (is_active=false) dùng token cũ.
// Gắn vào group /employee/* — trả 403 khi tài khoản không còn hoạt động.
class EnsureEmployeeActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user instanceof \App\Models\Employee && !$user->is_active) {
            return response()->json([
                'success' => false,
                'message' => 'Tài khoản nhân viên đã bị vô hiệu hóa. Vui lòng liên hệ quản lý.',
            ], 403);
        }
        return $next($request);
    }
}
