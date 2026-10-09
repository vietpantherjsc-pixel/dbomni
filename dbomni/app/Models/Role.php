<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 26: Chức vụ + ma trận quyền (permissions JSON, vd ["orders.view","*"]).
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

    // Kiểm tra 1 quyền, hỗ trợ wildcard "*" và "module.*"
    public function hasPermission(string $permission): bool
    {
        $perms = $this->permissions ?? [];
        if (in_array('*', $perms, true)) return true;
        if (in_array($permission, $perms, true)) return true;
        [$module] = explode('.', $permission) + [null];
        if ($module && in_array($module . '.*', $perms, true)) return true;
        return false;
    }
}
