<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 5 (2026-10-05): Hạng thành viên (Thường/Bạc/Vàng/Kim cương) + tỉ lệ tích điểm.
class MembershipTier extends Model
{
    protected $guarded = [];

    protected $casts = [
        'min_total_spent' => 'decimal:2',
        'earn_per_amount' => 'decimal:2',
        'is_default' => 'boolean',
    ];

    public function customers(): HasMany
    {
        return $this->hasMany(Customer::class);
    }
}
