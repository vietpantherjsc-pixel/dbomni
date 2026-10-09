<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

// Gói 26: Đăng nhập nhân viên (username/password) + xác thực PIN 6 số cho POS/KDS.
class EmployeeAuthController extends Controller
{
    // Đăng nhập trang admin bằng tài khoản nhân viên
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $emp = Employee::with(['role:id,name,permissions', 'branch:id,name'])
            ->where('username', $request->string('username'))
            ->first();

        if (!$emp || !$emp->is_active || !$emp->password || !Hash::check($request->string('password'), $emp->password)) {
            return response()->json(['success' => false, 'message' => 'Tên đăng nhập hoặc mật khẩu không chính xác.'], 401);
        }

        $emp->tokens()->delete();
        $token = $emp->createToken('employee_token')->plainTextToken;

        return response()->json([
            'success' => true,
            'message' => 'Đăng nhập thành công.',
            'access_token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $emp->id,
                'name' => $emp->full_name,
                'type' => 'employee',
                'roles' => $emp->role ? [$emp->role->name] : [],
                'permissions' => $emp->role?->permissions ?? [],
                'branch_id' => $emp->branch_id,
                'branch_name' => $emp->branch?->name,
            ],
        ]);
    }

    // Xác thực PIN 6 số -> phiên thu ngân ở POS/KDS (gọi khi đã có token đăng nhập)
    public function pinVerify(Request $request): JsonResponse
    {
        $request->validate(['pin_code' => 'required|string|size:6']);

        $emp = Employee::with(['role:id,name', 'branch:id,name'])
            ->where('pin_code', $request->string('pin_code'))
            ->where('is_active', true)
            ->first();

        if (!$emp) {
            return response()->json(['success' => false, 'message' => 'Mã PIN không đúng.'], 401);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $emp->id,
                'full_name' => $emp->full_name,
                'role' => $emp->role?->name,
                'branch_id' => $emp->branch_id,
                'branch_name' => $emp->branch?->name,
            ],
        ]);
    }

    // Gói 35: NV đăng nhập trang chấm công từ QR (branch_id + token trong QR + PIN)
    public function qrLogin(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'token' => 'required|string',
            'pin_code' => 'required|string|size:6',
        ]);
        $branch = \App\Models\Branch::find($v['branch_id']);
        if (!$branch || !hash_equals((string) $branch->attendance_qr_token, (string) $v['token'])) {
            return response()->json(['success' => false, 'message' => 'Mã QR không hợp lệ.'], 422);
        }
        $emp = Employee::with(['branch:id,name'])
            ->where('pin_code', $v['pin_code'])->where('is_active', true)->first();
        if (!$emp) {
            return response()->json(['success' => false, 'message' => 'Mã PIN không đúng.'], 401);
        }
        return $this->issueEmployeeToken($emp, 'attendance');
    }

    // Gói 35: NV đăng nhập trang đăng ký ca riêng (SĐT + PIN, dùng ở nhà không cần QR)
    public function phonePinLogin(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'required|string',
            'pin_code' => 'required|string|size:6',
        ]);
        $emp = Employee::with(['branch:id,name'])
            ->where('phone', $v['phone'])
            ->where('pin_code', $v['pin_code'])
            ->where('is_active', true)->first();
        if (!$emp) {
            return response()->json(['success' => false, 'message' => 'SĐT hoặc mã PIN không đúng.'], 401);
        }
        return $this->issueEmployeeToken($emp, 'shift_register');
    }

    // Gói 35: thông tin NV từ token (trang public load lại)
    public function me(Request $request): JsonResponse
    {
        $u = $request->user();
        if (!$u instanceof Employee) {
            return response()->json(['success' => false, 'message' => 'Token không hợp lệ.'], 403);
        }
        $u->load('branch:id,name');
        return response()->json([
            'success' => true,
            'data' => [
                'id' => $u->id,
                'full_name' => $u->full_name,
                'phone' => $u->phone,
                'branch_id' => $u->branch_id,
                'branch_name' => $u->branch?->name,
            ],
        ]);
    }

    // Cấp Sanctum token cho NV (trang public) — không đụng auth admin
    private function issueEmployeeToken(Employee $emp, string $name): JsonResponse
    {
        $emp->tokens()->where('name', $name)->delete();
        $token = $emp->createToken($name)->plainTextToken;
        return response()->json([
            'success' => true,
            'access_token' => $token,
            'token_type' => 'Bearer',
            'employee' => [
                'id' => $emp->id,
                'full_name' => $emp->full_name,
                'phone' => $emp->phone,
                'branch_id' => $emp->branch_id,
                'branch_name' => $emp->branch?->name,
            ],
        ]);
    }
}
