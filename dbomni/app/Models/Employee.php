<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

// Gói 26: Nhân viên — đăng nhập admin bằng username/password, chấm công + POS/KDS bằng PIN 6 số.
class Employee extends Authenticatable
{
    use HasApiTokens;

    protected $fillable = [
        'full_name', 'dob', 'start_date', 'phone', 'email', 'education', 'qualification',
        'username', 'password', 'pin_code', 'role_id', 'branch_id', 'is_active', 'avatar',
        'apply_responsibility',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected $casts = [
        'dob' => 'date',
        'start_date' => 'date',
        'is_active' => 'boolean',
        'apply_responsibility' => 'boolean',
        'password' => 'hashed',
    ];

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    // Gói 26c: các chi nhánh nhân viên làm việc (pivot, luôn gồm chi nhánh chính)
    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(Branch::class, 'branch_employee')->withTimestamps();
    }

    // Tất cả chi nhánh NV thuộc về: pivot + chi nhánh chính, unique int
    public function allBranchIds(): array
    {
        $ids = $this->branches()->pluck('branches.id')->all();
        if ($this->branch_id) $ids[] = (int) $this->branch_id;
        return array_values(array_unique(array_map('intval', $ids)));
    }

    public function wageLevels(): HasMany
    {
        return $this->hasMany(WageLevel::class)->orderBy('start_date', 'desc');
    }

    public function salaryAdvances(): HasMany
    {
        return $this->hasMany(SalaryAdvance::class);
    }

    public function bonuses(): HasMany
    {
        return $this->hasMany(Bonus::class);
    }

    public function insurance(): HasOne
    {
        return $this->hasOne(EmployeeInsurance::class);
    }

    // Mức lương đang áp dụng tại 1 ngày
    public function wageAt(string $date): ?WageLevel
    {
        return $this->wageLevels()
            ->where('start_date', '<=', $date)
            ->where(fn ($q) => $q->whereNull('end_date')->orWhere('end_date', '>=', $date))
            ->orderBy('start_date', 'desc')
            ->first();
    }
}
