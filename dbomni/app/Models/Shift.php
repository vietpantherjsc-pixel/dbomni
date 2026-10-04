<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Shift extends Model
{
    protected $fillable = [
        'branch_id',
        'cashier_name',
        'opened_at',
        'closed_at',
        'opening_cash',
        'closing_cash_actual',
        'cash_sales',
        'transfer_sales',
        'cash_out',
        'expected_cash',
        'difference',
        'status',
        'note',
    ];

    public function orders()
    {
        return $this->hasMany(Order::class);
    }

    public function expenses()
    {
        return $this->hasMany(ShiftExpense::class);
    }
}