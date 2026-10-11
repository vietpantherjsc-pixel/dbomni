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
    private function resolveCustomer(Request $request): ?int
    {
        $id = (int) $request->input('customer_id', $request->query('customer_id', 0));
        if ($id <= 0) return null;
        return \App\Models\Customer::whereKey($id)->exists() ? $id : null;
    }

    public function index(Request $request): JsonResponse
    {
        $cid = $this->resolveCustomer($request);
        if (!$cid) return response()->json(['success' => false, 'message' => 'Thiếu customer_id'], 422);
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
            'label' => 'nullable|string|max:50',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            'street' => 'required|string|max:200',
            'is_default' => 'nullable|boolean',
        ]);
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
            'label' => 'nullable|string|max:50',
            'province' => 'nullable|string|max:100',
            'ward' => 'nullable|string|max:100',
            'street' => 'required|string|max:200',
            'is_default' => 'nullable|boolean',
        ]);
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
        $request->validate(['customer_id' => 'required|integer|exists:customers,id']);
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
