<?php

namespace App\Traits;

use App\Models\Employee;

// Gói 60 (2026-10-15): kiểm tra chi nhánh NV được phép thao tác.
// - NV chỉ được thao tác trên CN chính (branch_id) + các CN trong bảng branch_employee.
// - Không bao giờ tin branch_id từ client nếu không thuộc danh sách cho phép.
// Gói riêng A (2026-11-13, Đại Vương phán SIẾT): token cấp qua đường đăng
// nhập có chọn CN mang ability 'branch:{id}' = CN của phiên. Token có CN
// phiên thì CN hiệu lực bị khóa về đúng CN đó (resolve ép về CN phiên ·
// ensure 403 khi branch_id gửi lên lệch), bất kể CN đó còn thuộc phân công
// hay không — CN bị gỡ phân công giữa phiên thì ability bị bỏ qua, rơi về
// cơ chế theo phân công như cũ (PM duyệt thiết kế 2026-11-13). Token không
// mang ability này (Admin · chấm công QR · đăng nhập không chọn CN) giữ
// nguyên hành vi theo phân công.
trait ValidatesEmployeeBranch
{
    // Danh sách ID các chi nhánh NV được phép thao tác (dùng allBranchIds() có sẵn của model)
    protected function allowedBranchIds(Employee $emp): array
    {
        return $emp->allBranchIds();
    }

    // CN của phiên lấy từ token hiện tại (ability 'branch:{id}'); null khi
    // token không mang CN phiên hoặc CN đó không còn thuộc phân công của NV.
    protected function sessionBranchId(Employee $emp): ?int
    {
        $token = request()->user()?->currentAccessToken();
        $abilities = $token?->abilities;
        if (!is_array($abilities)) {
            return null;
        }
        foreach ($abilities as $ability) {
            if (is_string($ability) && str_starts_with($ability, 'branch:')) {
                $bid = (int) substr($ability, 7);
                return in_array($bid, $this->allowedBranchIds($emp), true) ? $bid : null;
            }
        }
        return null;
    }

    // Phạm vi CN hiệu lực của actor: token có CN phiên -> đúng CN đó;
    // không -> toàn bộ CN được phân công. Mọi điểm gác tay theo phân công
    // (deny helper / lọc danh sách / đối chiếu CN của NV đích) dùng hàm này
    // thay allBranchIds() để CN phiên được tôn trọng khắp hệ thống
    // (vá gộp A2 2026-11-13 sau khi TESTER bắt họ kiểm kê gác tay lọt).
    protected function effectiveBranchScope(Employee $emp): array
    {
        $session = $this->sessionBranchId($emp);

        return $session !== null ? [$session] : $this->allowedBranchIds($emp);
    }

    // Chặn cứng: token có CN phiên mà branch_id gửi lên khác CN phiên -> 403.
    protected function enforceSessionBranch(Employee $emp, $requestedBranchId): void
    {
        $session = $this->sessionBranchId($emp);
        if ($session !== null && (int) $requestedBranchId > 0 && (int) $requestedBranchId !== $session) {
            abort(403, 'Chi nhánh không khớp với chi nhánh của phiên đăng nhập. Vui lòng đăng nhập lại và chọn đúng chi nhánh.');
        }
    }

    // Resolve branch_id cho NV: token có CN phiên thì khóa về CN phiên;
    // không thì ưu tiên branch_id từ request nếu hợp lệ, fallback về CN chính
    protected function resolveEmployeeBranch(Employee $emp, $requestedBranchId = null): int
    {
        $session = $this->sessionBranchId($emp);
        if ($session !== null) {
            return $session;
        }
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
        // Gói A: lệch CN phiên -> 403 ngay (abort), trước kiểm phân công.
        $this->enforceSessionBranch($emp, $branchId);
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
