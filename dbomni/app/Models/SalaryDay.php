<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: Chi tiết giờ công theo ngày (nhập tay / sau này đồng bộ từ chấm công).
class SalaryDay extends Model
{
    protected $fillable = ['employee_id', 'branch_id', 'date', 'check_in', 'check_out', 'hours', 'hours_source', 'meal_count', 'meal_manual'];

    protected $casts = [
        'date' => 'date',
        'hours' => 'decimal:2',
        'meal_manual' => 'boolean',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    // Gói 55: chi nhánh của ca làm việc (để tách giờ công khi NV làm 2 CN)
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
