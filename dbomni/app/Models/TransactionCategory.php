<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 27 (2026-10-09): danh mục thu/chi.
class TransactionCategory extends Model
{
    // cost_type (migration 000117): fixed | variable | null — phân loại
    // Cố định/Biến đổi phục vụ điểm hòa vốn TC-1 (chỉ số 360 đợt 1).
    protected $fillable = ['name', 'type', 'is_system', 'cost_type'];

    protected $casts = ['is_system' => 'boolean'];

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'category_id');
    }
}
