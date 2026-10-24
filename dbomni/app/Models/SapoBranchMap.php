<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Cầu nối Sapo (2026-10-21): anchor text của link tải file trong email Sapo
// → chi nhánh DBOMNI (file export không ghi tên chi nhánh). Không khớp → dừng file.
class SapoBranchMap extends Model
{
    // Sửa lỗi 1146 (2026-10-21): migration tạo bảng số ít — khai $table tường minh,
    // không để Eloquent tự suy số nhiều (sapo_product_maps) gây "table doesn't exist".
    protected $table = 'sapo_branch_map';
    protected $guarded = [];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
