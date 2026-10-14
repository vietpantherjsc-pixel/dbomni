<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Transaction;
use App\Models\TransactionCategory;
use App\Models\TransactionPayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 27 (2026-10-09): Thu-Chi hoàn thiện.
// - CRUD phiếu thu/chi + lọc + tổng kết kỳ.
// - Phiếu tự sinh (related_type != null, VD: từ nhập kho): chỉ cho sửa ghi chú, không cho sửa số tiền, không cho xóa.
class TransactionController extends Controller
{
    /** Danh sách danh mục thu/chi (kèm cờ is_system). */
    public function categories(): JsonResponse
    {
        $cats = TransactionCategory::orderBy('type')->orderBy('name')->get();
        return response()->json(['success' => true, 'data' => $cats]);
    }

    /** Danh sách phiếu + tổng kết kỳ theo bộ lọc. */
    public function index(Request $request): JsonResponse
    {
        $q = Transaction::with(['category:id,name,type', 'branch:id,name', 'partner:id,code,name', 'account:id,name,type'])
            ->when($request->filled('type'), fn($qq) => $qq->where('type', $request->type))
            ->when($request->filled('branch_id'), fn($qq) => $qq->where('branch_id', $request->branch_id))
            ->when($request->filled('category_id'), fn($qq) => $qq->where('category_id', $request->category_id))
            ->when($request->filled('partner_id'), fn($qq) => $qq->where('partner_id', $request->partner_id))
            ->when($request->filled('status'), fn($qq) => $qq->where('status', $request->status))
            ->when($request->filled('account_id'), fn($qq) => $qq->where('account_id', $request->account_id)) // Gói 57
            // Gói 59: lọc phiếu chờ duyệt cho trang duyệt của quản lý
            ->when($request->input('pending_approval') == '1', fn($qq) => $qq->whereNull('approved_by'))
            ->when($request->filled('date_from'), fn($qq) => $qq->whereDate('paid_at', '>=', $request->date_from))
            ->when($request->filled('date_to'), fn($qq) => $qq->whereDate('paid_at', '<=', $request->date_to))
            ->when($request->filled('search'), function ($qq) use ($request) {
                $s = '%' . $request->search . '%';
                $qq->where(fn($w) => $w->where('code', 'like', $s)->orWhere('note', 'like', $s));
            })
            ->orderByDesc('paid_at')
            ->orderByDesc('id');

        $summary = [
            'total_income' => (float) (clone $q)->where('type', 'income')->where('status', 'paid')->sum('amount'),
            'total_expense' => (float) (clone $q)->where('type', 'expense')->where('status', 'paid')->sum('amount'),
        ];
        $summary['balance'] = $summary['total_income'] - $summary['total_expense'];

        $page = $q->paginate(20)->appends($request->query());
        $items = collect($page->items());

        // Gói 57: running balance — số dư lũy kế theo thứ tự thời gian.
        // Nếu lọc theo 1 quỹ: bắt đầu từ opening_balance của quỹ;
        // ngược lại bắt đầu từ 0 (chỉ mang tính tham khảo vì nhiều quỹ).
        $opening = 0.0;
        if ($request->filled('account_id') && class_exists(\App\Models\Account::class)) {
            $acc = \App\Models\Account::find($request->account_id);
            if ($acc) $opening = (float) $acc->opening_balance;
        }
        $chrono = $items->sortBy([['paid_at', 'asc'], ['id', 'asc']])->values();
        $bal = $opening;
        $rbMap = [];
        foreach ($chrono as $tx) {
            if ($tx->status === 'paid') {
                $bal += $tx->type === 'income' ? (float) $tx->amount : -(float) $tx->amount;
            }
            $rbMap[$tx->id] = round($bal, 0);
        }
        $data = $items->map(function ($tx) use ($rbMap) {
            $d = $tx->toArray();
            $d['running_balance'] = $rbMap[$tx->id] ?? null;
            $d['is_approved'] = $tx->approved_by !== null; // Gói 59
            return $d;
        })->values();

        return response()->json(['success' => true, 'data' => $data, 'pagination' => [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'total' => $page->total(),
        ], 'summary' => $summary]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'type' => 'required|in:income,expense',
            'category_id' => 'required|exists:transaction_categories,id',
            'branch_id' => 'nullable|exists:branches,id',
            'partner_id' => 'nullable|exists:partners,id', // Gói 29: đối tác (công nợ)
            'is_debt' => 'nullable|boolean', // Gói 29: tick "Ghi công nợ" -> pending, chưa trả
            'amount' => 'required|numeric|min:1',
            'paid_at' => 'nullable|date',
            'occurred_at' => 'nullable|date', // Gói 57: ngày thực chi/phát sinh
            'account_id' => 'nullable|exists:accounts,id', // Gói 57: quỹ/tài khoản
            'attachment' => 'nullable|string|max:255', // Gói 57: path ảnh chứng từ (frontend upload riêng)
            'status' => 'nullable|in:paid,pending',
            'payment_method' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
        ]);

