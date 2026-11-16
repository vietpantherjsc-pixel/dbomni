<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Chương trình chỉ số 360 — Đợt 2, N-5: 1 dòng = 1 lần đổi 1 trường cấu
// hình (chỉ ghi khi giá trị thật sự đổi — xem ConfigChangeLogger).
class ConfigChangeLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'family', 'entity_type', 'entity_id', 'label', 'field',
        'old_value', 'new_value', 'changed_by', 'changed_by_type',
        'changed_by_name', 'changed_at',
    ];

    protected $casts = [
        'changed_at' => 'datetime',
    ];
}
