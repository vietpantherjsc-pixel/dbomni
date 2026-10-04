<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'product_id',
        'product_name',
        'price',
        'quantity',
        'subtotal',
        'note'
    ];

    // Một chi tiết thuộc về một đơn hàng
    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    // Liên kết đến mặt hàng gốc (để lấy ảnh/dữ liệu nếu cần)
    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}