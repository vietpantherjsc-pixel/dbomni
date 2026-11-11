<?php

namespace App\Http\Middleware;

use App\Models\Employee;
use App\Models\User;
use App\Support\PermissionTree;
use Closure;
use Illuminate\Http\Request;

// Gói 26: kiểm tra quyền theo ma trận roles.permissions (vd "staff.employees.view").
// - User tầng Chủ Sở Hữu: full quyền để tương thích ngược.
// - User tầng Chủ Chi Nhánh (spec đã khóa 10/11/2026 §2.0A/§3.3): CHỈ đi
//   qua 7 năng lực lương trong đúng CN mình; mọi route khác → 403 (kể cả
//   đơn/kho/cài đặt/khách — ô đi-qua bắt buộc §8.3). Phạm vi CN được ép
//   tiếp trong controller (SalaryScope).
// - Employee: phải còn hoạt động + role có quyền (hỗ trợ "*" và wildcard
//   tiền tố đa tầng — Role::hasPermission).
// - Tài khoản User đang mang mật khẩu tạm (must_change_password) bị chặn
//   mọi route có gác quyền cho tới khi đổi mật khẩu (đường đổi mật khẩu
//   không gắn middleware này nên vẫn đi được).
class CheckPermission
{
    public function handle(Request $request, Closure $next, string $permission)
    {
        $actor = $request->user();

        if ($actor instanceof User) {
            if ((bool) ($actor->must_change_password ?? false)) {
                return response()->json([
                    'success' => false,
                    'code' => 'MUST_CHANGE_PASSWORD',
                    'message' => 'Vui lòng đổi mật khẩu tạm trước khi tiếp tục.',
                ], 403);
            }
            if ($actor->isBranchOwner()) {
                if (in_array($permission, PermissionTree::SALARY_LEAVES, true)) {
                    return $next($request);
                }
                return response()->json(['success' => false, 'message' => 'Tài khoản Chủ Chi Nhánh chỉ được thao tác lương của chi nhánh mình.'], 403);
            }
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
