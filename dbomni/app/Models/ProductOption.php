<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductOption extends Model
{
    protected $guarded = [];

    // Quan hệ: Tùy chọn thuộc về một sản phẩm
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}