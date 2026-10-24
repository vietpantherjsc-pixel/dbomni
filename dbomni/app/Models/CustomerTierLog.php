<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Loyalty 2.0 (2026-10-21): Lịch sử đổi hạng của khách (spec mục 3.4).
class CustomerTierLog extends Model
{
    protected $guarded = [];

    protected $casts = [
        'window_spent' => 'decimal:2',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function fromTier(): BelongsTo
    {
        return $this->belongsTo(MembershipTier::class, 'from_tier_id');
    }

    public function toTier(): BelongsTo
    {
        return $this->belongsTo(MembershipTier::class, 'to_tier_id');
    }
}
