<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Cầu nối Sapo (2026-10-21): đoạn text trong cột "Tên lựa chọn" → tùy chọn DBOMNI
// (thuộc nhóm tùy chọn, gồm size). Trừ kho theo định mức của tùy chọn đã map.
class SapoOptionMap extends Model
{
    // Sửa lỗi 1146 (2026-10-21): migration tạo bảng số ít — khai $table tường minh,
    // không để Eloquent tự suy số nhiều (sapo_product_maps) gây "table doesn't exist".
    protected $table = 'sapo_option_map';
    protected $guarded = [];

    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'option_id');
    }
}
