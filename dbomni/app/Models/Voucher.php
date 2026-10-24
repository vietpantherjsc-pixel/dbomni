<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Voucher extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    // (gồm cả stack_with_coupon: cột còn trong DB dù không còn đọc/ghi)
    protected $fillable = [
        'code', 'name', 'type', 'value', 'max_discount_amount', 'min_order_amount',
        'usage_limit', 'used_count', 'per_customer_limit', 'starts_at', 'expires_at',
        'is_active', 'stack_with_promotion', 'stack_with_coupon',
    ];

    protected $casts = [
        'starts_at' => 'datetime',
        'expires_at' => 'datetime',
        'is_active' => 'boolean',
        // Mô hình cộng dồn 2026-10-21 ~22:45: phía voucher chỉ dùng cờ cộng dồn với KM
        // (cột stack_with_coupon còn trong DB nhưng không còn nơi nào đọc/ghi).
        'stack_with_promotion' => 'boolean',
    ];
}