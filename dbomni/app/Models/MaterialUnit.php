<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 55 p11m: đơn vị quy đổi của nguyên liệu (1 nguyên liệu có nhiều đơn vị)
class MaterialUnit extends Model
{
    protected $guarded = [];

    // Gói 55: casts để tính toán chính xác
    protected $casts = ['conversion_rate' => 'decimal:4'];

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }
}
