<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 26: Ngày lễ + hệ số nhân lương.
class Holiday extends Model
{
    protected $fillable = ['date', 'name', 'multiplier'];

    protected $casts = [
        'date' => 'date',
        'multiplier' => 'decimal:2',
    ];
}
