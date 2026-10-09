<?php

namespace App\Http\Middleware;

use App\Models\Employee;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;

// Gói 26: kiểm tra quyền theo ma trận roles.permissions (vd "staff.view").
// - User (tài khoản admin cũ): full quyền để tương thích ngược.
// - Employee: phải còn hoạt động + role có quyền (hỗ trợ "*" và "module.*").
class CheckPermission
{
    public function handle(Request $request, Closure $next, string $permission)
    {
        $actor = $request->user();

        if ($actor instanceof User) {
            return $next($request);
        }

        if ($actor instanceof Employee) {
            if (!$actor->is_active) {
                return response()->json(['success' => false, 'message' => 'Tài khoản nhân viên đã bị khóa.'], 403);
            }
            $role = $actor->role;
            if ($role && $role->hasPermission($permission)) {
                return $next($request);
            }
        }

        return response()->json(['success' => false, 'message' => 'Không có quyền truy cập.'], 403);
    }
}
