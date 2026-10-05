<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 7a: Bảng giá theo kênh (nha_hang, grabfood, shopeefood, greenfood, online).
class PriceList extends Model
{
    protected $guarded = [];

    public function prices(): HasMany
    {
        return $this->hasMany(ProductPrice::class);
    }
}
