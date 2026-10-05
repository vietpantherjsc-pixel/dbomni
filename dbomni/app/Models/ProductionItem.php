<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 4 (2026-10-04): Dòng nguyên liệu thô tiêu hao trong 1 phiếu chế biến.
class ProductionItem extends Model
{
    protected $guarded = [];

    protected $casts = ['quantity' => 'decimal:2'];

    public function production(): BelongsTo
    {
        return $this->belongsTo(Production::class);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }
}
