<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 29 (2026-10-09): lịch sử thanh toán trừ dần công nợ của 1 phiếu.
class TransactionPayment extends Model
{
    protected $fillable = [
        'transaction_id', 'amount', 'paid_at', 'payment_method', 'note', 'created_by',
    ];

    protected $casts = [
        'amount' => 'float',
        'paid_at' => 'date',
    ];

    public function transaction(): BelongsTo
    {
        return $this->belongsTo(Transaction::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
