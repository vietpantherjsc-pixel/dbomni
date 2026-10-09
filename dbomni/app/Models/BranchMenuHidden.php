<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 25 (2026-10-09): override ẨN thực đơn theo chi nhánh.
// Mặc định HIỆN ở tất cả CN -> chỉ lưu bản ghi khi bị ẩn.
class BranchMenuHidden extends Model
{
    protected $table = 'branch_menu_hidden';

    protected $fillable = ['branch_id', 'menu_id'];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function menu(): BelongsTo
    {
        return $this->belongsTo(Menu::class);
    }
}
