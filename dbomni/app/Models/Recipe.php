<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 1 (2026-10-04): Chuẩn hóa theo schema materials+batches.
// Một dòng định mức = (món + tùy chọn tùy chọn) -> (nguyên liệu + số lượng cho 1 đơn vị).
class Recipe extends Model
{
    protected $fillable = [
        'product_id',
        'product_option_id',
        'material_id',
        'quantity',
        'kind', // Gói 8c: ingredient | packaging
    ];

    protected $casts = [
        'quantity' => 'decimal:2',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'product_option_id');
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }
}
