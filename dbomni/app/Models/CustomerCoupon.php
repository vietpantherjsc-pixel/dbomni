<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// SPEC-02: Ví coupon cá nhân.
class CustomerCoupon extends Model
{
    protected $fillable = [
        'customer_id', 'promotion_id', 'code', 'status',
        'issued_at', 'expires_at', 'used_at', 'used_order_id', 'issue_trigger',
    ];

    protected $casts = [
        'issued_at' => 'datetime',
        'expires_at' => 'datetime',
        'used_at' => 'datetime',
    ];

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function promotion()
    {
        return $this->belongsTo(Promotion::class);
    }

    public function usedOrder()
    {
        return $this->belongsTo(Order::class, 'used_order_id');
    }

    public function scopeActive($q)
    {
        return $q->where('status', 'active');
    }

    public function isUsable(): bool
    {
        if ($this->status !== 'active') return false;
        if ($this->expires_at && $this->expires_at->isPast()) return false;
        return true;
    }
}
