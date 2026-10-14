<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 55 p11ad: nhật ký xuất/nhập kho chi tiết từng lô (batch_id + số lượng + đơn giá vốn).
class StockMovement extends Model
{
    protected $fillable = [
        'branch_id', 'material_id', 'batch_id', 'quantity', 'unit_cost',
        'reference_type', 'reference_id', 'note',
    ];

    protected $casts = [
        'quantity' => 'decimal:4',
        'unit_cost' => 'decimal:2',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(Batch::class);
    }
}
