<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\MembershipTier;
use App\Models\PointTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 5 (2026-10-05): Quản lý khách hàng — SĐT làm định danh, mã QR thành viên.
class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Customer::with('tier')->orderByDesc('id');

        if ($request->filled('search')) {
            $s = $request->query('search');
            $query->where(function ($q) use ($s) {
                $q->where('phone', 'like', "%{$s}%")
                  ->orWhere('name', 'like', "%{$s}%")
                  ->orWhere('member_code', 'like', "%{$s}%");
            });
        }

        $perPage = (int) $request->query('per_page', 20);
        return response()->json(['success' => true, 'data' => $query->paginate($perPage)]);
    }

    public function show(int $id): JsonResponse
    {
        $customer = Customer::with([
            'tier',
            'orders' => fn($q) => $q->limit(20),
            'pointTransactions' => fn($q) => $q->limit(30),
        ])->findOrFail($id);

        return response()->json(['success' => true, 'data' => $customer]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:150',
            'phone' => 'required|string|max:20|unique:customers,phone',
            'birthday' => 'nullable|date',
            'note' => 'nullable|string|max:255',
        ]);

        $customer = DB::transaction(function () use ($validated) {
            $tier = MembershipTier::where('is_default', true)->first()
                ?? MembershipTier::orderBy('sort_order')->first();

            return Customer::create([
                'member_code' => $this->generateMemberCode(),
                'name' => $validated['name'],
                'phone' => $validated['phone'],
                'birthday' => $validated['birthday'] ?? null,
                'membership_tier_id' => $tier?->id,
                'note' => $validated['note'] ?? null,
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'Đã thêm khách hàng',
            'data' => $customer->load('tier'),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $customer = Customer::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:150',
            'birthday' => 'nullable|date',
            'note' => 'nullable|string|max:255',
            'membership_tier_id' => 'nullable|exists:membership_tiers,id',
        ]);
        $customer->update($validated);
        return response()->json(['success' => true, 'data' => $customer->load('tier')]);
    }

    // Điều chỉnh điểm thủ công (cộng/trừ) — ghi lịch sử
    public function adjustPoints(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'change' => 'required|integer|not_in:0',
            'note' => 'nullable|string|max:255',
        ]);

        try {
            $customer = DB::transaction(function () use ($id, $validated) {
                $customer = Customer::lockForUpdate()->findOrFail($id);
                $newPoints = $customer->points + $validated['change'];
                if ($newPoints < 0) {
                    throw new \Exception('Điểm không đủ để trừ.');
                }
                $customer->points = $newPoints;
                $customer->save();

                PointTransaction::create([
                    'customer_id' => $customer->id,
                    'change' => $validated['change'],
                    'type' => 'adjust',
                    'note' => $validated['note'] ?? 'Điều chỉnh thủ công',
                ]);

                return $customer;
            });

            return response()->json(['success' => true, 'data' => $customer]);
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 400);
        }
    }

    private function generateMemberCode(): string
    {
        do {
            $code = 'TV' . strtoupper(Str::random(6));
        } while (Customer::where('member_code', $code)->exists());
        return $code;
    }
}
