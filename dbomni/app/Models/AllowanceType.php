<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Spec P4-B6: danh mục loại phụ cấp (xăng xe, điện thoại, chuyên cần...)
class AllowanceType extends Model
{
    protected $guarded = [];

    protected $casts = ['is_active' => 'boolean'];

    public static function activeMap(): array
    {
        try {
            return static::where('is_active', true)->orderBy('sort_order')->pluck('name', 'id')->toArray();
        } catch (\Throwable $e) {
            return [];
        }
    }
}
