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
        // Spec định mức đơn vị quy đổi (2026-11-05): đơn vị hiển thị đã chọn
        // + hệ số chụp tại lúc lưu (NULL = nhập theo cơ sở).
        'display_unit_name',
        'display_factor',
    ];

    protected $casts = [
        // Spec định mức đơn vị quy đổi: nới lên decimal:4 (cast 2 số lẻ sẽ
        // âm thầm làm tròn lại ngay khi đọc — ca 5 Gram = 0,0050 Kg chết).
        'quantity' => 'decimal:4',
    ];

    protected $appends = ['display_qty'];

    // Số hiển thị (độ mịn đọc 6 số lẻ, spec 1.3): số cơ sở ÷ hệ số chụp.
    public function getDisplayQtyAttribute(): float
    {
        return \App\Support\RecipeUnitResolver::displayQty($this->quantity, $this->display_factor);
    }

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
