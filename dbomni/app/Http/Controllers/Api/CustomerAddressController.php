<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomerAddress;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 49: sổ địa chỉ giao hàng (Mini App). Xác thực đơn giản bằng customer_id
// (khách đã đăng nhập SĐT + mã TV ở bước trước).
class CustomerAddressController extends Controller
{
    // Gói SEC: xác thực customer_id + phone (chống IDOR đoán ID tuần tự)
    // Audit 2026-10-23 BM-08: nâng ngang mức /online/customer — bắt buộc thêm
    // member_code (bí mật định danh thật); SĐT một mình là thông tin công khai.
    private function resolveCustomer(Request $request): ?int
    {
        $id = (int) $request->input('customer_id', $request->query('customer_id', 0));
        $phone = trim((string) $request->input('phone', $request->query('phone', '')));
        $memberCode = trim((string) $request->input('member_code', $request->query('member_code', '')));
        if ($id <= 0 || $phone === '' || $memberCode === '') return null;
        $customer = \App\Models\Customer::whereKey($id)->first();
        if (!$customer) return null;
        if (empty($customer->member_code) || !hash_equals((string) $customer->member_code, $memberCode)) return null;
        // So sánh SĐT đã chuẩn hóa (bỏ ký tự không phải số)
        // Chuẩn hóa SĐT: bỏ ký tự lạ, đổi đầu 84 -> 0 để +84... khớp 0...
        $normalize = function ($p) {
            $d = preg_replace('/[^0-9]/', '', (string) $p);
            if (str_starts_with($d, '84') && strlen($d) >= 11) $d = '0' . substr($d, 2);
            return $d;
        };
        if ($normalize($customer->phone) !== $normalize($phone)) return null;
        return $id;
    }

    // Gói SEC: kiểm tra phone khớp với customer (dùng cho store/update/destroy)
    // Audit 2026-10-23 BM-08: kèm member_code khớp mới coi là chủ sở hữu.
    private function verifyCustomerPhone(int $customerId, ?string $phone, ?string $memberCode = null): bool
    {
        if (!$phone || !$memberCode) return false;
        $customer = \App\Models\Customer::whereKey($customerId)->first();
        if (!$customer) return false;
        if (empty($customer->member_code) || !hash_equals((string) $customer->member_code, trim($memberCode))) return false;
        // Chuẩn hóa SĐT: bỏ ký tự lạ, đổi đầu 84 -> 0 để +84... khớp 0...
        $normalize = function ($p) {
            $d = preg_replace('/[^0-9]/', '', (string) $p);
            if (str_starts_with($d, '84') && strlen($d) >= 11) $d = '0' . substr($d, 2);
            return $d;
        };
        return $normalize($customer->phone) === $normalize($phone);
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->resolveCustomer($request);
        if (!$cid) return response()->json(['success' => false, 'message' => 'Thiếu thông tin xác thực hoặc SĐT/mã thành viên không khớp'], 422);
        $items = CustomerAddress::where('customer_id', $cid)
            ->orderByDesc('is_default')->orderByDesc('id')
            ->get()
            ->map(fn ($a) => [
                'id' => $a->id, 'label' => $a->label,
                'province' => $a->province, 'ward' => $a->ward, 'street' => $a->street,
                'full_address' => $a->fullAddress(), 'is_default' => $a->is_default,
            ]);
        return response()->json(['success' => true, 'data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'customer_id' => 'required|integer|exists:customers,id',
            'phone' => 'required|string|max:20', // Gói SEC: xác thực chống IDOR
            'member_code' => 'required|string|max:64', // Audit 23/10 BM-08
            'label' => 'nullable|string|max:50',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            'street' => 'required|string|max:200',
            'is_default' => 'nullable|boolean',
        ]);
        if (!$this->verifyCustomerPhone((int) $v['customer_id'], $v['phone'] ?? null, $v['member_code'] ?? null)) {
            return response()->json(['success' => false, 'message' => 'SĐT/mã thành viên không khớp với khách hàng.'], 403);
        }
        return DB::transaction(function () use ($v) {
            if (!empty($v['is_default'])) {
                CustomerAddress::where('customer_id', $v['customer_id'])->update(['is_default' => false]);
            }
            // Địa chỉ đầu tiên tự thành mặc định
            if (!CustomerAddress::where('customer_id', $v['customer_id'])->exists()) {
                $v['is_default'] = true;
            }
            $a = CustomerAddress::create($v);
            return response()->json(['success' => true, 'data' => ['id' => $a->id]]);
        });
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $v = $request->validate([
            'customer_id' => 'required|integer|exists:customers,id',
            'phone' => 'required|string|max:20', // Gói SEC
            'member_code' => 'required|string|max:64', // Audit 23/10 BM-08
            'label' => 'nullable|string|max:50',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            'street' => 'required|string|max:200',
            'is_default' => 'nullable|boolean',
        ]);
        if (!$this->verifyCustomerPhone((int) $v['customer_id'], $v['phone'] ?? null, $v['member_code'] ?? null)) {
            return response()->json(['success' => false, 'message' => 'SĐT/mã thành viên không khớp với khách hàng.'], 403);
        }
        $a = CustomerAddress::where('id', $id)->where('customer_id', $v['customer_id'])->firstOrFail();
        return DB::transaction(function () use ($a, $v) {
            if (!empty($v['is_default'])) {
                CustomerAddress::where('customer_id', $v['customer_id'])->where('id', '!=', $a->id)->update(['is_default' => false]);
            }
            $a->update($v);
            return response()->json(['success' => true]);
        });
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'customer_id' => 'required|integer|exists:customers,id',
            'phone' => 'required|string|max:20', // Gói SEC
            'member_code' => 'required|string|max:64', // Audit 23/10 BM-08
        ]);
        if (!$this->verifyCustomerPhone((int) $request->input('customer_id'), $request->input('phone'), $request->input('member_code'))) {
            return response()->json(['success' => false, 'message' => 'SĐT/mã thành viên không khớp với khách hàng.'], 403);
        }
        $a = CustomerAddress::where('id', $id)->where('customer_id', $request->input('customer_id'))->firstOrFail();
        $wasDefault = $a->is_default;
        $a->delete();
        // Nếu xóa mặc định, chọn cái mới nhất làm mặc định
        if ($wasDefault) {
            CustomerAddress::where('customer_id', $request->input('customer_id'))
                ->orderByDesc('id')->limit(1)->update(['is_default' => true]);
        }
        return response()->json(['success' => true]);
    }
}
