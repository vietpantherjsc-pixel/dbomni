<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 37: ghi chú chung của bảng lịch tuần (branch_id null = tất cả chi nhánh).
class ScheduleNote extends Model
{
    protected $guarded = [];

    protected $casts = ['week_start' => 'date'];
}
