<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 9 (2026-10-05): 1 dòng món trong đơn nhóm.
// Nhiều người chọn cùng món (cùng tùy chọn) -> gộp 1 dòng, member_names nối tên.
class GroupOrderItem extends Model
{
    protected $guarded = [];

    protected $casts = [
        'member_names' => 'array',
        'option_ids' => 'array',
        'option_names' => 'array',
        'unit_price' => 'decimal:2',
    ];

    public function group(): BelongsTo
    {
        return $this->belongsTo(GroupOrder::class, 'group_order_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    // Ghi chú hiển thị: tên người đặt tự thêm vào ghi chú (Đại Vương chốt)
    public function displayNote(): string
    {
        $names = implode(', ', $this->member_names ?? []);
        $note = trim((string) ($this->note ?? ''));
        if ($note !== '' && $names !== '') {
            return $note . ' (' . $names . ')';
        }
        return $note !== '' ? $note : $names;
    }
}
