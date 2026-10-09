<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// Gói 35: Ca làm việc (KHÁC Shift ca thu ngân).
class WorkShift extends Model
{
    protected $guarded = [];

    protected $casts = ['is_active' => 'boolean'];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function registrations(): HasMany
    {
        return $this->hasMany(ShiftRegistration::class);
    }

    public function schedules(): HasMany
    {
        return $this->hasMany(WorkSchedule::class);
    }
}
