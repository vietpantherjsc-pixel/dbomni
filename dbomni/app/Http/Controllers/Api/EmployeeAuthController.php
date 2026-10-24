<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

// Gói 26: Đăng nhập nhân viên (username/password) + xác thực PIN 6 số cho POS/KDS.
// Gói 60 (2026-10-15): trả về danh sách chi nhánh được phân công (CN chính + branch_employee).
class EmployeeAuthController extends Controller
{
    // Audit 2026-10-23 A3-3/BM-05: khóa PIN theo NV — sai 5 lần -> khóa 15 phút.
    // Áp cho MỌI endpoint nhận PIN (qr-login, phone-login, pin-verify).
    private const PIN_MAX_FAILS = 5;
    private const PIN_LOCK_MINUTES = 15;

    private function pinLocked(Employee $emp): bool
    {
        return Cache::has('pin_lock:' . $emp->id);
    }

    private function registerPinFailure(Employee $emp): void
    {
        $key = 'pin_fails:' . $emp->id;
        $fails = (int) Cache::get($key, 0) + 1;
        Cache::put($key, $fails, now()->addMinutes(self::PIN_LOCK_MINUTES));
        if ($fails >= self::PIN_MAX_FAILS) {
            Cache::put('pin_lock:' . $emp->id, 1, now()->addMinutes(self::PIN_LOCK_MINUTES));
            Cache::forget($key);
        }
    }

    private function clearPinFailures(Employee $emp): void
    {
        Cache::forget('pin_fails:' . $emp->id);
        Cache::forget('pin_lock:' . $emp->id);
    }

    private function pinLockResponse(): JsonResponse
    {
        return response()->json(['success' => false, 'message' => 'Tài khoản tạm khóa do nhập sai PIN nhiều lần. Vui lòng thử lại sau ' . self::PIN_LOCK_MINUTES . ' phút hoặc liên hệ quản lý.'], 423);
    }

    // Danh sách chi nhánh NV được phép thao tác (CN chính + các CN phân công thêm)
    private function assignedBranches(Employee $emp): array
    {
        $emp->loadMissing('branches:id,name');
        $branches = $emp->branches->map(fn ($b) => ['id' => (int) $b->id, 'name' => $b->name])->values()->all();
        $ids = array_column($branches, 'id');
        if ($emp->branch_id && !in_array((int) $emp->branch_id, $ids, true)) {
            $emp->loadMissing('branch:id,name');
            array_unshift($branches, ['id' => (int) $emp->branch_id, 'name' => $emp->branch?->name]);
        }
        return $branches;
    }

