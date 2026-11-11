<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AccountAuditLog;
use App\Models\Branch;
use App\Models\User;
use App\Support\ApprovalActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

// Cây phân quyền chi tiết §2.0/§2.0A (khóa 10/11/2026) — quản lý tài khoản
// quản trị (2 tầng: Chủ Sở Hữu · Chủ Chi Nhánh). CHỈ Chủ Sở Hữu được gọi
// (gác ở route permission:staff.roles.edit + kiểm lại trong controller).
// - Tạo mới hoặc chọn từ NV hiện có (employee_id): hồ sơ NV giữ nguyên
//   song song, tài khoản quản trị là User riêng.
// - Mật khẩu tạm sinh ngẫu nhiên, hiện đúng 1 lần + buộc đổi ở lần đăng
//   nhập đầu (khuôn #102).
// - Thu hồi = xóa User + thu hồi toàn bộ token ngay (kể cả phiên đang sống).
// - Rào §2.0 #5: chặn thu hồi Owner cuối cùng, kèm lý do bắt buộc.
class AdminAccountController extends Controller
{
    private function requireOwner(Request $request): ?JsonResponse
    {
        $actor = $request->user();
        if (!($actor instanceof User && $actor->isOwner())) {
            return response()->json(['success' => false, 'message' => 'Chỉ Chủ Sở Hữu quản lý được tài khoản quản trị.'], 403);
        }
        return null;
    }

    private function audit(Request $request, string $action, ?int $targetUserId, ?string $targetEmail, ?string $detail): void
    {
        if (!Schema::hasTable('account_audit_logs')) return;
        [$actorUserId] = ApprovalActor::ids($request->user());
        AccountAuditLog::create([
            'actor_user_id' => $actorUserId,
            'target_user_id' => $targetUserId,
            'target_email' => $targetEmail,
            'action' => $action,
            // §EW 🟡: cột detail chỉ 500 ký tự — cắt ngắn ở điểm ghi (lý do
            // thu hồi tối đa 500 ký tự + tiền tố sẽ vượt nếu không cắt).
            'detail' => $detail !== null ? mb_substr($detail, 0, 500) : null,
            'created_at' => now(),
        ]);
    }

