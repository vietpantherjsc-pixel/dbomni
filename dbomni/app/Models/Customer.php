<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 5 (2026-10-05): Khách hàng — SĐT làm định danh, mã QR thành viên.
class Customer extends Model
{
    protected $guarded = [];

    protected $casts = [
        'birthday' => 'date',
        'total_spent' => 'decimal:2',
    ];

    public function tier(): BelongsTo
    {
        return $this->belongsTo(MembershipTier::class, 'membership_tier_id');
    }

    public function pointTransactions(): HasMany
    {
        return $this->hasMany(PointTransaction::class)->orderByDesc('id');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class)->orderByDesc('id');
    }
}
