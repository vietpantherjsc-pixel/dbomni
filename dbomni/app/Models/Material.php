<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Material extends Model
{
    protected $guarded = [];

    public function batches(): HasMany
    {
        return $this->hasMany(Batch::class);
    }

    // Gói 22: loại danh mục nguyên liệu (nhóm kiểm kho động)
    public function category(): BelongsTo
    {
        return $this->belongsTo(MaterialCategory::class, 'material_category_id');
    }
}