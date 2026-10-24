<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Cầu nối Sapo (2026-10-21): 1 hóa đơn Sapo chưa import được → hàng đợi "nghi ngờ".
// payload giữ toàn bộ dòng đã parse để Phần D chạy lại sau khi quản lý map/xác nhận.
class SapoImportSuspect extends Model
{
    protected $guarded = [];

    protected $casts = [
        'payload' => 'array',
        'resolved_at' => 'datetime',
    ];

    public function run(): BelongsTo
    {
        return $this->belongsTo(SapoImportRun::class, 'run_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function resolvedOrder(): BelongsTo
    {
        return $this->belongsTo(Order::class, 'resolved_order_id');
    }

    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
