<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 5 (2026-10-05): Khuyến mại kiểu Sapo.
class Promotion extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    // (gồm cả stack_with_promotion: cột còn trong DB dù không còn đọc/ghi)
    protected $fillable = [
        'name', 'code', 'type', 'coupon_type', 'value', 'scope', 'scope_ids',
        'min_order_amount', 'max_discount_amount', 'gift_product_id', 'gift_quantity',
        'target', 'tier_ids', 'starts_at', 'expires_at', 'days_of_week',
        'time_from', 'time_to', 'channels', 'is_active',
        'stack_with_coupon', 'stack_with_promotion', 'banner_url', 'auto_config',
    ];

    protected $casts = [
        'value' => 'decimal:2',
        'min_order_amount' => 'decimal:2',
        'max_discount_amount' => 'decimal:2',
        'scope_ids' => 'array',
        'tier_ids' => 'array',
        'days_of_week' => 'array',
        'channels' => 'array',
        'starts_at' => 'datetime',
        'expires_at' => 'datetime',
        'is_active' => 'boolean',
        'auto_config' => 'array', // SPEC-02
        // Mô hình cộng dồn 2026-10-21 ~22:45: phía KM chỉ dùng cờ cộng dồn với coupon
        // (cột stack_with_promotion còn trong DB nhưng không còn nơi nào đọc/ghi).
        'stack_with_coupon' => 'boolean',
    ];

    public function giftProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'gift_product_id');
    }
}
