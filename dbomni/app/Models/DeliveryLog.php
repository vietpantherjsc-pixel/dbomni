<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 60 (2026-10-17): Nhật ký giao hàng — toàn bộ payload webhook + sự kiện failover.
// Giữ tối thiểu 30 ngày, tra cứu theo provider_order_id (checklist #17).
class DeliveryLog extends Model
{
    protected $fillable = [
        'order_id', 'provider', 'provider_order_id', 'event', 'payload',
    ];

    protected $casts = [
        'payload' => 'array',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
