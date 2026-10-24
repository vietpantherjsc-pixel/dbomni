<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 26: CRUD chức vụ + ma trận phân quyền.
class RoleController extends Controller
{
    // Định nghĩa module/hành động cho UI ma trận quyền
    public const MATRIX = [
        ['key' => 'dashboard', 'label' => 'Tổng quan', 'actions' => ['view']],
        ['key' => 'reports', 'label' => 'Báo cáo', 'actions' => ['view']],
        ['key' => 'orders', 'label' => 'Hóa đơn', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'products', 'label' => 'Mặt hàng', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'menus', 'label' => 'Thực đơn', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'inventory', 'label' => 'Kho hàng', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'customers', 'label' => 'Khách hàng', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'promotions', 'label' => 'Khuyến mại', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'transactions', 'label' => 'Thu chi', 'actions' => ['view', 'create', 'edit', 'delete']],
        ['key' => 'staff', 'label' => 'Nhân viên', 'actions' => ['view', 'edit']],
        ['key' => 'attendance', 'label' => 'Chấm công', 'actions' => ['view', 'edit']],
        ['key' => 'settings', 'label' => 'Thiết lập', 'actions' => ['view', 'edit']],
    ];

    public function matrix(): JsonResponse
    {
        return response()->json(['success' => true, 'data' => self::MATRIX]);
    }

    // Audit 2026-10-23 B-1: danh sách trắng khóa quyền hợp lệ = ma trận UI +
    // các khóa nghiệp vụ đang dùng thật trong routes/controllers. Khóa '*'
    // bị CẤM trong mọi role của nhân viên (chỉ User admin mới full quyền).
    public static function allowedPermissions(): array
    {
        $allowed = [];
        foreach (self::MATRIX as $m) {
            foreach ($m['actions'] as $a) {
                $allowed[] = $m['key'] . '.' . $a;
            }
            $allowed[] = $m['key'] . '.*';
        }
        foreach (['branches.manage', 'finance.manage', 'inventory.manage', 'inventory.adjust',
                  'orders.bulk', 'orders.discount', 'products.bulk', 'products.manage',
                  'customers.manage'] as $extra) {
            $allowed[] = $extra;
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
