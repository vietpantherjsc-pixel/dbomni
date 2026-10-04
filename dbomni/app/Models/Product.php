<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    protected $guarded = [];

    // Quan hệ: Sản phẩm thuộc về một danh mục
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    // Quan hệ: Một sản phẩm có nhiều tùy chọn (Topping, Size)
    public function options(): HasMany
    {
        return $this->hasMany(ProductOption::class);
    }
}