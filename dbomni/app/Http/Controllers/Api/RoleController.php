<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Support\PermissionTree;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 26: CRUD chức vụ + ma trận phân quyền.
// Cây phân quyền chi tiết (spec đã khóa 10/11/2026 §1.1/§2): MỘT cây duy nhất
// sinh từ PermissionTree — ma trận UI hiển thị đúng cây này, danh sách
// trắng sinh từ cây này. Cụm lương (staff.salary.*) + settings.secrets là
// tier_only — KHÔNG cấp qua chức vụ (phán (a) + (d)), lưu role chứa chúng
// → 422 như khóa lạ (T-06).
class RoleController extends Controller
{
    public function matrix(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => PermissionTree::matrix()]);
    }

    // Audit 2026-10-23 B-1: danh sách trắng khóa quyền hợp lệ = mọi lá cấp
    // được qua chức vụ + wildcard tiền tố của chúng. Khóa '*' bị CẤM trong
    // mọi role của nhân viên (chỉ User admin mới full quyền).
    public static function allowedPermissions(): array
    {
        $allowed = PermissionTree::grantableLeaves();
        foreach (PermissionTree::MODULES as $m) {
            $hasTierOnly = false;
            foreach ($m['children'] as $c) {
                if (!empty($c['tier_only'])) { $hasTierOnly = true; continue; }
                // Wildcard theo mục con (vd inventory.inbound.*)
                $allowed[] = $m['key'] . '.' . $c['key'] . '.*';
            }
            // Wildcard theo module (vd inventory.*) — CHỈ khi module không
            // chứa mục con tier_only (vd staff.* sẽ nuốt cả cụm lương).
            if (!$hasTierOnly) {
                $allowed[] = $m['key'] . '.*';
            }
        }
        return array_values(array_unique($allowed));
    }

    // Validate danh sách quyền xin lưu: mọi khóa phải thuộc danh sách trắng.
    // Nếu người lưu là Employee: chỉ được cấp quyền mình đang có (chặn leo thang).
    protected function guardPermissions(Request $request, ?array $perms): ?JsonResponse
    {
        if ($perms === null) return null;
        $allowed = self::allowedPermissions();
        foreach ($perms as $perm) {
            if (!in_array($perm, $allowed, true)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Khóa quyền không hợp lệ: ' . $perm,
                    'errors' => ['permissions' => ['Khóa quyền không hợp lệ: ' . $perm]],
                ], 422);
            }
        }
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $actorRole = $actor->role;
            foreach ($perms as $perm) {
                if (!$actorRole || !$actorRole->hasPermission($perm)) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Bạn không thể cấp quyền vượt quá quyền của mình: ' . $perm,
                    ], 403);
                }
            }
        }
        return null;
    }

    public function index(): JsonResponse
    {
        $roles = Role::withCount('employees')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $roles]);
    }

    public function show(int $id): JsonResponse
    {
        $role = Role::withCount('employees')->findOrFail($id);
        return response()->json(['success' => true, 'data' => $role]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100|unique:job_roles,name',
            'permissions' => 'nullable|array',
            'permissions.*' => 'string|max:50',
        ]);
        if ($deny = $this->guardPermissions($request, $validated['permissions'] ?? null)) return $deny;
        $role = Role::create($validated);
        return response()->json(['success' => true, 'data' => $role], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $role = Role::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:100|unique:job_roles,name,' . $id,
            'permissions' => 'nullable|array',
            'permissions.*' => 'string|max:50',
        ]);
        if (array_key_exists('permissions', $validated)) {
            if ($deny = $this->guardPermissions($request, $validated['permissions'])) return $deny;
        }
        $role->update($validated);
        return response()->json(['success' => true, 'data' => $role]);
    }

    public function destroy(int $id): JsonResponse
    {
        $role = Role::findOrFail($id);
        if ($role->employees()->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Chức vụ đang gán cho nhân viên, không thể xóa. Hãy chuyển nhân viên sang chức vụ khác trước.',
            ], 400);
        }
        $role->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa chức vụ.']);
    }
}
