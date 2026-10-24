<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Cầu nối Sapo — Phần C (2026-10-21): nhật ký 1 mail Sapo đã xử lý / 1 cảnh báo vận hành.
class SapoMailLog extends Model
{
    protected $guarded = [];

    protected $casts = [
        'received_at' => 'datetime',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(SapoImportRun::class, 'run_id');
    }
}
