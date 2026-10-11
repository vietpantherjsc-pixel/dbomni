<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Casts\Attribute;

// Gói 40: Danh mục loại lỗi vi phạm (3 Chuyên) — Đại Vương tự thêm/sửa trong Thiết lập.
class ViolationType extends Model
{
    protected $fillable = ['category', 'name', 'default_points', 'sort_order', 'is_active'];

    protected $casts = [
        'default_points' => 'integer',
        'sort_order' => 'integer',
        'is_active' => 'boolean',
    ];

    public const CATEGORIES = [
        'chuyen_can' => 'Chuyên Cần',
        'chuyen_mon' => 'Chuyên Môn',
        'chuyen_nghiep' => 'Chuyên Nghiệp',
    ];

    protected function categoryName(): Attribute
    {
        return Attribute::get(fn () => self::CATEGORIES[$this->category] ?? $this->category);
    }
}
