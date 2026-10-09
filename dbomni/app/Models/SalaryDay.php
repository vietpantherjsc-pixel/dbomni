<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: Chi tiết giờ công theo ngày (nhập tay / sau này đồng bộ từ chấm công).
class SalaryDay extends Model
{
    protected $fillable = ['employee_id', 'date', 'check_in', 'check_out', 'hours', 'meal_count', 'meal_manual'];

    protected $casts = [
        'date' => 'date',
        'hours' => 'decimal:2',
        'meal_manual' => 'boolean',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
