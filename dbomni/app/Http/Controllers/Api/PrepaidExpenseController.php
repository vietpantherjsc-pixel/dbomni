<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PrepaidExpense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 57 (2026-10-14): CRUD chi phí trả trước / CAPEX + tính phân bổ đều theo tháng cho P&L.
class PrepaidExpenseController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = PrepaidExpense::with('branch:id,name')
            ->when($request->filled('branch_id'), fn($qq) => $qq->where(function ($w) use ($request) {
                $w->where('branch_id', $request->branch_id)->orWhereNull('branch_id');
            }))
            ->when($request->has('active'), fn($qq) => $qq->where('is_active', (bool) $request->query('active')))
            ->orderByDesc('start_date');
        $items = $q->get()->map(function (PrepaidExpense $p) {
            $d = $p->toArray();
            $d['monthly_amount'] = $p->monthlyAmount();
            return $d;
        });
        return response()->json(['success' => true, 'data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'required|string|max:150',
            'category' => 'nullable|in:rent,capex,software,other',
            'total_amount' => 'required|numeric|min:1',
            'start_date' => 'required|date',
            'months' => 'required|integer|min:1|max:120',
            'notes' => 'nullable|string|max:500',
            'is_active' => 'boolean',
        ]);
        $p = PrepaidExpense::create($v);
        $d = $p->fresh()->toArray();
        $d['monthly_amount'] = $p->fresh()->monthlyAmount();
        return response()->json(['success' => true, 'data' => $d], 201);
    }

    public function show(int $id): JsonResponse
    {
        $p = PrepaidExpense::with('branch:id,name')->findOrFail($id);
        $d = $p->toArray();
        $d['monthly_amount'] = $p->monthlyAmount();
        return response()->json(['success' => true, 'data' => $d]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $p = PrepaidExpense::findOrFail($id);
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'name' => 'sometimes|string|max:150',
            'category' => 'nullable|in:rent,capex,software,other',
            'total_amount' => 'sometimes|numeric|min:1',
            'start_date' => 'sometimes|date',
            'months' => 'sometimes|integer|min:1|max:120',
            'notes' => 'nullable|string|max:500',
            'is_active' => 'boolean',
        ]);
        $p->update($v);
        $d = $p->fresh()->toArray();
        $d['monthly_amount'] = $p->fresh()->monthlyAmount();
        return response()->json(['success' => true, 'data' => $d]);
    }

    public function destroy(int $id): JsonResponse
    {
        PrepaidExpense::findOrFail($id)->delete();
        return response()->json(['success' => true]);
    }

    /**
     * Tính tổng phân bổ của các khoản active vào khoảng [from, to] (Y-m-d).
     * Dùng cho P&L: PrepaidExpenseController::allocation($from, $to, $branchId).
     */
    public static function allocation(string $from, string $to, $branchId = null): array
    {
        $q = PrepaidExpense::where('is_active', true)
            ->when($branchId, fn($qq) => $qq->where(function ($w) use ($branchId) {
                $w->where('branch_id', $branchId)->orWhereNull('branch_id');
            }));
        $items = [];
        $total = 0.0;
        foreach ($q->get() as $p) {
            $amt = $p->allocationFor($from, $to);
            if ($amt > 0) {
                $items[] = ['id' => $p->id, 'name' => $p->name, 'category' => $p->category, 'amount' => $amt];
                $total += $amt;
            }
        }
        return ['items' => $items, 'total' => round($total, 0)];
    }
}
