<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
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

        return response()->json(['success' => true, 'data' => $q->paginate(min($request->integer('per_page', 20), 200))]); // Gói 38: per_page tối đa 200
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

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate($this->rules());
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
        $branchIds = $validated['branch_ids'] ?? [];
        unset($validated['branch_ids']);
        $emp = Employee::create($validated);
        // Gói 26c: pivot luôn gồm chi nhánh chính
        $emp->branches()->sync($this->normalizeBranchIds($emp->branch_id, $branchIds));
        return response()->json([
            'success' => true,
            'data' => $emp->load(['role:id,name', 'branch:id,name', 'branches:id,name']),
            'pin_code_plain' => $plainPin, // Gói 38: trả PIN plaintext 1 lần duy nhất để hiển thị
        ], 201);
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
        $validated = $request->validate($this->rules($id));
        // Không gửi password mới -> giữ nguyên
        if (empty($validated['password'])) unset($validated['password']);
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
        $emp->update($validated);
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

    public function destroy(int $id): JsonResponse
    {
        Employee::findOrFail($id)->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa nhân viên.']);
    }

    // Cấp lại PIN ngẫu nhiên (Gói 38: PIN lưu hash, trả plaintext 1 lần)
    public function resetPin(int $id): JsonResponse
    {
        $emp = Employee::findOrFail($id);
        $pin = $this->generateUniquePin($id);
        $emp->update(['pin_code' => $pin]); // cast 'hashed' tự hash
        return response()->json(['success' => true, 'data' => ['pin_code_plain' => $pin]]);
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
