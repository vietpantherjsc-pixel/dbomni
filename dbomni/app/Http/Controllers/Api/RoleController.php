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

    public function index(): JsonResponse
    {
        $roles = Role::withCount('employees')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $roles]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:100|unique:job_roles,name',
            'permissions' => 'nullable|array',
            'permissions.*' => 'string|max:50',
        ]);
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
