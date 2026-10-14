<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 55: tên thay thế của món (tên cũ từ app khác/file import → map về món hiện tại)
class ProductAlias extends Model
{
    protected $guarded = [];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
