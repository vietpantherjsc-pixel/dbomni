<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 57 (2026-10-14): CRUD quỹ/tài khoản tiền (tiền mặt quầy, két sắt, ngân hàng, ví).
class AccountController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Account::with('branch:id,name')
            ->when($request->filled('branch_id'), fn($qq) => $qq->where('branch_id', $request->branch_id))
            ->when($request->has('active'), fn($qq) => $qq->where('is_active', (bool) $request->query('active')))
            ->orderBy('id');
        $items = $q->get()->map(function (Account $a) {
            $d = $a->toArray();
            $d['current_balance'] = $a->currentBalance();
            return $d;
        });
        return response()->json(['success' => true, 'data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'required|string|max:100',
            'type' => ['required', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('account_types'))], // Spec danh mục dùng chung
            'opening_balance' => 'nullable|numeric|min:0',
            'is_active' => 'boolean',
        ]);
        $a = Account::create($v);
        $d = $a->fresh()->toArray();
        $d['current_balance'] = $a->fresh()->currentBalance();
        return response()->json(['success' => true, 'data' => $d], 201);
    }

    public function show(int $id): JsonResponse
    {
        $a = Account::with('branch:id,name')->findOrFail($id);
        $d = $a->toArray();
        $d['current_balance'] = $a->currentBalance();
        return response()->json(['success' => true, 'data' => $d]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $a = Account::findOrFail($id);
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'sometimes|string|max:100',
            'type' => ['sometimes', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('account_types'))], // Spec danh mục dùng chung
            'opening_balance' => 'nullable|numeric|min:0',
            'is_active' => 'boolean',
        ]);
        $a->update($v);
        $d = $a->fresh()->toArray();
        $d['current_balance'] = $a->fresh()->currentBalance();
        return response()->json(['success' => true, 'data' => $d]);
    }

    public function destroy(int $id): JsonResponse
    {
        $a = Account::findOrFail($id);
        if ($a->transactions()->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Quỹ đã có phiếu thu/chi, không được xóa. Hãy tắt hoạt động thay vì xóa.',
            ], 422);
        }
        $a->delete();
        return response()->json(['success' => true]);
    }
}
