<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

// Gói 27 (2026-10-09): phiếu thu/chi.
class Transaction extends Model
{
    protected $fillable = [
        'code', 'type', 'category_id', 'branch_id', 'partner_id', 'amount', 'paid_amount',
        'paid_at', 'occurred_at', 'account_id', 'attachment', // Gói 57
        'approved_by', 'approved_at', // Gói 59: duyệt phiếu (null = chờ duyệt)
        'status', 'payment_method', 'related_type', 'related_id', 'note', 'created_by',
    ];

    protected $casts = [
        'amount' => 'float',
        'paid_amount' => 'float',
        'paid_at' => 'date',
        'occurred_at' => 'date', // Gói 57
        'approved_at' => 'datetime', // Gói 59
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(TransactionCategory::class, 'category_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    // Gói 59: người duyệt phiếu (null = chờ duyệt)
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /** Gói 29: đối tác gắn với phiếu (công nợ). */
    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    // Gói 57: quỹ/tài khoản tiền của phiếu
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'account_id');
    }

    /** Gói 29: lịch sử thanh toán trừ dần. */
    public function payments(): HasMany
    {
        return $this->hasMany(TransactionPayment::class);
    }

    /** Gói 29: còn nợ = amount - paid_amount (không âm). */
    public function remaining(): float
    {
        return max(0, (float) $this->amount - (float) $this->paid_amount);
    }

    /** Phiếu tự sinh từ hệ thống (VD: nhập kho) — không cho sửa/xóa số tiền. */
    public function isAuto(): bool
    {
        return !empty($this->related_type);
    }

    /**
     * Sinh mã phiếu tiếp theo: PC-20261009-0001 / PT-20261009-0001.
     * Gọi trong transaction để tránh trùng khi nhập liệu đồng thời ở mức cơ bản.
     */
    public static function nextCode(string $type): string
    {
        $prefix = $type === 'income' ? 'PT' : 'PC';
        $datePart = now()->format('Ymd');
        $count = DB::table('transactions')
            ->where('type', $type)
            ->whereDate('created_at', now()->toDateString())
            ->lockForUpdate()
            ->count();
        return sprintf('%s-%s-%04d', $prefix, $datePart, $count + 1);
    }
}
