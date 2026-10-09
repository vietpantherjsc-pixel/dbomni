<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 27 (2026-10-09): danh mục thu/chi.
class TransactionCategory extends Model
{
    protected $fillable = ['name', 'type', 'is_system'];

    protected $casts = ['is_system' => 'boolean'];

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'category_id');
    }
}
