<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 57 (2026-10-14): Quỹ/tài khoản tiền (tiền mặt quầy, két sắt, ngân hàng, ví điện tử).
class Account extends Model
{
    use HasFactory;

    protected $fillable = [
        'branch_id', 'name', 'type', 'opening_balance', 'is_active',
    ];

    protected $casts = [
        'opening_balance' => 'float',
        'is_active' => 'boolean',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'account_id');
    }

    /** Số dư hiện tại = số dư đầu + tổng thu (paid) - tổng chi (paid). */
    public function currentBalance(): float
    {
        $income = (float) $this->transactions()->where('type', 'income')->where('status', 'paid')->sum('amount');
        $expense = (float) $this->transactions()->where('type', 'expense')->where('status', 'paid')->sum('amount');
        return (float) $this->opening_balance + $income - $expense;
    }
}
