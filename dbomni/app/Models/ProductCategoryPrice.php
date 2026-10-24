<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Spec kênh bán hàng (2026-10-19): giá chung theo phân loại kênh (store/online/partner).
// Fallback giá: giá kênh chi tiết -> giá phân loại -> giá gốc.
class ProductCategoryPrice extends Model
{
    protected $guarded = [];

    protected $casts = [
        'price' => 'float',
        'is_active' => 'boolean',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
