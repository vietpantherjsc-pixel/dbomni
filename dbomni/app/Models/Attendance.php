<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 35: Chấm công QR.
class Attendance extends Model
{
    protected $guarded = [];

    protected $casts = ['date' => 'date', 'check_in' => 'datetime', 'check_out' => 'datetime'];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
