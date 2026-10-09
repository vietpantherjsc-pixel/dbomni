<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 37: đếm lượt GỬI đăng ký ca của NV theo tuần (draft không tính).
class ShiftRegWeek extends Model
{
    protected $guarded = [];

    protected $casts = ['week_start' => 'date'];
}
