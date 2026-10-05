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
        'order_type',
        'online_channel', // Gói 6: pos | zalo
        'table_id',
        'shift_id',
        'order_number',
        'code',
        'customer_id', // Gói 5
        'customer_name',
        'customer_phone',
        'zalo_user_id', // Gói 6
        'delivery_address', // Gói 6
        'distance_km', // Gói 6
        'shipping_fee', // Gói 6
        'shipping_discount', // Gói 10c: KM giảm phí ship
        'shipping_promotion_id', // Gói 10c
        'scheduled_at', // Gói 6: hẹn giờ lấy
        'subtotal_amount',
        'discount_amount',
        'voucher_code',
        'promotion_id', // Gói 5
        'promotion_discount', // Gói 5
        'points_earned', // Gói 5
        'points_redeemed', // Gói 5
        'total_amount',
        'status',
        'payment_method',
        'payment_status',
        'stock_deducted',
        'note',
        'cancel_reason',
        'cancelled_at',
    ];

    protected $casts = [
        'subtotal_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'promotion_discount' => 'decimal:2',
        'shipping_fee' => 'decimal:2',
        'shipping_discount' => 'decimal:2', // Gói 10c
        'distance_km' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'cancelled_at' => 'datetime',
        'scheduled_at' => 'datetime',
        'stock_deducted' => 'boolean',
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

    // Gói 5/6: khách hàng thành viên của đơn
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    // Gói 5: khuyến mại đã áp dụng
    public function promotion(): BelongsTo
    {
        return $this->belongsTo(Promotion::class);
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    // Gói 3b: bàn phục vụ của đơn (nullable)
    public function table(): BelongsTo
    {
        return $this->belongsTo(Table::class, 'table_id');
    }
}
