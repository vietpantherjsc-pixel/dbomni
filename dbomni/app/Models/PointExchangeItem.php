<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Loyalty 2.0 (2026-10-21): Món trong Cửa hàng điểm — Admin tự cài đặt theo
// mùa (spec mục 1.3/6.3). Coupon phát khi đổi dùng mẫu promotion liên kết.
class PointExchangeItem extends Model
{
    protected $guarded = [];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function promotion(): BelongsTo
    {
        return $this->belongsTo(Promotion::class);
    }

    public function minTier(): BelongsTo
    {
        return $this->belongsTo(MembershipTier::class, 'min_tier_id');
    }
}
