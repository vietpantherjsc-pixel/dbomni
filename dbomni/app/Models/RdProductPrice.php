<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// SPEC R&D: giá theo kênh (price_list) dự kiến của món nháp.
class RdProductPrice extends Model
{
    protected $fillable = ['rd_product_id', 'price_list_id', 'price'];

    protected $casts = ['price' => 'float'];

    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }
}
