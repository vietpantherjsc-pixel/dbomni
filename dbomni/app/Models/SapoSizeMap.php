<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Cầu nối Sapo (2026-10-21): keyword nhận diện size trong text lựa chọn (VD "size m" → "M").
// Fallback khi đoạn text chưa có trong sapo_option_map.
class SapoSizeMap extends Model
{
    // Sửa lỗi 1146 (2026-10-21): migration tạo bảng số ít — khai $table tường minh,
    // không để Eloquent tự suy số nhiều (sapo_product_maps) gây "table doesn't exist".
    protected $table = 'sapo_size_map';
    protected $guarded = [];
}
