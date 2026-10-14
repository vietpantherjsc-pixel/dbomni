<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Batch extends Model
{
    protected $guarded = [];

    // Gói 55: casts để tính toán PHP chính xác, JSON trả số
    protected $casts = [
        'initial_quantity' => 'decimal:2',
        'current_quantity' => 'decimal:2',
        'unit_cost' => 'decimal:2',
        'expired_at' => 'datetime',
    ];

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    // Gói 55 p11w: phiếu nhập tạo ra lô này
    public function receipt(): BelongsTo
    {
        return $this->belongsTo(InboundReceipt::class, 'receipt_id');
    }
}