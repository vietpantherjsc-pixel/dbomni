<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Support\ApprovalActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

// Gói 26: CRUD nhân viên (10 trường + PIN 6 số + chức vụ + chi nhánh).
class EmployeeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Employee::with(['role:id,name', 'branch:id,name', 'branches:id,name'])
            ->orderBy('full_name');

        // §3.2: actor Employee chỉ thấy NV có tập CN giao với mình (CN chính
        // hoặc pivot). Chọn CN ngoài phạm vi -> danh sách rỗng, không 404.
        $mine = $this->actorBranchIds($request);
        if ($mine !== null) {
            if ($request->filled('branch_id') && !in_array($request->integer('branch_id'), $mine, true)) {
                $q->whereRaw('1 = 0');
            } else {
                $q = $this->scopeToActorBranches($q, $mine);
            }
        }

        // Gói 26c: NV thuộc CN nếu branch_id chính = CN đó HOẶC có trong pivot branch_employee
        if ($request->filled('branch_id')) {
            $bid = $request->integer('branch_id');
            $q->where(fn ($w) => $w->where('branch_id', $bid)
                ->orWhereHas('branches', fn ($b) => $b->where('branches.id', $bid)));
        }
        if ($request->filled('role_id')) $q->where('role_id', $request->integer('role_id'));
        if ($request->filled('is_active')) $q->where('is_active', $request->boolean('is_active'));
        // Gói #102 mục 5.1: lọc nhóm "Chưa có mật khẩu" để quản lý xử lý dần
        if ($request->filled('no_password') && $request->boolean('no_password')) $q->whereNull('password');
        if ($request->filled('search')) {
            $s = '%' . $request->string('search') . '%';
            $q->where(fn ($w) => $w->where('full_name', 'like', $s)
                ->orWhere('phone', 'like', $s)
                ->orWhere('username', 'like', $s));
        }

        $page = $q->paginate(min($request->integer('per_page', 20), 200)); // Gói 38: per_page tối đa 200
        // Gói #102: gắn cờ trạng thái mật khẩu (hash vẫn ẩn theo $hidden của model)
        $page->getCollection()->transform(function ($emp) {
            $emp->setAttribute('has_password', !empty($emp->password));
            return $emp;
        });
        return response()->json(['success' => true, 'data' => $page]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $emp = Employee::with(['role:id,name', 'branch:id,name', 'branches:id,name'])->findOrFail($id);
        if ($deny = $this->assertTargetVisible($request, $emp)) return $deny;
        $emp->setAttribute('has_password', !empty($emp->password)); // Gói #102
        return response()->json(['success' => true, 'data' => $emp]);
    }

    protected function rules(?int $ignoreId = null): array
    {
        return [
            'full_name' => 'required|string|max:150',
            'dob' => 'nullable|date',
            'start_date' => 'required|date',
            'phone' => ['required', 'string', 'max:20', Rule::unique('employees', 'phone')->ignore($ignoreId)],
            'email' => 'nullable|email|max:150',
            'education' => 'nullable|string|max:150',
            'qualification' => 'nullable|string|max:150',
            'username' => ['nullable', 'string', 'max:100', Rule::unique('employees', 'username')->ignore($ignoreId)],
            // Gói #102 mục 4.2: chuẩn mật khẩu khi ĐẶT mới là min:8 / max:72
            // (nâng từ min:6) — áp cho đường gõ tay còn lại (sửa NV). Mật
            // khẩu cũ 6–7 ký tự đã đặt từ trước vẫn đăng nhập bình thường.
            'password' => 'nullable|string|min:8|max:72',
            // Gói 38: PIN lưu hash bcrypt — bỏ Rule::unique (DB không check được), check trùng bằng Hash::check ở store/update
            'pin_code' => ['nullable', 'string', 'size:6', 'regex:/^[0-9]{6}$/'],
            'role_id' => 'nullable|exists:job_roles,id',
            'branch_id' => 'required|exists:branches,id',
            // Gói 26c: các chi nhánh làm việc thêm (ngoài chi nhánh chính) — sync vào pivot
            'branch_ids' => 'nullable|array',
            'branch_ids.*' => 'integer|exists:branches,id',
            'is_active' => 'nullable|boolean',
            'apply_responsibility' => 'nullable|boolean',
            'avatar' => 'nullable|string|max:255',
        ];
    }

    // §3.2 — phân vùng Nhân sự cho actor Employee: tập CN của actor
    // (CN chính + pivot). Actor User (quản trị) không bị giới hạn ở đây
    // (tầng Chủ Chi Nhánh đã bị chặn ở middleware vì staff.* không nằm
    // trong 7 lá lương của tầng đó).
    protected function actorBranchIds(Request $request): ?array
    {
        $actor = $request->user();
        return $actor instanceof Employee ? $actor->allBranchIds() : null;
    }

    protected function scopeToActorBranches($q, array $mine)
    {
        return $q->where(fn ($w) => $w->whereIn('branch_id', $mine)
            ->orWhereHas('branches', fn ($b) => $b->whereIn('branches.id', $mine)));
    }

    protected function assertTargetVisible(Request $request, Employee $target): ?JsonResponse
    {
        $mine = $this->actorBranchIds($request);
        if ($mine === null) return null;
        if (empty(array_intersect($mine, $target->allBranchIds()))) {
            return response()->json(['success' => false, 'message' => 'Nhân viên không thuộc phạm vi chi nhánh của bạn.'], 404);
        }
        return null;
    }

    protected function assertBranchesInScope(Request $request, array $branchIds): ?JsonResponse
    {
        $mine = $this->actorBranchIds($request);
        if ($mine === null) return null;
        foreach ($branchIds as $bid) {
            if (!in_array((int) $bid, $mine, true)) {
                return response()->json(['success' => false, 'message' => 'Chi nhánh không thuộc phạm vi của bạn.'], 403);
            }
        }
        return null;
    }

    // Audit 2026-10-23 B-1: Employee thao tác không được vượt quyền của chính mình:
    // - gán role có khóa quyền ngoài tập quyền của actor -> 403
    // - reset PIN/mật khẩu của NV thuộc role mạnh hơn actor -> 403
    // (User admin: không giới hạn.)
    protected function guardRoleAssignment(Request $request, $roleId): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor instanceof Employee || empty($roleId)) return null;
        $role = \App\Models\Role::find((int) $roleId);
        if (!$role) return null;
        $actorRole = $actor->role;
        foreach (($role->permissions ?? []) as $perm) {
            if (!$actorRole || !$actorRole->hasPermission($perm)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Bạn không thể gán chức vụ có quyền vượt quá quyền của mình.',
                ], 403);
            }
        }
        return null;
    }

    protected function guardResetTarget(Request $request, Employee $target): ?JsonResponse
    {
        $actor = $request->user();
        if (!$actor instanceof Employee) return null;
        if ((int) $actor->id === (int) $target->id) return null;
        $actorRole = $actor->role;
        $targetRole = $target->role;
        foreach (($targetRole?->permissions ?? []) as $perm) {
            if (!$actorRole || !$actorRole->hasPermission($perm)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Bạn không thể đặt lại thông tin đăng nhập của nhân viên có quyền cao hơn mình.',
                ], 403);
            }
        }
        return null;
    }

    public function store(Request $request): JsonResponse
    {
        // Gói #102 (Q1): tạo NV KHÔNG nhận mật khẩu gõ tay nữa — hệ thống tự
        // sinh mật khẩu tạm (mục 1.1), nên bỏ hẳn luật password khỏi validate
        // của đường tạo (giá trị gửi lên bị bỏ qua, không báo lỗi khó hiểu).
        $storeRules = $this->rules();
        unset($storeRules['password']);
        $validated = $request->validate($storeRules);
        if ($deny = $this->assertBranchesInScope($request, array_merge([(int) $validated['branch_id']], array_map('intval', $validated['branch_ids'] ?? [])))) return $deny;
        if ($deny = $this->guardRoleAssignment($request, $validated['role_id'] ?? null)) return $deny;
        // Gói 38: PIN lưu hash — sinh ngẫu nhiên hoặc check trùng PIN nhập tay bằng Hash::check
        if (empty($validated['pin_code'])) {
            $plainPin = $this->generateUniquePin();
        } else {
            $plainPin = $validated['pin_code'];
            if ($this->pinExists($plainPin)) {
                return response()->json(['success' => false, 'message' => 'Mã PIN đã được sử dụng.', 'errors' => ['pin_code' => ['Mã PIN đã được sử dụng.']]], 422);
            }
        }
        $validated['pin_code'] = $plainPin; // cast 'hashed' tự hash khi create
        // Gói #102 mục 1.1: mật khẩu tạm tự sinh + cờ bắt buộc đổi + dấu vết
        // lần cấp (tạo NV cũng là 1 lần cấp — Q2: mốc này tính hạn 72 giờ).
        $plainPassword = $this->generateTempPassword();
        $validated['password'] = $plainPassword; // cast 'hashed' tự hash khi create
        $validated['must_change_password'] = true;
        $validated['password_reset_at'] = now();
        [$resetByUserId, $resetByEmployeeId] = ApprovalActor::ids($request->user());
        $validated['password_reset_by_user_id'] = $resetByUserId;
        $validated['password_reset_by_employee_id'] = $resetByEmployeeId;
        $branchIds = $validated['branch_ids'] ?? [];
        unset($validated['branch_ids']);
        $emp = Employee::create($validated);
        // Gói 26c: pivot luôn gồm chi nhánh chính
        $emp->branches()->sync($this->normalizeBranchIds($emp->branch_id, $branchIds));
        return response()->json([
            'success' => true,
            'data' => $emp->load(['role:id,name', 'branch:id,name', 'branches:id,name']),
            'pin_code_plain' => $plainPin, // Gói 38: trả PIN plaintext 1 lần duy nhất để hiển thị
            'password_plain' => $plainPassword, // Gói #102: mật khẩu tạm — plaintext 1 lần duy nhất để quản lý trao tay
        ], 201);
    }

    // Gói #102 mục 1.1/4.2: sinh mật khẩu tạm 8 ký tự chữ + số, bỏ ký tự dễ
    // nhầm (0/O/1/l/I), đảm bảo có cả chữ lẫn số, nguồn ngẫu nhiên an toàn.
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

    // Gói 38: kiểm tra PIN đã tồn tại chưa (PIN lưu hash nên phải duyệt Hash::check)
    protected function pinExists(string $pin, ?int $ignoreId = null): bool
    {
        $q = Employee::select('id', 'pin_code');
        if ($ignoreId) $q->where('id', '!=', $ignoreId);
        foreach ($q->get() as $e) {
            if ($e->pin_code && Hash::check($pin, $e->pin_code)) return true;
        }
        return false;
    }

    // Gói 38: sinh PIN 6 số chưa ai dùng
    protected function generateUniquePin(?int $ignoreId = null): string
    {
        do {
            $pin = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        } while ($this->pinExists($pin, $ignoreId));
        return $pin;
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        if ($deny = $this->assertTargetVisible($request, $emp)) return $deny;
        $validated = $request->validate($this->rules($id));
        $newBranches = [];
        if (isset($validated['branch_id'])) $newBranches[] = (int) $validated['branch_id'];
        if (!empty($validated['branch_ids'])) $newBranches = array_merge($newBranches, array_map('intval', $validated['branch_ids']));
        if ($deny = $this->assertBranchesInScope($request, $newBranches)) return $deny;
        if (array_key_exists('role_id', $validated)) {
            if ($deny = $this->guardRoleAssignment($request, $validated['role_id'])) return $deny;
        }
        // Không gửi password mới -> giữ nguyên
        if (empty($validated['password'])) unset($validated['password']);
        // Gói #102 (Q1): đường gõ tay ở sửa NV — ghi mốc đổi mật khẩu,
        // KHÔNG đổi cờ must_change_password.
        if (!empty($validated['password'])) $validated['password_changed_at'] = now();
        // Gói 38: PIN rỗng = không đổi (xóa key để cast hashed không hash chuỗi rỗng);
        // PIN mới thì check trùng rồi để cast hashed tự hash
        $plainPin = null;
        if (empty($validated['pin_code'])) {
            unset($validated['pin_code']);
        } else {
            $plainPin = $validated['pin_code'];
            if ($this->pinExists($plainPin, $id)) {
                return response()->json(['success' => false, 'message' => 'Mã PIN đã được sử dụng.', 'errors' => ['pin_code' => ['Mã PIN đã được sử dụng.']]], 422);
            }
        }
        $branchIds = $validated['branch_ids'] ?? null; // null = không đụng pivot
        unset($validated['branch_ids']);
        $credChanged = $plainPin !== null || !empty($validated['password']);
        $emp->update($validated);
        // CC-R1: khi tắt NV → revoke toàn bộ token để token cũ không dùng được nữa
        // Audit 2026-10-23 BM-10: đổi PIN/mật khẩu cũng thu hồi mọi token hiện có
        if ((array_key_exists('is_active', $validated) && !$validated['is_active']) || $credChanged) {
            $emp->tokens()->delete();
        }
        if (is_array($branchIds)) {
            $emp->branches()->sync($this->normalizeBranchIds($emp->branch_id, $branchIds));
        } elseif ($emp->wasChanged('branch_id')) {
            // Đổi chi nhánh chính mà không gửi branch_ids -> đảm bảo pivot có CN chính mới
            $emp->branches()->syncWithoutDetaching([$emp->branch_id]);
        }
        $resp = ['success' => true, 'data' => $emp->load(['role:id,name', 'branch:id,name', 'branches:id,name'])];
        if ($plainPin !== null) $resp['pin_code_plain'] = $plainPin; // Gói 38: hiện PIN mới 1 lần
        return response()->json($resp);
    }

    // Gói 26c: chuẩn hóa danh sách chi nhánh — luôn gồm chi nhánh chính, unique int
    protected function normalizeBranchIds($primaryId, array $ids): array
    {
        $ids[] = (int) $primaryId;
        return array_values(array_unique(array_map('intval', $ids)));
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        if ($deny = $this->assertTargetVisible($request, $emp)) return $deny;
        $emp->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa nhân viên.']);
    }

    // Cấp lại PIN ngẫu nhiên (Gói 38: PIN lưu hash, trả plaintext 1 lần)
    public function resetPin(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        if ($deny = $this->assertTargetVisible($request, $emp)) return $deny;
        if ($deny = $this->guardResetTarget($request, $emp)) return $deny;
        $pin = $this->generateUniquePin($id);
        $emp->update(['pin_code' => $pin]); // cast 'hashed' tự hash
        $emp->tokens()->delete(); // Audit 2026-10-23 BM-10: thu hồi token khi cấp lại PIN
        return response()->json(['success' => true, 'data' => ['pin_code_plain' => $pin]]);
    }

    // Cấp lại mật khẩu — Gói #102 mục 4.3: hệ thống TỰ SINH mật khẩu tạm
    // (quản lý không gõ nữa) + hiển thị plaintext đúng 1 lần + đặt cờ bắt
    // buộc đổi + ghi dấu vết cấp lại (cặp cột tác nhân) + thu hồi toàn bộ
    // token. NV đăng nhập bằng mật khẩu tạm sẽ bị ép đổi ngay (luồng vé).
    public function resetPassword(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        if ($deny = $this->assertTargetVisible($request, $emp)) return $deny;
        if ($deny = $this->guardResetTarget($request, $emp)) return $deny;
        $plainPassword = $this->generateTempPassword();
        [$resetByUserId, $resetByEmployeeId] = ApprovalActor::ids($request->user());
        $emp->update([
            'password' => $plainPassword, // cast 'hashed' tự hash
            'must_change_password' => true,
            'password_reset_at' => now(),
            'password_reset_by_user_id' => $resetByUserId,
            'password_reset_by_employee_id' => $resetByEmployeeId,
        ]);
        $emp->tokens()->delete(); // Audit 2026-10-23 BM-10: thu hồi token khi cấp lại mật khẩu
        return response()->json([
            'success' => true,
            'message' => 'Đã cấp mật khẩu tạm mới. Nhân viên sẽ phải đổi mật khẩu ở lần đăng nhập tiếp theo.',
            'data' => ['password_plain' => $plainPassword], // plaintext 1 lần duy nhất để quản lý trao tay
        ]);
    }
}
