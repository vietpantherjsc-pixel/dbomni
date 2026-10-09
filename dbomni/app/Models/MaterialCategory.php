<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 22 (2026-10-09): Loại danh mục nguyên liệu — nhóm kiểm kho động,
// thay 3 nhóm cứng (thô / bán thành phẩm / bao bì).
class MaterialCategory extends Model
{
    protected $guarded = [];

    public function materials(): HasMany
    {
        return $this->hasMany(Material::class, 'material_category_id');
    }
}
