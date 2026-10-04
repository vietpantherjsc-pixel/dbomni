<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryLog extends Model
{
    protected $fillable = [
        'ingredient_id',
        'type',
        'quantity_change',
        'stock_after',
        'note',
    ];

    public function ingredient()
    {
        return $this->belongsTo(Ingredient::class);
    }
}