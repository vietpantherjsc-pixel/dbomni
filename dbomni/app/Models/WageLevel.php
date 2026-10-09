<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: Mức lương theo giờ của nhân viên (có ngày bắt đầu/kết thúc áp dụng).
class WageLevel extends Model
{
    protected $fillable = ['employee_id', 'hourly_rate', 'responsibility_rate', 'start_date', 'end_date', 'note'];

    protected $casts = [
        'hourly_rate' => 'decimal:2',
        'responsibility_rate' => 'decimal:2',
        'start_date' => 'date',
        'end_date' => 'date',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
