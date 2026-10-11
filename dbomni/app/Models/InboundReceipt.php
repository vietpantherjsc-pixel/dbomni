<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 43: phiếu nhập hàng theo hóa đơn nhà cung cấp.
class InboundReceipt extends Model
{
    protected $guarded = [];

    protected $casts = [
        'receipt_date' => 'date',
        'tax_included' => 'boolean',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(InboundReceiptItem::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public static function nextCode(): string
    {
        $datePart = now()->format('Ymd');
        $count = static::whereDate('created_at', now()->toDateString())->count();
        return sprintf('PN-%s-%04d', $datePart, $count + 1);
    }
}
