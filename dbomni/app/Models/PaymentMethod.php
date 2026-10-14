<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 52: phương thức thanh toán (tên + loại + kênh áp dụng)
class PaymentMethod extends Model
{
    // Gói SEC2: fillable显式 thay vì $guarded = []
    protected $fillable = [
        'name', 'type', 'channels', 'is_active', 'sort_order',
    ];

    protected $casts = [
        'channels' => 'array',
        'is_active' => 'boolean',
    ];

    // Kiểm tra PTTT có bật cho kênh không (channels null = tất cả)
    public function forChannel(string $channel): bool
    {
        if (!$this->is_active) return false;
        $ch = $this->channels;
        if (empty($ch)) return true;
        return in_array($channel, $ch);
    }
}