        // Danh mục phải cùng loại thu/chi với phiếu.
        $cat = TransactionCategory::findOrFail($v['category_id']);
        if ($cat->type !== $v['type']) {
            return response()->json(['success' => false, 'message' => 'Danh mục không khớp loại phiếu (thu/chi).'], 422);
        }

        // Gói 29: ghi công nợ -> trạng thái chờ thanh toán, chưa trả đồng nào.
        $isDebt = (bool) ($v['is_debt'] ?? false);
        $status = $isDebt ? 'pending' : ($v['status'] ?? 'paid');

        // Gói 59: NV tạo → chờ quản lý duyệt; admin tạo → duyệt ngay.
        // NV mobile: ép chi nhánh theo tài khoản, không nhận từ client.
        $actor = $request->user();
        $isEmployee = $actor instanceof \App\Models\Employee;
        $branchId = $isEmployee ? (int) $actor->branch_id : ($v['branch_id'] ?? null);

        $tx = DB::transaction(function () use ($v, $status, $branchId, $isEmployee) {
            return Transaction::create([
                'code' => Transaction::nextCode($v['type']),
                'type' => $v['type'],
                'category_id' => $v['category_id'],
                'branch_id' => $branchId,
                'partner_id' => $v['partner_id'] ?? null,
                'amount' => $v['amount'],
                'paid_amount' => $status === 'paid' ? $v['amount'] : 0,
                'paid_at' => $v['paid_at'] ?? now()->toDateString(),
                'occurred_at' => $v['occurred_at'] ?? null, // Gói 57
                'account_id' => $v['account_id'] ?? null, // Gói 57
                'attachment' => $v['attachment'] ?? null, // Gói 57
                'approved_by' => $isEmployee ? null : auth()->id(), // Gói 59
                'approved_at' => $isEmployee ? null : now(), // Gói 59
                'status' => $status,
                'payment_method' => $v['payment_method'] ?? null,
                'note' => $v['note'] ?? null,
                'created_by' => $isEmployee ? null : auth()->id(), // Gói 59: NV không có users.id
            ]);
        });

        return response()->json(['success' => true, 'data' => $tx->load('category', 'branch', 'partner', 'account')], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $tx = Transaction::findOrFail($id);

        // Gói 27: phiếu tự sinh chỉ cho sửa ghi chú.
        // Gói 29: phiếu đã có thanh toán trừ dần cũng chỉ cho sửa ghi chú (giữ toàn vẹn công nợ).
        if ($tx->isAuto() || $tx->payments()->exists()) {
            $v = $request->validate(['note' => 'nullable|string|max:500']);
            $tx->update(['note' => $v['note'] ?? null]);
            return response()->json(['success' => true, 'data' => $tx->fresh()->load('category', 'branch', 'partner')]);
        }

        $v = $request->validate([
            'category_id' => 'sometimes|exists:transaction_categories,id',
            'branch_id' => 'nullable|exists:branches,id',
            'partner_id' => 'nullable|exists:partners,id', // Gói 29
            'amount' => 'sometimes|numeric|min:1',
            'paid_at' => 'nullable|date',
            'occurred_at' => 'nullable|date', // Gói 57
            'account_id' => 'nullable|exists:accounts,id', // Gói 57
            'attachment' => 'nullable|string|max:255', // Gói 57
            'status' => 'nullable|in:paid,pending',
            'payment_method' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
        ]);

        if (isset($v['category_id'])) {
            $cat = TransactionCategory::findOrFail($v['category_id']);
            if ($cat->type !== $tx->type) {
                return response()->json(['success' => false, 'message' => 'Danh mục không khớp loại phiếu (thu/chi).'], 422);
            }
        }

        // Gói 29: đồng bộ paid_amount khi đổi trạng thái/số tiền.
        if (isset($v['status']) && $v['status'] === 'paid') {
            $v['paid_amount'] = $v['amount'] ?? $tx->amount;
        } elseif (isset($v['amount']) && $tx->status === 'paid') {
            $v['paid_amount'] = $v['amount'];
        }

        $tx->update($v);
        return response()->json(['success' => true, 'data' => $tx->fresh()->load('category', 'branch', 'partner')]);
    }

