<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

// SPEC R&D (2026-10-21): món NHÁP — nằm ở bảng riêng, không bao giờ xuất hiện
// trong danh sách mặt hàng / POS / Mini App / thực đơn / báo cáo.
class RdProduct extends Model
{
    protected $fillable = [
        'name', 'category_id', 'unit', 'description', 'image_url', 'expected_price',
        'status', 'approved_product_id', 'created_by', 'approved_by', 'approved_at',
    ];

    protected $casts = [
        'expected_price' => 'float',
        'approved_at' => 'datetime',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function recipes(): HasMany
    {
        return $this->hasMany(RdRecipe::class);
    }

    public function optionGroups(): BelongsToMany
    {
        return $this->belongsToMany(OptionGroup::class, 'rd_product_option_group');
    }

    public function prices(): HasMany
    {
        return $this->hasMany(RdProductPrice::class);
    }

    public function approvedProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'approved_product_id');
    }
}
