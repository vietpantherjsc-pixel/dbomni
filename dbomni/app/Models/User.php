<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, HasRoles;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        // Cây phân quyền 3 tầng (spec đã khóa 10/11/2026 §2.0/§2.0A):
        // account_tier 'owner' = Chủ Sở Hữu (mặc định, toàn quyền) ·
        // 'branch_owner' = Chủ Chi Nhánh (đúng 1 CN ở owner_branch_id).
        'account_tier',
        'owner_branch_id',
        'employee_id',
        'must_change_password',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
        'must_change_password' => 'boolean',
    ];

    public const TIER_OWNER = 'owner';
    public const TIER_BRANCH_OWNER = 'branch_owner';

    /** Tầng Chủ Sở Hữu = loại tài khoản quản trị viên hiện nay (§2.0 mô hình (a)). */
    public function isOwner(): bool
    {
        return ($this->account_tier ?? self::TIER_OWNER) === self::TIER_OWNER;
    }

    /** Tầng Chủ Chi Nhánh (§2.0A): đúng 1 CN gắn cứng. */
    public function isBranchOwner(): bool
    {
        return ($this->account_tier ?? self::TIER_OWNER) === self::TIER_BRANCH_OWNER;
    }

    /** Tên hiển thị của tầng (trang phân quyền §2.0). */
    public function tierLabel(): string
    {
        return $this->isBranchOwner() ? 'Chủ Chi Nhánh' : 'Chủ Sở Hữu';
    }

    public function ownerBranch(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Branch::class, 'owner_branch_id');
    }

    public function linkedEmployee(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }
}