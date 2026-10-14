<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Shift extends Model
{
    protected $fillable = [
        'branch_id',
        'cashier_name',
        'opened_by_name', // Gói 55 p11ae: danh tính người mở ca (kiểm tra chủ ca)
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

    // Gói 55 p11b: cast datetime để so sánh ca treo qua ngày
    protected $casts = [
        'opened_at' => 'datetime',
        'closed_at' => 'datetime',
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