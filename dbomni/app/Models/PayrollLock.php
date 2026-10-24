<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

// Spec P4-B1 (Đại Vương chốt 2026-10-19): chốt + khóa kỳ lương theo tháng.
// Khóa rồi thì không sửa giờ công/mức lương/thưởng/trừ/BHXH/lỗi/ngày lễ của kỳ đó.
class PayrollLock extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    protected $fillable = ['month', 'locked_at', 'locked_by', 'net_total', 'voucher_id'];

    protected $casts = [
        'locked_at' => 'datetime',
        'net_total' => 'float',
    ];

    public function voucher()
    {
        return $this->belongsTo(Transaction::class, 'voucher_id');
    }

    public static function isLocked(string $month): bool
    {
        if (!Schema::hasTable('payroll_locks')) return false;
        return static::where('month', $month)->exists();
    }

    public static function get(string $month): ?self
    {
        if (!Schema::hasTable('payroll_locks')) return null;
        return static::where('month', $month)->first();
    }

    // Chặn sửa khi kỳ đã chốt — ném 422 với thông báo tiếng Việt
    public static function assertUnlocked(string $month): void
    {
        if (static::isLocked($month)) {
            abort(422, "Kỳ lương {$month} đã chốt, không thể sửa. Mở khóa trước khi thay đổi.");
        }
    }

    // Mức lương có hiệu lực [start_date, end_date] — chặn nếu giao với bất kỳ kỳ đã chốt nào
    public static function assertLevelUnlocked(string $startDate, ?string $endDate): void
    {
        if (!Schema::hasTable('payroll_locks')) return;
        $end = $endDate ?: '9999-12-31';
        $startMonth = substr($startDate, 0, 7);
        $endMonth = substr($end, 0, 7);
        $locked = static::where('month', '>=', $startMonth)->where('month', '<=', $endMonth)->exists();
        if ($locked) {
            abort(422, 'Mức lương này ảnh hưởng kỳ lương đã chốt, không thể sửa. Mở khóa kỳ liên quan trước.');
        }
    }

    public static function log(string $month, string $action, $userId, ?string $reason = null): void
    {
        if (!Schema::hasTable('payroll_lock_logs')) return;
        PayrollLockLog::create([
            'month' => $month,
            'action' => $action,
            'user_id' => $userId,
            'reason' => $reason,
        ]);
    }
}
