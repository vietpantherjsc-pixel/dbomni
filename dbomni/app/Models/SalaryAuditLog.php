<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Nhật ký lương (spec đã khóa 10/11/2026 §3.7, phán (e) = B): CHỈ ghi hành
// động làm thay đổi (edit · money · config · lock · unlock · export),
// KHÔNG ghi lượt xem. Danh sách xem lại chỉ Chủ Sở Hữu xem được.
class SalaryAuditLog extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'created_at' => 'datetime',
        'actor_branch_id' => 'integer',
        'employee_id' => 'integer',
    ];

    public const ACTIONS = ['edit', 'money', 'config', 'lock', 'unlock', 'export'];

    public function actorUser()
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    public function employee()
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }
}
