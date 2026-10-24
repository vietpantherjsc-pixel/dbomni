<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 4 (2026-10-04): Phiếu kiểm kê kho.
class Stocktake extends Model
{
    protected $guarded = [];

    // Rà mã 2026-10-20: sinh mã phiếu kiểm kê theo quy tắc Thiết lập (CodeGenerator 'stocktake').
    // Gọi trong DB::transaction khi tạo phiếu (giống InboundReceipt::nextCode).
    public static function nextCode(): string
    {
        $count = static::query()->lockForUpdate()->count();
        return \App\Helpers\CodeGenerator::generate('stocktake', $count + 1, false);
    }

    protected $casts = [
        'checked_at' => 'datetime', // Gói 19: ngày-giờ kiểm kho lúc chốt phiếu
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // Gói 43: nhân viên thực hiện (qua trang mobile)
    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(StocktakeItem::class);
    }
}
