<?php

namespace App\Traits;

use App\Models\Employee;

// Gói 60 (2026-10-15): kiểm tra chi nhánh NV được phép thao tác.
// - NV chỉ được thao tác trên CN chính (branch_id) + các CN trong bảng branch_employee.
// - Không bao giờ tin branch_id từ client nếu không thuộc danh sách cho phép.
trait ValidatesEmployeeBranch
{
    // Danh sách ID các chi nhánh NV được phép thao tác (dùng allBranchIds() có sẵn của model)
    protected function allowedBranchIds(Employee $emp): array
    {
        return $emp->allBranchIds();
    }

    // Resolve branch_id cho NV: ưu tiên branch_id từ request nếu hợp lệ, fallback về CN chính
    protected function resolveEmployeeBranch(Employee $emp, $requestedBranchId = null): int
    {
        $allowed = $this->allowedBranchIds($emp);
        $requested = (int) $requestedBranchId;
        if ($requested > 0 && in_array($requested, $allowed, true)) {
            return $requested;
        }
        return (int) $emp->branch_id;
    }

    // Kiểm tra branch_id có hợp lệ không, trả về lỗi 403 nếu không
    protected function ensureBranchAllowed(Employee $emp, $branchId)
    {
        $allowed = $this->allowedBranchIds($emp);
        if (!in_array((int) $branchId, $allowed, true)) {
            return response()->json([
                'success' => false,
                'message' => 'Bạn không được phân công tại chi nhánh này.',
            ], 403);
        }
        return null;
    }
}
