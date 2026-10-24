<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 52: đơn vị tính dùng chung toàn hệ thống
// Spec cài đặt danh sách (2026-10-21): thêm group / is_active / sort_order
class Unit extends Model
{
    protected $guarded = [];

    protected $casts = [
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];
}
