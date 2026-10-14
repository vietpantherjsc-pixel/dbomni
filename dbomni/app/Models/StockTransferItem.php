<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 43: chi tiết phiếu chuyển kho.
class StockTransferItem extends Model
{
    protected $guarded = [];

    // Gói 55: casts để tính toán chính xác
    protected $casts = ['quantity' => 'decimal:2', 'unit_cost' => 'decimal:2'];

    public function transfer(): BelongsTo
    {
        return $this->belongsTo(StockTransfer::class, 'stock_transfer_id');
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }

    public function fromBatch(): BelongsTo
    {
        return $this->belongsTo(Batch::class, 'from_batch_id');
    }

    public function toBatch(): BelongsTo
    {
        return $this->belongsTo(Batch::class, 'to_batch_id');
    }
}
