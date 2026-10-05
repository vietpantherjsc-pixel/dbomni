<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 9 (2026-10-05): Đơn nhóm — trưởng nhóm tạo link, mọi người vào chọn món chung.
class GroupOrder extends Model
{
    protected $guarded = [];

    protected $casts = [
        'expires_at' => 'datetime',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(GroupOrderItem::class);
    }

    public function isOpen(): bool
    {
        return $this->status === 'open'
            && (!$this->expires_at || $this->expires_at->isFuture());
    }
}
