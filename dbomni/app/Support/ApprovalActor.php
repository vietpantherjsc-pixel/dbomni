<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\User;

// Gói "Chờ duyệt trên Hub" (2026-10-21): xác định người thực hiện hành động duyệt/từ chối
// để ghi vết đúng cột (User → cột user, Employee → cột *_employee_id).
// EmployeeApprovalController set() actor là Employee trước khi gọi lại method duyệt hiện có;
// các method đó gọi ApprovalActor::ids() tại điểm ghi vết — luồng Admin (không set) giữ nguyên hành vi cũ.
class ApprovalActor
{
    protected static ?object $override = null;

    public static function set(object $actor): void
    {
        static::$override = $actor;
    }

    public static function clear(): void
    {
        static::$override = null;
    }

    /** Trả về [userId, employeeId] — đúng 1 trong 2 có giá trị (hoặc cả 2 null). */
    public static function ids($requestUser = null): array
    {
        $a = static::$override ?? $requestUser;
        return [
            $a instanceof User ? $a->id : null,
            $a instanceof Employee ? $a->id : null,
        ];
    }
}
