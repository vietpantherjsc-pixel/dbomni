<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// SPEC-02: Tích tem CP-03.
class Stamp extends Model
{
    protected $fillable = ['customer_id', 'order_id', 'stamped_at'];

    protected $casts = ['stamped_at' => 'datetime'];

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}
