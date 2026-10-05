<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 4 (2026-10-04): Định mức chế biến bán thành phẩm.
// VD: 1ml cốt cà phê cần 0.05g cà phê bột + 0.9ml nước.
class ProductionRecipe extends Model
{
    protected $guarded = [];

    protected $casts = ['quantity' => 'decimal:2'];

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class, 'material_id');
    }

    public function rawMaterial(): BelongsTo
    {
        return $this->belongsTo(Material::class, 'raw_material_id');
    }
}
