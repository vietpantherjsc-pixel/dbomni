<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Gói chặn tự duyệt (2026-11-06, spec-chan-tu-duyet-phieu): người tạo phiếu
 * không được tự duyệt / tự từ chối phiếu của mình. Đặt cạnh ApprovalActor —
 * mỗi controller tự phân giải cặp người tạo theo loại phiếu của mình (mục 4
 * của spec) rồi gọi check() ở đầu method xử lý, sau kiểm trạng thái chờ và
 * trước mọi ghi vết/xử lý. Hub được phủ nhờ ủy quyền lại đúng các method đó.
 */
class SelfApprovalGuard
{
    public const MSG_APPROVE = 'Bạn là người tạo phiếu này nên không thể tự duyệt. Hãy nhờ người khác có quyền duyệt xử lý.';
    public const MSG_REJECT = 'Bạn là người tạo phiếu này nên không thể tự từ chối/hủy. Hãy nhờ người khác có quyền xử lý.';

    /**
     * Trả JsonResponse 422 SELF_APPROVAL_BLOCKED khi người xử lý chính là
     * người tạo phiếu; null khi được xử lý tiếp.
     *
     * "Cùng một người" = khớp TRONG CÙNG LOẠI tác nhân: ApprovalActor::ids()
     * trả đúng 1 phía (User hoặc Employee) nên so chéo User ↔ Employee là
     * không thể xảy ra (User #3 ≠ Employee #3). Cả 2 phía người tạo đều null
     * (không có dữ kiện) → không chặn, không chặn oan (mục 6 của spec).
     *
     * @param object $record phiếu đang xử lý (đọc id + code cho log)
     * @param string $type   transaction | inbound | outbound | transfer | stocktake_adjustment
     * @param string $action approve (duyệt/chốt) | reject (từ chối/hủy)
     */
    public static function check($record, ?int $creatorUserId, ?int $creatorEmployeeId, Request $request, string $type, string $action): ?JsonResponse
    {
        [$actorUserId, $actorEmployeeId] = ApprovalActor::ids($request->user());
        $isSelf = ($actorUserId !== null && $creatorUserId !== null && (int) $actorUserId === (int) $creatorUserId)
            || ($actorEmployeeId !== null && $creatorEmployeeId !== null && (int) $actorEmployeeId === (int) $creatorEmployeeId);
        if (!$isSelf) {
            return null;
        }

        Log::warning('[ChanTuDuyet] Chặn người tạo tự xử lý phiếu của mình', [
            'type' => $type,
            'id' => $record->id ?? null,
            'code' => $record->code ?? null,
            'actor_type' => $actorUserId !== null ? 'user' : 'employee',
            'actor_id' => $actorUserId ?? $actorEmployeeId,
            'action' => $action,
        ]);

        return response()->json([
            'success' => false,
            'code' => 'SELF_APPROVAL_BLOCKED',
            'message' => $action === 'approve' ? self::MSG_APPROVE : self::MSG_REJECT,
        ], 422);
    }
}
