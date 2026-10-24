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
    // Spec danh mục dùng chung: so sánh sau khi chuẩn hóa mã kênh (pos/zalo cũ <-> nha_hang/online)
    public function forChannel(string $channel): bool
    {
        if (!$this->is_active) return false;
        $ch = $this->channels;
        if (empty($ch)) return true;
        $want = PriceList::normalizeChannelCode($channel);
        foreach ((array) $ch as $c) {
            if (PriceList::normalizeChannelCode((string) $c) === $want) return true;
        }
        return false;
    }
}
