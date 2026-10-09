<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 25 (2026-10-09): override ẨN mặt hàng theo chi nhánh.
// Mặc định HIỆN ở tất cả CN -> chỉ lưu bản ghi khi bị ẩn.
class BranchProductHidden extends Model
{
    protected $table = 'branch_product_hidden';

    protected $fillable = ['branch_id', 'product_id'];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
