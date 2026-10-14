<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Helpers\CodeGenerator;

// Gói 55 p11z: phiếu xuất kho — chốt trừ kho theo FIFO.
class OutboundReceipt extends Model
{
    protected $guarded = [];

    protected $casts = [
        'total_quantity' => 'decimal:2',
    ];

    public const REASONS = [
        'damaged' => 'Hủy hàng',
        'internal_use' => 'Dùng nội bộ',
        'sale' => 'Xuất bán',
        'other' => 'Khác',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(OutboundReceiptItem::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function getReasonLabelAttribute(): string
    {
        return self::REASONS[$this->reason] ?? $this->reason;
    }

    public static function nextCode(): string
    {
        // Chống trùng khi 2 request song song — luôn gọi bên trong DB::transaction
        // Gói 55 p11ab: prefix + số chữ số đọc từ Thiết lập
        $count = static::lockForUpdate()->count();
        return CodeGenerator::generate('outbound', $count + 1);
    }
}