    private function serialize(User $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'email' => $u->email,
            'account_tier' => $u->account_tier,
            'tier_label' => $u->tierLabel(),
            'owner_branch_id' => $u->owner_branch_id,
            'owner_branch_name' => $u->ownerBranch?->name,
            'employee_id' => $u->employee_id,
            'employee_name' => $u->linkedEmployee?->full_name,
            'must_change_password' => (bool) $u->must_change_password,
            'created_at' => $u->created_at?->format('d/m/Y H:i'),
        ];
    }

    // GET /api/admin-accounts — liệt kê tài khoản quản trị (cả 2 tầng).
    public function index(Request $request): JsonResponse
    {
        if ($deny = $this->requireOwner($request)) return $deny;
        $users = User::with(['ownerBranch:id,name', 'linkedEmployee:id,full_name'])
            ->orderBy('id')->get();
        return response()->json(['success' => true, 'data' => $users->map(fn ($u) => $this->serialize($u))->values()]);
    }

    // Gói #102 mục 1.1: sinh mật khẩu tạm 8 ký tự chữ + số, bỏ ký tự dễ
    // nhầm (0/O/1/l/I) — đồng bộ với EmployeeController::generateTempPassword.
    protected function generateTempPassword(): string
    {
        $letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
        $digits = '23456789';
        $all = $letters . $digits;
        do {
            $pw = '';
            $max = strlen($all) - 1;
            for ($i = 0; $i < 8; $i++) {
                $pw .= $all[random_int(0, $max)];
            }
        } while (!preg_match('/[A-Za-z]/', $pw) || !preg_match('/[0-9]/', $pw));
        return $pw;
    }

    // POST /api/admin-accounts — Chủ Sở Hữu tạo tài khoản tầng mới.
    // Xác nhận bước lên bằng mật khẩu của Owner hiện tại (§2.0 #5).
    public function store(Request $request): JsonResponse
    {
        if ($deny = $this->requireOwner($request)) return $deny;
        $v = $request->validate([
            'name' => 'required|string|max:150',
            'email' => 'required|email|max:150|unique:users,email',
            'account_tier' => ['required', Rule::in([User::TIER_OWNER, User::TIER_BRANCH_OWNER])],
            'owner_branch_id' => 'nullable|integer|exists:branches,id',
            'employee_id' => 'nullable|integer|exists:employees,id',
            'current_password' => 'required|string',
        ]);
        $actor = $request->user();
        if (!Hash::check($v['current_password'], $actor->password)) {
            return response()->json(['success' => false, 'message' => 'Mật khẩu xác nhận không đúng.'], 422);
        }
        if ($v['account_tier'] === User::TIER_BRANCH_OWNER && empty($v['owner_branch_id'])) {
            return response()->json(['success' => false, 'message' => 'Chủ Chi Nhánh phải gắn đúng 1 chi nhánh.'], 422);
        }
        // §EW 🟡: 1 NV chỉ gắn với tối đa 1 tài khoản quản trị (tránh 2
        // tài khoản cùng trỏ 1 người, khó truy vết ai thao tác).
        if (!empty($v['employee_id']) && User::where('employee_id', $v['employee_id'])->exists()) {
            return response()->json(['success' => false, 'message' => 'Nhân viên này đã gắn với 1 tài khoản quản trị khác.'], 422);
        }
        if ($v['account_tier'] === User::TIER_OWNER) {
            $v['owner_branch_id'] = null;
        }
        $plain = $this->generateTempPassword();
        $user = User::create([
            'name' => $v['name'],
            'email' => $v['email'],
            'password' => $plain, // cast 'hashed' tự hash khi create
            'account_tier' => $v['account_tier'],
            'owner_branch_id' => $v['owner_branch_id'] ?? null,
            'employee_id' => $v['employee_id'] ?? null,
            'must_change_password' => true,
        ]);
        $branchName = $user->owner_branch_id ? (Branch::where('id', $user->owner_branch_id)->value('name') ?? ('CN #' . $user->owner_branch_id)) : null;
        $this->audit(
            $request,
            $user->account_tier === User::TIER_OWNER ? 'owner_created' : 'branch_owner_created',
            $user->id,
            $user->email,
            'Tạo tài khoản ' . $user->tierLabel() . ($branchName ? ' — ' . $branchName : '')
        );
        return response()->json([
            'success' => true,
            'data' => $this->serialize($user->fresh()),
            'password_plain' => $plain, // mật khẩu tạm — plaintext 1 lần duy nhất để quản lý trao tay
        ], 201);
    }

    // DELETE /api/admin-accounts/{id} — thu hồi tài khoản (xóa + thu hồi
    // toàn bộ token ngay). Lý do + mật khẩu xác nhận bắt buộc; chặn thu
    // hồi Chủ Sở Hữu cuối cùng (§2.0 #5).
    public function destroy(Request $request, int $id): JsonResponse
    {
        if ($deny = $this->requireOwner($request)) return $deny;
        $target = User::findOrFail($id);
        $v = $request->validate([
            'reason' => 'required|string|max:500',
            'current_password' => 'required|string',
        ]);
        if ($target->isOwner() && User::where('account_tier', User::TIER_OWNER)->count() <= 1) {
            return response()->json(['success' => false, 'message' => 'Không thể thu hồi Chủ Sở Hữu cuối cùng — cần ít nhất 1 Chủ Sở Hữu.'], 422);
        }
        $actor = $request->user();
        if (!Hash::check($v['current_password'], $actor->password)) {
            return response()->json(['success' => false, 'message' => 'Mật khẩu xác nhận không đúng.'], 422);
        }
        $wasOwner = $target->isOwner();
        $email = $target->email;
        $label = $target->tierLabel();
        $target->tokens()->delete();
        $target->delete();
        $this->audit(
            $request,
            $wasOwner ? 'owner_revoked' : 'branch_owner_revoked',
            null,
            $email,
            'Thu hồi tài khoản ' . $label . ' (' . $email . ') — Lý do: ' . $v['reason']
        );
        return response()->json(['success' => true, 'message' => 'Đã thu hồi tài khoản.']);
    }

    // GET /api/account-audit-logs — nhật ký thêm/thu hồi tài khoản (chỉ Owner).
    public function auditLogs(Request $request): JsonResponse
    {
        if ($deny = $this->requireOwner($request)) return $deny;
        $page = AccountAuditLog::with(['actorUser:id,name', 'targetUser:id,name,email'])
            ->orderByDesc('id')
            ->paginate(min($request->integer('per_page', 50), 200));
        return response()->json(['success' => true, 'data' => $page]);
    }
}
