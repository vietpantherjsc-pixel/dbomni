<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Helpers\CodeGenerator;

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
        // Gói 55 p11w: lockForUpdate để tránh 2 request song song sinh trùng mã
        // (hàm này luôn được gọi bên trong DB::transaction)
        // Gói 55 p11ab: prefix + số chữ số đọc từ Thiết lập
        $count = static::whereDate('created_at', now()->toDateString())->lockForUpdate()->count();
        return CodeGenerator::generate('inbound', $count + 1, true);
    }
}
