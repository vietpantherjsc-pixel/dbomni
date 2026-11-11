<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\SalaryAuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

// Phạm vi lương theo tầng tài khoản (spec đã khóa 10/11/2026 §3.3):
// - Chủ Sở Hữu: toàn hệ.
// - Chủ Chi Nhánh: đúng 1 CN gắn với tài khoản — NV có phân công giao với
//   CN đó mới thấy được (NV làm 2 CN thì thấy tổng gộp — giới hạn đã ghi).
// - Tài khoản nhân viên theo chức vụ: KHÔNG chạm lương (đã chặn ở
//   CheckPermission + guardPermissions; đây là lớp phòng thủ trong controller).
class SalaryScope
{
    public const TIER_OWNER = 'owner';
    public const TIER_BRANCH_OWNER = 'branch_owner';
    public const TIER_EMPLOYEE = 'employee';

    public static function tier($actor): string
    {
        if ($actor instanceof User) {
            return $actor->isBranchOwner() ? self::TIER_BRANCH_OWNER : self::TIER_OWNER;
        }
        return self::TIER_EMPLOYEE;
    }

    /** CN bắt buộc của actor: null = toàn hệ (Chủ Sở Hữu), int = CN của Chủ Chi Nhánh. */
    public static function scopeBranchId($actor): ?int
    {
        if ($actor instanceof User && $actor->isBranchOwner()) {
            return (int) $actor->owner_branch_id;
        }
        return null;
    }

    /**
     * Chủ Chi Nhánh có thấy được NV này không (phân công giao với CN mình).
     * Ngoài phạm vi → 404 (không lộ sự tồn tại — cùng luật cách ly CN §3.2).
     */
    public static function assertEmployeeVisible(Request $request, Employee $emp): void
    {
        $actor = $request->user();
        if ($actor instanceof User && $actor->isBranchOwner()) {
            $bid = (int) $actor->owner_branch_id;
            if (!in_array($bid, $emp->allBranchIds(), true)) {
                abort(404, 'Nhân viên không thuộc chi nhánh của bạn.');
            }
        }
    }

    /** Lớp phòng thủ: actor Employee không bao giờ được vào đường lương. */
    public static function assertNotEmployee(Request $request): void
    {
        if ($request->user() instanceof Employee) {
            abort(403, 'Chức vụ nhân viên không được chạm vào lương.');
        }
    }

    /**
     * Ép branch_id yêu cầu về phạm vi của actor (Chủ Chi Nhánh: luôn CN mình,
     * tham số khác bị bỏ qua; Chủ Sở Hữu: giữ nguyên tham số).
     */
    public static function resolveBranchId(Request $request, ?int $requested): ?int
    {
        $scope = self::scopeBranchId($request->user());
        return $scope ?? $requested;
    }

    /** Ghi 1 dòng nhật ký lương (mức B — chỉ hành động làm thay đổi). */
    public static function log(Request $request, string $action, ?int $employeeId, ?string $month, ?string $detail = null): void
    {
        if (!Schema::hasTable('salary_audit_logs')) return;
        $actor = $request->user();
        SalaryAuditLog::create([
            'actor_user_id' => $actor instanceof User ? $actor->id : null,
            'actor_employee_id' => $actor instanceof Employee ? $actor->id : null,
            'actor_tier' => self::tier($actor),
            'actor_branch_id' => $actor instanceof User && $actor->isBranchOwner()
                ? (int) $actor->owner_branch_id : null,
            'employee_id' => $employeeId,
            'action' => $action,
            'month' => $month,
            // §EW 🟡: cột detail chỉ 500 ký tự — cắt ngắn ở điểm ghi để tên
            // dài không gây 500 sau khi thao tác đã xong.
            'detail' => $detail !== null ? mb_substr($detail, 0, 500) : null,
        ]);
    }
}