    public function destroy(int $id): JsonResponse
    {
        $tx = Transaction::findOrFail($id);
        // Gói 27: phiếu tự sinh giữ lại để đối soát với kho — không cho xóa.
        if ($tx->isAuto()) {
            return response()->json([
                'success' => false,
                'message' => 'Phiếu tự động từ nhập kho không được xóa. Muốn điều chỉnh, hãy xử lý phiếu nhập kho gốc.',
            ], 422);
        }
        // Gói 29: phiếu đã có thanh toán trừ dần — không cho xóa để giữ lịch sử công nợ.
        if ($tx->payments()->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Phiếu đã có lịch sử thanh toán, không được xóa.',
            ], 422);
        }
        $tx->delete();
        return response()->json(['success' => true]);
    }

    /**
     * Gói 29: thanh toán trừ dần công nợ 1 phiếu.
     * Validate amount <= còn nợ; cộng paid_amount; đủ -> status = paid.
     */
    public function pay(Request $request, int $id): JsonResponse
    {
        $tx = Transaction::findOrFail($id);
        $remaining = $tx->remaining();
        if ($remaining <= 0) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã thanh toán đủ, còn nợ 0đ.'], 422);
        }

        $v = $request->validate([
            'amount' => 'required|numeric|min:1|max:' . $remaining,
            'paid_at' => 'nullable|date',
            'payment_method' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
        ]);

        $payment = DB::transaction(function () use ($tx, $v) {
            $p = TransactionPayment::create([
                'transaction_id' => $tx->id,
                'amount' => $v['amount'],
                'paid_at' => $v['paid_at'] ?? now()->toDateString(),
                'payment_method' => $v['payment_method'] ?? null,
                'note' => $v['note'] ?? null,
                'created_by' => auth()->id(),
            ]);
            $tx->increment('paid_amount', $v['amount']);
            $tx->refresh();
            if ((float) $tx->paid_amount >= (float) $tx->amount) {
                $tx->update(['status' => 'paid']);
            }
            return $p;
        });

        $fresh = $tx->fresh()->load('category', 'branch', 'partner');
        return response()->json(['success' => true, 'data' => [
            'payment' => $payment,
            'transaction' => $fresh,
            'remaining' => $fresh->remaining(),
        ]]);
    }

    // Gói 59: quản lý duyệt phiếu do NV tạo (route đặt trong group permission:finance.manage).
    public function approve(int $id): JsonResponse
    {
        $tx = Transaction::findOrFail($id);
        if ($tx->approved_by !== null) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã được duyệt trước đó.'], 422);
        }
        $tx->update(['approved_by' => auth()->id(), 'approved_at' => now()]);
        $d = $tx->fresh()->toArray();
        $d['is_approved'] = true;
        return response()->json(['success' => true, 'data' => $d]);
    }

    /** Sửa danh mục (tên; loại không cho đổi nếu đã có phiếu). */
    public function updateCategory(Request $request, int $id): JsonResponse
    {
        $cat = TransactionCategory::findOrFail($id);
        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'type' => 'sometimes|in:income,expense',
        ]);
        if (isset($v['type']) && $v['type'] !== $cat->type && $cat->transactions()->exists()) {
            return response()->json(['success' => false, 'message' => 'Danh mục đã có phiếu, không được đổi loại thu/chi.'], 422);
        }
        // Tránh trùng tên cùng loại.
        if (isset($v['name'])) {
            $dup = TransactionCategory::where('name', $v['name'])
                ->where('type', $v['type'] ?? $cat->type)
                ->where('id', '!=', $id)->exists();
            if ($dup) {
                return response()->json(['success' => false, 'message' => 'Tên danh mục đã tồn tại.'], 422);
            }
        }
        $cat->update($v);
        return response()->json(['success' => true, 'data' => $cat->fresh()]);
    }

    /** Xóa danh mục (chặn danh mục hệ thống và danh mục đang có phiếu). */
    public function destroyCategory(int $id): JsonResponse
    {
        $cat = TransactionCategory::findOrFail($id);
        if ($cat->is_system) {
            return response()->json(['success' => false, 'message' => 'Danh mục hệ thống không được xóa.'], 422);
        }
        if ($cat->transactions()->exists()) {
            return response()->json(['success' => false, 'message' => 'Danh mục đang có phiếu, không được xóa.'], 422);
        }
        $cat->delete();
        return response()->json(['success' => true]);
    }

    /** Thêm danh mục mới. */
    public function storeCategory(Request $request): JsonResponse
    {
        $v = $request->validate([
            'name' => 'required|string|max:100',
            'type' => 'required|in:income,expense',
        ]);
        $cat = TransactionCategory::firstOrCreate(
            ['name' => $v['name'], 'type' => $v['type']],
            ['is_system' => false]
        );
        return response()->json(['success' => true, 'data' => $cat], 201);
    }
}
