<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 1 (2026-10-04): Thêm product_option_id + đơn giá lúc bán để không mất
// thông tin size/topping khi đổi giá menu sau này.
class OrderItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'product_id',
        'product_option_id',
        'product_name',
        'price',
        'unit_price',
        'quantity',
        'subtotal',
        'total_price',
        'discount_amount',
        'options', // Gói 7c: [{name, price}]
        'note',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'unit_price' => 'decimal:2',
        'subtotal' => 'decimal:2',
        'total_price' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'options' => 'array',
    ];

    // Một chi tiết thuộc về một đơn hàng
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    // Liên kết đến mặt hàng gốc (để lấy ảnh/dữ liệu nếu cần)
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    // Tùy chọn đã chọn lúc bán (size/topping...)
    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'product_option_id');
    }
}
