<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 4 (2026-10-04): Phiếu chế biến bán thành phẩm.
class Production extends Model
{
    protected $guarded = [];

    protected $casts = ['quantity' => 'decimal:2'];

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }

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
        return $this->hasMany(ProductionItem::class);
    }
}
