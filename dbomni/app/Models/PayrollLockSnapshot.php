<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Audit 2026-10-23 A4-4: snapshot số liệu lương tại thời điểm chốt kỳ —
// 1 dòng cho mỗi (dòng bảng tổng theo CN) và 1 dòng chi tiết cho mỗi NV.
class PayrollLockSnapshot extends Model
{
    protected $guarded = [];

    protected $casts = ['data' => 'array'];

    public function lock(): BelongsTo
    {
        return $this->belongsTo(PayrollLock::class, 'lock_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
