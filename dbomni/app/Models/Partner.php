<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

// Gói 29 (2026-10-09): Đối tác (NCC/khách hàng/khác) — dùng chung toàn chuỗi,
// có theo dõi công nợ phải thu/phải trả, trừ dần khi thanh toán.
class Partner extends Model
{
    protected $fillable = [
        'code', 'name', 'type', 'phone', 'email', 'address',
        'tax_code', 'note', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class);
    }

    /** Còn nợ phải thu (phiếu thu gắn đối tác, còn dư). */
    public function receivable(): float
    {
        return (float) $this->transactions()
            ->where('type', 'income')
            ->whereRaw('amount - paid_amount > 0')
            ->sum(DB::raw('amount - paid_amount'));
    }

    /** Còn nợ phải trả (phiếu chi gắn đối tác, còn dư). */
    public function payable(): float
    {
        return (float) $this->transactions()
            ->where('type', 'expense')
            ->whereRaw('amount - paid_amount > 0')
            ->sum(DB::raw('amount - paid_amount'));
    }
}
