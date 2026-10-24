<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 40: Khoản trừ khác — danh sách nhiều khoản theo NV/tháng (thay ô nhập tay đơn lẻ cũ).
class SalaryDeduction extends Model
{
    // Audit 2026-10-23 A4-7: bổ sung 'kind' (fine|other) — thiếu trường này
    // khiến khoản PHẠT tạo qua API bị rớt kind, lưu thành 'other'
    protected $fillable = ['employee_id', 'month', 'name', 'amount', 'note', 'sort_order', 'kind'];

    protected $casts = [
        'amount' => 'decimal:2',
        'sort_order' => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
