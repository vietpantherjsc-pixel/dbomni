<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// SPEC-01: Nhật ký notify từ Zalo Checkout SDK.
class PaymentNotify extends Model
{
    protected $fillable = [
        'order_id', 'pay_channel', 'pay_trans_id', 'amount',
        'status', 'mac_valid', 'processed', 'payload',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'mac_valid' => 'boolean',
        'processed' => 'boolean',
        'payload' => 'array',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}
