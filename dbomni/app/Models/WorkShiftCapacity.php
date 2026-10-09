<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 37: sức chứa tối đa theo từng ca + từng ngày trong tuần (weekday 0=Thứ 2..6=CN).
class WorkShiftCapacity extends Model
{
    protected $guarded = [];

    public function workShift(): BelongsTo
    {
        return $this->belongsTo(WorkShift::class);
    }
}
