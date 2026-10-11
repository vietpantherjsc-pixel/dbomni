<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 43: phiếu chuyển kho nguyên liệu giữa các chi nhánh.
class StockTransfer extends Model
{
    protected $guarded = [];

    protected $casts = [
        'confirmed_at' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(StockTransferItem::class);
    }

    public function fromBranch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'from_branch_id');
    }

    public function toBranch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'to_branch_id');
    }

    public static function nextCode(): string
    {
        $datePart = now()->format('Ymd');
        $count = static::whereDate('created_at', now()->toDateString())->count();
        return sprintf('CK-%s-%04d', $datePart, $count + 1);
    }
}
