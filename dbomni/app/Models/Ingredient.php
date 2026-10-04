<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Ingredient extends Model
{
    protected $fillable = [
        'name',
        'unit',
        'cost_per_unit',
        'current_stock',
        'min_stock_alert',
    ];

    public function recipes()
    {
        return $this->hasMany(Recipe::class);
    }

    public function logs()
    {
        return $this->hasMany(InventoryLog::class);
    }
}