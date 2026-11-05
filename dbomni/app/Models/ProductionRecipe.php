<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 4 (2026-10-04): Định mức chế biến bán thành phẩm.
// VD: 1ml cốt cà phê cần 0.05g cà phê bột + 0.9ml nước.
class ProductionRecipe extends Model
{
    protected $guarded = [];

    // Spec định mức đơn vị quy đổi (2026-11-05): nới lên decimal:4 — cast 2 số
    // lẻ sẽ âm thầm làm tròn lại ngay khi đọc (ca 5 Gram = 0,0050 Kg chết).
    protected $casts = ['quantity' => 'decimal:4', 'batch_output_qty' => 'decimal:4'];

    protected $appends = ['display_qty', 'batch_display_qty'];

    // Số hiển thị của dòng (độ mịn đọc 6 số lẻ, spec 1.3).
    public function getDisplayQtyAttribute(): float
    {
        return \App\Support\RecipeUnitResolver::displayQty($this->quantity, $this->display_factor);
    }

    // Số hiển thị của ô sản lượng mẻ (null khi chưa có batch_output_qty).
    public function getBatchDisplayQtyAttribute(): ?float
    {
        if ($this->batch_output_qty === null) {
            return null;
        }
        return \App\Support\RecipeUnitResolver::displayQty($this->batch_output_qty, $this->batch_display_factor);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class, 'material_id');
    }

    public function rawMaterial(): BelongsTo
    {
        return $this->belongsTo(Material::class, 'raw_material_id');
    }
}
