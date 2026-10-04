<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'order_number',
        'total_amount',
        'status',
        'payment_method'
    ];

    // Một đơn hàng có nhiều chi tiết mặt hàng
    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    // Một đơn hàng được tạo bởi một nhân viên
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}