<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 5 (2026-10-05): Khách hàng — SĐT làm định danh, mã QR thành viên.
class Customer extends Model
{
    // Gói SEC2: fillable显式 thay vì $guarded = [] để tránh mass assignment ngoài ý muốn
    protected $fillable = [
        'member_code', 'name', 'phone', 'birthday',
        'membership_tier_id', 'note', 'referred_by',
        'referral_code', // SPEC-02
        'zalo_id', 'avatar', // Spec P4-P5: định danh Zalo
        'tier_warning_at', 'tier_projected_id', 'tier_manual_until', // Loyalty 2.0
    ];

    protected $casts = [
        'birthday' => 'date',
        'total_spent' => 'decimal:2',
        'tier_warning_at' => 'datetime',
        'tier_manual_until' => 'datetime',
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

    // Loyalty 2.0: các lô điểm (FIFO theo hạn dùng)
    public function pointLots(): HasMany
    {
        return $this->hasMany(PointLot::class);
    }

    // Loyalty 2.0: lịch sử đổi hạng
    public function tierLogs(): HasMany
    {
        return $this->hasMany(CustomerTierLog::class)->orderByDesc('id');
    }

    public function projectedTier(): BelongsTo
    {
        return $this->belongsTo(MembershipTier::class, 'tier_projected_id');
    }
}
