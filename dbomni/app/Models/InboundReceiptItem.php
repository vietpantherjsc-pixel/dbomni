<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 43: dòng hàng của phiếu nhập.
class InboundReceiptItem extends Model
{
    protected $guarded = [];

    protected $casts = [
        'expired_at' => 'date',
    ];

    public function receipt(): BelongsTo
    {
        return $this->belongsTo(InboundReceipt::class, 'inbound_receipt_id');
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
