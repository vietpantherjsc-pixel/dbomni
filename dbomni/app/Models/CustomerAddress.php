<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 49: địa chỉ giao hàng đã lưu của khách.
class CustomerAddress extends Model
{
    // Gói SEC2: fillable显式 — KHÔNG gồm 'phone' (chỉ dùng để xác thực, không phải cột DB)
    protected $fillable = [
        'customer_id', 'label', 'province', 'ward', 'street', 'is_default',
    ];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function fullAddress(): string
    {
        return collect([$this->street, $this->ward, $this->province])->filter()->join(', ');
    }
}
