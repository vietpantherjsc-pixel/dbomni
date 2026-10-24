<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// SPEC R&D: dòng chi phí cố định/tháng cho Tab 2 + nuôi công thức hòa vốn Tab 3.
// branch_id null = phạm vi toàn hệ thống (mỗi phạm vi có bộ dòng riêng).
class RdFixedCost extends Model
{
    protected $fillable = [
        'branch_id', 'name', 'amount', 'source', 'source_note', 'is_overridden', 'updated_by',
    ];

    protected $casts = [
        'amount' => 'float',
        'is_overridden' => 'boolean',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