    // Đăng nhập trang admin bằng tài khoản nhân viên
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'username' => 'required|string',
            'password' => 'required|string',
        ]);

        $emp = Employee::with(['role:id,name,permissions', 'branch:id,name', 'branches:id,name'])
            ->where('username', $request->string('username'))
            ->first();

        if (!$emp || !$emp->is_active || !$emp->password || !Hash::check($request->string('password'), $emp->password)) {
            return response()->json(['success' => false, 'message' => 'Tên đăng nhập hoặc mật khẩu không chính xác.'], 401);
        }

        $emp->tokens()->delete();
        // Audit 2026-10-23 BM-10: token NV có hạn 7 ngày (trước đây không hết hạn)
        $token = $emp->createToken('employee_token', ['employee'], now()->addDays(7))->plainTextToken;

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
                'branches' => $this->assignedBranches($emp), // Gói 60
            ],
        ]);
    }

    // Xác thực PIN 6 số -> phiên thu ngân ở POS/KDS (gọi khi đã có token đăng nhập)
    // Gói 38: BẮT BUỘC kèm phone (hoặc username) + PIN — không cho dò PIN trần toàn hệ thống.
    // PIN lưu hash bcrypt nên tìm NV theo phone/username trước, rồi Hash::check.
    public function pinVerify(Request $request): JsonResponse
    {
        $v = $request->validate([
            'pin_code' => 'required|string|size:6|regex:/^[0-9]{6}$/',
            'phone' => 'nullable|string',
            'username' => 'nullable|string',
            'purpose' => 'nullable|in:approval', // Gói "Chờ duyệt trên Hub" (2026-10-21)
        ]);

        // Gói "Chờ duyệt trên Hub" (2026-10-21, mục 5b spec): xác nhận PIN của chính NV
        // đang đăng nhập → cấp approval_token sống 5 phút cho các hành động duyệt/từ chối.
        if (($v['purpose'] ?? null) === 'approval') {
            $actor = $request->user();
            if (!$actor instanceof Employee) {
                return response()->json(['success' => false, 'message' => 'Chỉ nhân viên mới dùng chức năng này.'], 403);
            }
            if ($this->pinLocked($actor)) {
                return $this->pinLockResponse();
            }
            if (!Hash::check($v['pin_code'], (string) $actor->pin_code)) {
                $this->registerPinFailure($actor);
                return response()->json(['success' => false, 'message' => 'Mã PIN không đúng.'], 401);
            }
            $this->clearPinFailures($actor);
            $token = Str::random(40);
            Cache::put('approval_token:' . $actor->id, $token, 300);
            return response()->json(['success' => true, 'data' => ['approval_token' => $token, 'expires_in' => 300]]);
        }

        $emp = null;
        if (!empty($v['phone']) || !empty($v['username'])) {
            // Có định danh: tìm nhanh theo SĐT/username rồi check PIN
            $q = Employee::with(['role:id,name', 'branch:id,name', 'branches:id,name'])->where('is_active', true);
            if (!empty($v['phone'])) {
                $q->where('phone', $v['phone']);
            } else {
                $q->where('username', $v['username']);
            }
            $candidate = $q->first();
            if ($candidate && $this->pinLocked($candidate)) {
                return $this->pinLockResponse();
            }
            if ($candidate && Hash::check($v['pin_code'], (string) $candidate->pin_code)) {
                $emp = $candidate;
                $this->clearPinFailures($candidate);
            } elseif ($candidate) {
                $this->registerPinFailure($candidate);
            }
        } else {
            // POS đăng nhập nhanh chỉ bằng PIN: duyệt NV đang hoạt động rồi Hash::check
            // (route đã throttle:10,1 nên không dò được; số NV quán cà phê nhỏ nên đủ nhanh)
            $candidates = Employee::with(['role:id,name', 'branch:id,name', 'branches:id,name'])->where('is_active', true)->get();
            foreach ($candidates as $candidate) {
                if (Hash::check($v['pin_code'], (string) $candidate->pin_code)) {
                    if ($this->pinLocked($candidate)) {
                        return $this->pinLockResponse();
                    }
                    $emp = $candidate;
                    $this->clearPinFailures($candidate);
                    break;
                }
            }
        }

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
                'branches' => $this->assignedBranches($emp), // Gói 60
            ],
        ]);
    }

    // Gói 35: NV đăng nhập trang chấm công từ QR (branch_id + token trong QR + PIN)
    public function qrLogin(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'required|exists:branches,id',
            'token' => 'required|string',
            // Audit 2026-10-23 A3-11: PIN bắt buộc đúng 6 chữ số
            'pin_code' => 'required|string|size:6|regex:/^[0-9]{6}$/',
        ]);
        $branch = \App\Models\Branch::find($v['branch_id']);
        if (!$branch || !hash_equals((string) $branch->attendance_qr_token, (string) $v['token'])) {
            return response()->json(['success' => false, 'message' => 'Mã QR không hợp lệ.'], 422);
        }
        // Audit 2026-10-23 A3-3: lần dò PIN không khớp NV nào không quy được về
        // 1 NV cụ thể -> đếm theo (CN của QR + IP); 10 lần/15 phút -> tạm khóa
        // kênh qr-login của CN đó từ IP đó 15 phút.
        $scanKey = 'pin_fails_qr:' . $branch->id . ':' . $request->ip();
        if ((int) Cache::get($scanKey, 0) >= 10) {
            return response()->json(['success' => false, 'message' => 'Quá nhiều lần nhập sai PIN tại chi nhánh này. Vui lòng thử lại sau ' . self::PIN_LOCK_MINUTES . ' phút.'], 423);
        }
        // Audit 2026-10-23 BM-05: CHỈ duyệt NV thuộc CN của QR (CN chính hoặc
        // được phân công) — trước đây quét toàn hệ thống.
        $emp = Employee::with(['branch:id,name', 'branches:id,name'])->where('is_active', true)
            ->where(fn ($q) => $q->where('branch_id', $branch->id)
                ->orWhereHas('branches', fn ($qq) => $qq->where('branches.id', $branch->id)))
            ->get()
            ->first(fn ($e) => $e->pin_code && Hash::check($v['pin_code'], $e->pin_code));
        if (!$emp) {
            Cache::put($scanKey, (int) Cache::get($scanKey, 0) + 1, now()->addMinutes(self::PIN_LOCK_MINUTES));
            return response()->json(['success' => false, 'message' => 'Mã PIN không đúng.'], 401);
        }
        if ($this->pinLocked($emp)) {
            return $this->pinLockResponse();
        }
        $this->clearPinFailures($emp);
        return $this->issueEmployeeToken($emp, 'attendance');
    }

    // Gói 35: NV đăng nhập trang đăng ký ca riêng (SĐT + PIN, dùng ở nhà không cần QR)
    public function phonePinLogin(Request $request): JsonResponse
    {
        $v = $request->validate([
            'phone' => 'required|string',
            'pin_code' => 'required|string|size:6|regex:/^[0-9]{6}$/',
        ]);
        // Gói 38: PIN lưu hash — tìm NV theo SĐT trước, rồi Hash::check (không where theo pin_code)
        $emp = Employee::with(['branch:id,name', 'branches:id,name'])
            ->where('phone', $v['phone'])
            ->where('is_active', true)->first();
        if ($emp && $this->pinLocked($emp)) {
            return $this->pinLockResponse();
        }
        if (!$emp || !$emp->pin_code || !Hash::check($v['pin_code'], $emp->pin_code)) {
            if ($emp) $this->registerPinFailure($emp);
            return response()->json(['success' => false, 'message' => 'SĐT hoặc mã PIN không đúng.'], 401);
        }
        $this->clearPinFailures($emp);
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
                'branches' => $this->assignedBranches($u), // Gói 60
            ],
        ]);
    }

    // Cấp Sanctum token cho NV (trang public) — không đụng auth admin
    private function issueEmployeeToken(Employee $emp, string $name): JsonResponse
    {
        $emp->tokens()->where('name', $name)->delete();
        // Audit 2026-10-23 BM-10: token NV có hạn 7 ngày
        $token = $emp->createToken($name, ['employee'], now()->addDays(7))->plainTextToken;
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
                'branches' => $this->assignedBranches($emp), // Gói 60
            ],
        ]);
    }
}
