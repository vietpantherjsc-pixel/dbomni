<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 55 p11af (2026-10-14): log mỗi lần khách hàng dùng voucher —
// để đếm giới hạn theo khách (per_customer_limit) và truy vết khi mã bị share tràn lan.
class VoucherUsage extends Model
{
    protected $fillable = [
        'voucher_id', 'customer_id', 'order_id', 'used_at',
    ];

    protected $casts = [
        'used_at' => 'datetime',
    ];

    public function voucher()
    {
        return $this->belongsTo(Voucher::class);
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}
