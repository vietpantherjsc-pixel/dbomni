<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 40: Khoản trừ khác — danh sách nhiều khoản theo NV/tháng (thay ô nhập tay đơn lẻ cũ).
class SalaryDeduction extends Model
{
    protected $fillable = ['employee_id', 'month', 'name', 'amount', 'note', 'sort_order'];

    protected $casts = [
        'amount' => 'decimal:2',
        'sort_order' => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
