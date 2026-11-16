<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Chương trình chỉ số 360 — Đợt 2, N-3: mục tiêu doanh thu tháng theo
// (chi nhánh × tháng), phục vụ TC-3. Chỉ theo từng CN.
class RevenueTarget extends Model
{
    protected $fillable = [
        'branch_id', 'month', 'target_amount', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'month' => 'date',
        'target_amount' => 'decimal:2',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
