<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 5 (2026-10-05): Lịch sử cộng/trừ/điều chỉnh điểm.
class PointTransaction extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    protected $fillable = [
        'customer_id', 'order_id', 'coupon_id', 'point_lot_id',
        'point_exchange_item_id', 'type', 'change', 'note',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    // Loyalty 2.0: lô điểm liên quan (truy vết khi trừ/hoàn theo lô)
    public function pointLot(): BelongsTo
    {
        return $this->belongsTo(PointLot::class);
    }
}
