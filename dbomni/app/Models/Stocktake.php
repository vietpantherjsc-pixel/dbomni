<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 4 (2026-10-04): Phiếu kiểm kê kho.
class Stocktake extends Model
{
    protected $guarded = [];

    protected $casts = [
        'checked_at' => 'datetime', // Gói 19: ngày-giờ kiểm kho lúc chốt phiếu
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(StocktakeItem::class);
    }
}
