<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói "PNL kênh sàn đầy đủ" (2026-10-31): 1 dòng phí marketing sàn theo
// (kênh × chi nhánh × tháng) — số sàn chốt gửi ngày đầu tháng sau, nhập tay.
class ChannelMonthlyAdjustment extends Model
{
    protected $table = 'channel_monthly_adjustments';

    protected $guarded = [];

    protected $casts = [
        'month' => 'date',
        'marketing_fee' => 'decimal:2',
        'voided_at' => 'datetime',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
