<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 26: Thưởng (hiệu suất / sinh nhật / khác).
class Bonus extends Model
{
    public const TYPES = [
        'performance' => 'Thưởng hiệu suất',
        'birthday' => 'Thưởng sinh nhật',
        'other' => 'Thưởng khác',
    ];

    protected $fillable = ['employee_id', 'type', 'amount', 'date', 'note'];

    protected $casts = [
        'amount' => 'decimal:2',
        'date' => 'date',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
