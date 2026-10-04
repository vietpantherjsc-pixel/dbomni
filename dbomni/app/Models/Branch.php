<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 1 (2026-10-04): Thêm $guarded = [] để seeder/factory tạo được chi nhánh
// (mặc định Laravel chặn mass assignment khi model trống).
class Branch extends Model
{
    protected $guarded = [];

    public function batches(): HasMany
    {
        return $this->hasMany(Batch::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class);
    }
}
