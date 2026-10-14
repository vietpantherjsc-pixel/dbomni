<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Helpers\CodeGenerator;

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
        // Gói 55 p11w: lockForUpdate để tránh 2 request song song sinh trùng mã
        // (hàm này luôn được gọi bên trong DB::transaction)
        // Gói 55 p11ab: prefix + số chữ số đọc từ Thiết lập
        $count = static::whereDate('created_at', now()->toDateString())->lockForUpdate()->count();
        return CodeGenerator::generate('transfer', $count + 1, true);
    }
}
