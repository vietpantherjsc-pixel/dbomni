<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Gói 40: Bản ghi lỗi vi phạm của nhân viên (quản lý ghi hoặc NV tự báo).
class Violation extends Model
{
    protected $fillable = [
        'employee_id', 'violation_type_id', 'violation_name', 'points',
        'date', 'note', 'source', 'created_by', 'branch_id',
    ];

    protected $casts = [
        'date' => 'date',
        'points' => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function type(): BelongsTo
    {
        return $this->belongsTo(ViolationType::class, 'violation_type_id');
    }
}
