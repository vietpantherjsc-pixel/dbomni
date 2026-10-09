<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: Giờ công tháng (nhập tay, dùng tạm khi chưa có module chấm công).
class SalaryRecord extends Model
{
    protected $fillable = ['employee_id', 'month', 'hours', 'work_days', 'holiday_hours', 'note'];

    protected $casts = [
        'hours' => 'decimal:2',
        'holiday_hours' => 'decimal:2',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
