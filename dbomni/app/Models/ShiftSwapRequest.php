<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Spec P4-B5 (Đại Vương chốt 2026-10-19): đổi ca thật giữa 2 NV.
// A tạo yêu cầu (ca của mình + ca của B) → B xác nhận → quản lý duyệt → hoán đổi ca.
class ShiftSwapRequest extends Model
{
    protected $guarded = [];

    protected $casts = [
        'target_confirmed_at' => 'datetime',
    ];

    public function requester(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'requester_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'target_id');
    }

    public function requesterSchedule(): BelongsTo
    {
        return $this->belongsTo(WorkSchedule::class, 'requester_schedule_id');
    }

    public function targetSchedule(): BelongsTo
    {
        return $this->belongsTo(WorkSchedule::class, 'target_schedule_id');
    }
}
