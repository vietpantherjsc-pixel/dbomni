<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Batch extends Model
{
    protected $guarded = [];

    // Gói 55: casts để tính toán PHP chính xác, JSON trả số
    protected $casts = [
        // Gói dọn 06/11: cột đã nới decimal(14,4) ở migration 000082 — cast
        // phải khớp cột, giữ decimal:2 làm tồn lẻ < 0,01 bị đọc làm tròn.
        'initial_quantity' => 'decimal:4',
        'current_quantity' => 'decimal:4',
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