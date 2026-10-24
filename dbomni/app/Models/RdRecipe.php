<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// SPEC R&D: dòng định mức của món nháp (gương bảng recipes của món thật).
class RdRecipe extends Model
{
    protected $fillable = [
        'rd_product_id', 'product_option_id', 'material_id', 'quantity', 'kind',
    ];

    protected $casts = [
        'quantity' => 'float',
    ];

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
