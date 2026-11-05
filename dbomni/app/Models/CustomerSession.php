<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Spec đăng nhập SĐT + mật khẩu §2–§3: phiên đăng nhập hợp nhất cho cả hai
// đường (Zalo + mật khẩu). Server CHỈ lưu bản băm SHA-256 của token;
// token gốc chỉ trả một lần trong response phát hành.
class CustomerSession extends Model
{
    protected $fillable = [
        'customer_id', 'token_hash', 'auth_method', 'device_label',
        'ip_address', 'user_agent', 'last_used_at', 'expires_at', 'revoked_at',
    ];

    protected $casts = [
        'last_used_at' => 'datetime',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function isUsable(): bool
    {
        return $this->revoked_at === null && $this->expires_at !== null
            && $this->expires_at->isFuture();
    }
}
