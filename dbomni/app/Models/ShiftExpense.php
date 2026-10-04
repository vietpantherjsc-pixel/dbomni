<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShiftExpense extends Model
{
    protected $fillable = [
        'shift_id',
        'amount',
        'reason',
        'performed_by',
    ];

    public function shift()
    {
        return $this->belongsTo(Shift::class);
    }
}