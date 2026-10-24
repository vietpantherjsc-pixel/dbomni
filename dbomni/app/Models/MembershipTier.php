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
        'min_spent_window' => 'decimal:2',
        'keep_spent_window' => 'decimal:2',
        'earn_per_amount' => 'decimal:2',
        'earn_multiplier' => 'decimal:2',
        'points_discount_pct' => 'integer',
        'benefits' => 'array',
        'is_default' => 'boolean',
    ];

    /**
     * Loyalty 2.0: ngưỡng GIỮ hạng hiệu dụng — Admin nhập số cụ thể thì dùng số
     * đó; để trống (null) thì = 50% ngưỡng lên (chốt Đại Vương 2026-10-21).
     */
    public function effectiveKeepSpent(): float
    {
        if ($this->keep_spent_window !== null) {
            return (float) $this->keep_spent_window;
        }
        return round((float) $this->min_spent_window * 0.5, 2);
    }

    public function customers(): HasMany
    {
        return $this->hasMany(Customer::class);
    }
}
