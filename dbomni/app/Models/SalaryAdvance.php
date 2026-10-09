<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: Ứng lương (trừ vào kỳ lương).
class SalaryAdvance extends Model
{
    protected $fillable = ['employee_id', 'amount', 'date', 'note'];

    protected $casts = [
        'amount' => 'decimal:2',
        'date' => 'date',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
