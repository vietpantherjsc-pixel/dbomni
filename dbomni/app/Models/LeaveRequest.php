<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 35: Yêu cầu nghỉ / đổi ca.
class LeaveRequest extends Model
{
    protected $guarded = [];

    protected $casts = ['date_from' => 'date', 'date_to' => 'date'];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
