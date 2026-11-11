<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 26: Chức vụ + ma trận quyền (permissions JSON, vd ["orders.list.view"]).
// Cây phân quyền chi tiết (spec đã khóa 10/11/2026 §1.4): hasPermission khớp
// wildcard theo tiền tố ở MỌI độ sâu — 'inventory.*' và 'inventory.inbound.*'
// đều khớp các lá phía dưới. Khóa '*' vẫn bị cấm trong role nhân viên
// (RoleController::guardPermissions chặn lúc lưu).
class Role extends Model
{
    protected $table = 'job_roles';

    protected $fillable = ['name', 'permissions'];

    protected $casts = [
        'permissions' => 'array',
    ];

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }

    // Kiểm tra 1 quyền, hỗ trợ wildcard "*" và "tiền tố.*" ở mọi độ sâu
    public function hasPermission(string $permission): bool
    {
        $perms = $this->permissions ?? [];
        if (in_array('*', $perms, true)) return true;
        if (in_array($permission, $perms, true)) return true;
        // Wildcard tiền tố: 'inventory.*' khớp 'inventory.inbound.view',
        // 'inventory.inbound.*' khớp 'inventory.inbound.approve', ...
        foreach ($perms as $p) {
            if (str_ends_with($p, '.*') && str_starts_with($permission, substr($p, 0, -1))) {
                return true;
            }
        }
        return false;
    }
}
