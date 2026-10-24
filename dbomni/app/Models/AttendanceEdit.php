<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// Audit 2026-10-23 A3-7: vết sửa giờ chấm công — mỗi lần admin sửa giờ vào/ra
// của 1 bản ghi chấm công đều để lại 1 dòng (ai sửa, giờ cũ -> giờ mới, lý do).
class AttendanceEdit extends Model
{
    protected $guarded = [];

    protected $casts = [
        'old_check_in' => 'datetime',
        'new_check_in' => 'datetime',
        'old_check_out' => 'datetime',
        'new_check_out' => 'datetime',
    ];

    public function attendance(): BelongsTo
    {
        return $this->belongsTo(Attendance::class);
    }

    public function editorUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'editor_user_id');
    }

    public function editorEmployee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'editor_employee_id');
    }
}
