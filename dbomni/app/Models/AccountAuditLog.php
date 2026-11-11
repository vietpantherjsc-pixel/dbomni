<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Nhật ký thêm/thu hồi tài khoản tầng Chủ Sở Hữu / Chủ Chi Nhánh
// (spec đã khóa 10/11/2026 §2.0 khóa #6). Danh sách chỉ Chủ Sở Hữu xem.
class AccountAuditLog extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'created_at' => 'datetime',
    ];

    public function actorUser()
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    public function targetUser()
    {
        return $this->belongsTo(User::class, 'target_user_id');
    }

    public function actor()
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
