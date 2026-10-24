<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Loyalty 2.0 (2026-10-21): Lô điểm — mỗi lần tích/cộng điểm tạo 1 lô có HSD
// riêng; tiêu điểm trừ FIFO theo expires_at tăng dần (spec mục 1.2/5).
class PointLot extends Model
{
    protected $guarded = [];

    protected $casts = [
        'earned_at' => 'datetime',
        'expires_at' => 'datetime',
        'warned_30_at' => 'datetime',
        'warned_7_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function sourceOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'source_order_id');
    }
}
