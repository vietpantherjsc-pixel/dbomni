<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Cầu nối Sapo (2026-10-21): nhật ký 1 lần import (file upload tay hoặc job IMAP).
// Số liệu phân loại: tạo mới / trùng / kênh DBOMNI / đã hủy / nghi ngờ — Phần D hiển thị.
class SapoImportRun extends Model
{
    protected $guarded = [];

    protected $casts = [
        'warnings' => 'array',
    ];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function suspects(): HasMany
    {
        return $this->hasMany(SapoImportSuspect::class, 'run_id');
    }
}
