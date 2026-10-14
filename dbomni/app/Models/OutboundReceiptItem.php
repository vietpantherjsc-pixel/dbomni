<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 55 p11z: dòng nguyên liệu trong phiếu xuất kho.
class OutboundReceiptItem extends Model
{
    protected $guarded = [];

    protected $casts = [
        'quantity' => 'decimal:2',
    ];

    public function receipt(): BelongsTo
    {
        return $this->belongsTo(OutboundReceipt::class, 'outbound_receipt_id');
    }

    public function material(): BelongsTo
    {
        return $this->belongsTo(Material::class);
    }
}
