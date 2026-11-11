<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

// Spec P4-B1 (Đại Vương chốt 2026-10-19): chốt + khóa kỳ lương theo tháng.
// Khóa rồi thì không sửa giờ công/mức lương/thưởng/trừ/BHXH/lỗi/ngày lễ của kỳ đó.
//
// Cây phân quyền 3 tầng (spec đã khóa 10/11/2026 §3.8): đơn vị chốt là
// (kỳ × CN) — payroll_locks.branch_id (migration 000105). Dòng cũ
// branch_id NULL = khóa toàn hệ đời trước, đọc như mọi CN đã chốt.
class PayrollLock extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    protected $fillable = ['month', 'branch_id', 'locked_at', 'locked_by', 'net_total', 'voucher_id'];

    protected $casts = [
        'locked_at' => 'datetime',
        'net_total' => 'float',
        'branch_id' => 'integer',
    ];

    public function voucher()
    {
        return $this->belongsTo(Transaction::class, 'voucher_id');
    }

    public function branch()
    {
        return $this->belongsTo(Branch::class);
    }

    /** Mọi khóa của 1 kỳ (khóa toàn hệ đời trước + các khóa theo CN). */
    public static function forMonth(string $month)
    {
        if (!Schema::hasTable('payroll_locks')) return collect();
        return static::where('month', $month)->orderBy('branch_id')->get();
    }

    /** Khóa toàn hệ đời trước (branch_id NULL) của 1 kỳ, nếu có. */
    public static function legacy(string $month): ?self
    {
        if (!Schema::hasTable('payroll_locks')) return null;
        return static::where('month', $month)->whereNull('branch_id')->first();
    }

    /**
     * Lấy khóa áp cho 1 CN: khóa riêng của CN đó, nếu không có thì khóa toàn
     * hệ đời trước. $branchId null = chỉ lấy khóa toàn hệ (dùng cho đường
     * đọc snapshot chi tiết — snapshot detail chỉ tồn tại ở khóa toàn hệ).
     */
    public static function get(string $month, ?int $branchId = null): ?self
    {
        if (!Schema::hasTable('payroll_locks')) return null;
        if ($branchId !== null) {
            return static::where('month', $month)->where('branch_id', $branchId)->first()
                ?? static::legacy($month);
        }
        return static::legacy($month);
    }

    /** Kỳ đã chốt chưa: $branchId null = bất kỳ khóa nào; có CN = khóa CN đó hoặc khóa toàn hệ. */
    public static function isLocked(string $month, ?int $branchId = null): bool
    {
        if (!Schema::hasTable('payroll_locks')) return false;
        if ($branchId !== null) return static::isBranchLocked($month, $branchId);
        return static::where('month', $month)->exists();
    }

    /** CN này đã chốt chưa (khóa riêng CN hoặc khóa toàn hệ đời trước). */
    public static function isBranchLocked(string $month, int $branchId): bool
    {
        if (!Schema::hasTable('payroll_locks')) return false;
        return static::where('month', $month)
            ->where(fn ($q) => $q->where('branch_id', $branchId)->orWhereNull('branch_id'))
            ->exists();
    }

    /** Các CN đã chốt trong kỳ (branch_id; khóa toàn hệ trả về null trong danh sách). */
    public static function lockedBranchIds(string $month): array
    {
        if (!Schema::hasTable('payroll_locks')) return [];
        if (static::legacy($month)) return [null];
        return static::where('month', $month)->whereNotNull('branch_id')
            ->pluck('branch_id')->map(fn ($v) => (int) $v)->all();
    }

    // Chặn sửa khi kỳ đã chốt — ném 422 với thông báo tiếng Việt.
    // $branchId null = chặn khi BẤT KỲ khóa nào của kỳ tồn tại (dùng cho dữ
    // kiện toàn hệ: ngày lễ, chính sách); có CN = chỉ chặn khi CN đó đã chốt.
    public static function assertUnlocked(string $month, ?int $branchId = null): void
    {
        if (static::isLocked($month, $branchId)) {
            $scope = $branchId !== null ? "chi nhánh #{$branchId}" : 'kỳ';
            abort(422, "Kỳ lương {$month} đã chốt" . ($branchId !== null ? " tại {$scope}" : '') . ", không thể sửa. Mở khóa trước khi thay đổi.");
        }
    }

    /** Chặn sửa dữ kiện thuộc 1 CN đã chốt (ngày công của CN đó — §3.8). */
    public static function assertBranchUnlocked(string $month, int $branchId): void
    {
        static::assertUnlocked($month, $branchId);
    }

    // Mức lương có hiệu lực [start_date, end_date] — chặn nếu giao với bất kỳ kỳ đã chốt nào.
    // $branchId có giá trị = chỉ xét khóa của CN đó + khóa toàn hệ (mức lương
    // theo NV chỉ đóng băng khi CN chính của NV đã chốt — §3.8).
    public static function assertLevelUnlocked(string $startDate, ?string $endDate, ?int $branchId = null): void
    {
        if (!Schema::hasTable('payroll_locks')) return;
        $end = $endDate ?: '9999-12-31';
        $startMonth = substr($startDate, 0, 7);
        $endMonth = substr($end, 0, 7);
        $q = static::where('month', '>=', $startMonth)->where('month', '<=', $endMonth);
        if ($branchId !== null) {
            $q->where(fn ($w) => $w->where('branch_id', $branchId)->orWhereNull('branch_id'));
        }
        if ($q->exists()) {
            abort(422, 'Mức lương này ảnh hưởng kỳ lương đã chốt, không thể sửa. Mở khóa kỳ liên quan trước.');
        }
    }

    public static function log(string $month, string $action, $userId, ?string $reason = null, ?int $branchId = null): void
    {
        if (!Schema::hasTable('payroll_lock_logs')) return;
        $row = [
            'month' => $month,
            'action' => $action,
            'user_id' => $userId,
            'reason' => $reason,
        ];
        if (Schema::hasColumn('payroll_lock_logs', 'branch_id')) {
            $row['branch_id'] = $branchId;
        }
        PayrollLockLog::create($row);
    }
}
