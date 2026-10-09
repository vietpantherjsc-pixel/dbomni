<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

// Gói 26: CRUD nhân viên (10 trường + PIN 6 số + chức vụ + chi nhánh).
class EmployeeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Employee::with(['role:id,name', 'branch:id,name', 'branches:id,name'])
            ->orderBy('full_name');

        // Gói 26c: NV thuộc CN nếu branch_id chính = CN đó HOẶC có trong pivot branch_employee
        if ($request->filled('branch_id')) {
            $bid = $request->integer('branch_id');
            $q->where(fn ($w) => $w->where('branch_id', $bid)
                ->orWhereHas('branches', fn ($b) => $b->where('branches.id', $bid)));
        }
        if ($request->filled('role_id')) $q->where('role_id', $request->integer('role_id'));
        if ($request->filled('is_active')) $q->where('is_active', $request->boolean('is_active'));
        if ($request->filled('search')) {
            $s = '%' . $request->string('search') . '%';
            $q->where(fn ($w) => $w->where('full_name', 'like', $s)
                ->orWhere('phone', 'like', $s)
                ->orWhere('username', 'like', $s));
        }

        return response()->json(['success' => true, 'data' => $q->paginate(20)]);
    }

    public function show(int $id): JsonResponse
    {
        $emp = Employee::with(['role:id,name', 'branch:id,name', 'branches:id,name'])->findOrFail($id);
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
            'password' => 'nullable|string|min:6|max:100',
            'pin_code' => ['nullable', 'string', 'size:6', 'regex:/^[0-9]{6}$/', Rule::unique('employees', 'pin_code')->ignore($ignoreId)],
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

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate($this->rules());
        // Chưa nhập PIN -> tự sinh ngẫu nhiên 6 số
        if (empty($validated['pin_code'])) {
            do {
                $validated['pin_code'] = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            } while (Employee::where('pin_code', $validated['pin_code'])->exists());
        }
        $branchIds = $validated['branch_ids'] ?? [];
        unset($validated['branch_ids']);
        $emp = Employee::create($validated);
        // Gói 26c: pivot luôn gồm chi nhánh chính
        $emp->branches()->sync($this->normalizeBranchIds($emp->branch_id, $branchIds));
        return response()->json(['success' => true, 'data' => $emp->load(['role:id,name', 'branch:id,name', 'branches:id,name'])], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        $validated = $request->validate($this->rules($id));
        // Không gửi password mới -> giữ nguyên
        if (empty($validated['password'])) unset($validated['password']);
        $branchIds = $validated['branch_ids'] ?? null; // null = không đụng pivot
        unset($validated['branch_ids']);
        $emp->update($validated);
        if (is_array($branchIds)) {
            $emp->branches()->sync($this->normalizeBranchIds($emp->branch_id, $branchIds));
        } elseif ($emp->wasChanged('branch_id')) {
            // Đổi chi nhánh chính mà không gửi branch_ids -> đảm bảo pivot có CN chính mới
            $emp->branches()->syncWithoutDetaching([$emp->branch_id]);
        }
        return response()->json(['success' => true, 'data' => $emp->load(['role:id,name', 'branch:id,name', 'branches:id,name'])]);
    }

    // Gói 26c: chuẩn hóa danh sách chi nhánh — luôn gồm chi nhánh chính, unique int
    protected function normalizeBranchIds($primaryId, array $ids): array
    {
        $ids[] = (int) $primaryId;
        return array_values(array_unique(array_map('intval', $ids)));
    }

    public function destroy(int $id): JsonResponse
    {
        Employee::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa nhân viên.']);
    }

    // Cấp lại PIN ngẫu nhiên
    public function resetPin(int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        do {
            $pin = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        } while (Employee::where('pin_code', $pin)->where('id', '!=', $id)->exists());
        $emp->update(['pin_code' => $pin]);
        return response()->json(['success' => true, 'data' => ['pin_code' => $pin]]);
    }

    // Đặt lại mật khẩu đăng nhập
    public function resetPassword(Request $request, int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        $validated = $request->validate(['password' => 'required|string|min:6|max:100']);
        $emp->update(['password' => $validated['password']]);
        return response()->json(['success' => true, 'message' => 'Đã đặt lại mật khẩu.']);
    }
}
