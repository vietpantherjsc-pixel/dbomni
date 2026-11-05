<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// SPEC R&D: dòng định mức của món nháp (gương bảng recipes của món thật).
class RdRecipe extends Model
{
    protected $fillable = [
        'rd_product_id', 'product_option_id', 'material_id', 'quantity', 'kind',
        // Spec định mức đơn vị quy đổi (2026-11-05): đơn vị hiển thị đã chọn
        // + hệ số chụp tại lúc lưu (NULL = nhập theo cơ sở).
        'display_unit_name', 'display_factor',
    ];

    protected $casts = [
        // Cast float giữ nguyên (spec 1.3 ghi nhận: không làm tròn ngầm).
        'quantity' => 'float',
    ];

    protected $appends = ['display_qty'];

    // Số hiển thị (độ mịn đọc 6 số lẻ, spec 1.3): số cơ sở ÷ hệ số chụp.
    public function getDisplayQtyAttribute(): float
    {
        return \App\Support\RecipeUnitResolver::displayQty($this->quantity, $this->display_factor);
    }

    public function rdProduct(): BelongsTo
    {
        return $this->belongsTo(RdProduct::class);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'product_option_id');
    }
}
