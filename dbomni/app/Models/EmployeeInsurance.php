<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: BHXH nhân viên (chỉ một số NV đóng).
class EmployeeInsurance extends Model
{
    protected $fillable = ['employee_id', 'base_amount', 'employer_pays_all', 'is_active'];

    protected $casts = [
        'base_amount' => 'decimal:2',
        'employer_pays_all' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
