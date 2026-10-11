<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Material extends Model
{
    use SoftDeletes; // Gói 46: xóa mềm khi tồn=0, giữ lịch sử

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