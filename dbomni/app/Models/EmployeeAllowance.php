<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Spec P4-B6: gán mức phụ cấp/tháng cho NV theo loại
class EmployeeAllowance extends Model
{
    protected $guarded = [];

    protected $casts = ['amount' => 'float', 'is_active' => 'boolean'];

    public function type(): BelongsTo
    {
        return $this->belongsTo(AllowanceType::class, 'allowance_type_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    // Tổng phụ cấp của NV trong 1 tháng (dòng theo tháng cụ thể + dòng áp dụng mọi tháng)
    public static function totalForMonth(int $employeeId, string $month): float
    {
        try {
            return (float) static::where('employee_id', $employeeId)
                ->where('is_active', true)
                ->where(fn ($q) => $q->where('month', $month)->orWhereNull('month'))
                ->sum('amount');
        } catch (\Throwable $e) {
            return 0.0;
        }
    }
}
