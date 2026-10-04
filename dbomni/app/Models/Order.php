<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 1 (2026-10-04): Mở rộng fillable khớp với các cột OrderController đang dùng.
class Order extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'branch_id',
        'shift_id',
        'order_number',
        'code',
        'customer_name',
        'customer_phone',
        'subtotal_amount',
        'discount_amount',
        'voucher_code',
        'total_amount',
        'status',
        'payment_method',
        'payment_status',
        'note',
        'cancel_reason',
        'cancelled_at',
    ];

    protected $casts = [
        'subtotal_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'cancelled_at' => 'datetime',
    ];

    // Một đơn hàng có nhiều chi tiết mặt hàng
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    // Một đơn hàng được tạo bởi một nhân viên
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }
}
