<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Partner;
use App\Models\TransactionPayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 29 (2026-10-09): Đối tác dùng chung toàn chuỗi + công nợ phải thu/phải trả.
// - Phiếu chi + đối tác + còn nợ > 0 -> phải trả; phiếu thu + đối tác + còn nợ > 0 -> phải thu.
// - Còn nợ = amount - paid_amount; thanh toán trừ dần qua transaction_payments.
class PartnerController extends Controller
{
    const TYPE_LABEL = ['supplier' => 'Nhà cung cấp', 'customer' => 'Khách hàng', 'other' => 'Khác'];

    /** Danh sách đối tác kèm công nợ (phải thu / phải trả). */
    public function index(Request $request): JsonResponse
    {
        $q = Partner::query()
            ->when($request->filled('type'), fn($qq) => $qq->where('type', $request->type))
            ->when($request->filled('is_active'), fn($qq) => $qq->where('is_active', (bool) $request->is_active))
            ->when($request->filled('search'), function ($qq) use ($request) {
                $s = '%' . $request->search . '%';
                $qq->where(fn($w) => $w->where('name', 'like', $s)
                    ->orWhere('code', 'like', $s)->orWhere('phone', 'like', $s));
            })
            ->orderBy('name');

        $partners = $q->get();
        $ids = $partners->pluck('id')->all();

        $debts = [];
        if ($ids) {
            $rows = DB::table('transactions')
                ->select('partner_id', 'type', DB::raw('SUM(amount - paid_amount) AS remaining'))
                ->whereIn('partner_id', $ids)
                ->whereRaw('amount - paid_amount > 0')
                ->groupBy('partner_id', 'type')
                ->get();
            foreach ($rows as $r) {
                $debts[$r->partner_id][$r->type] = (float) $r->remaining;
            }
        }

        $data = $partners->map(function ($p) use ($debts) {
            $arr = $p->toArray();
            $arr['receivable'] = $debts[$p->id]['income'] ?? 0;
            $arr['payable'] = $debts[$p->id]['expense'] ?? 0;
            $arr['type_label'] = self::TYPE_LABEL[$p->type] ?? $p->type;
            return $arr;
        });

        return response()->json(['success' => true, 'data' => $data]);
    }

    /** Tổng phải thu / phải trả toàn chuỗi. */
    public function debtSummary(): JsonResponse
    {
        $rows = DB::table('transactions')
            ->select('type', DB::raw('SUM(amount - paid_amount) AS remaining'))
            ->whereNotNull('partner_id')
            ->whereRaw('amount - paid_amount > 0')
            ->groupBy('type')
            ->get()
            ->keyBy('type');

        return response()->json(['success' => true, 'data' => [
            'receivable' => (float) ($rows['income']->remaining ?? 0),
            'payable' => (float) ($rows['expense']->remaining ?? 0),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'code' => 'nullable|string|max:30|unique:partners,code',
            'name' => 'required|string|max:150',
            'type' => 'required|in:supplier,customer,other',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:150',
            'address' => 'nullable|string|max:255',
            'tax_code' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
            'is_active' => 'nullable|boolean',
        ]);

        if (empty($v['code'])) {
            $v['code'] = 'DT-' . str_pad((int) (Partner::max('id') ?? 0) + 1, 4, '0', STR_PAD_LEFT);
        }

        $partner = Partner::create($v);
        return response()->json(['success' => true, 'data' => $partner], 201);
    }

    /** Chi tiết đối tác + danh sách phiếu liên quan (còn nợ từng phiếu). */
    public function show(int $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        $vouchers = $partner->transactions()
            ->with('category:id,name')
            ->orderByDesc('paid_at')
            ->orderByDesc('id')
            ->get()
            ->map(function ($t) {
                $arr = $t->toArray();
                $arr['remaining'] = $t->remaining();
                return $arr;
            });

        $data = $partner->toArray();
        $data['type_label'] = self::TYPE_LABEL[$partner->type] ?? $partner->type;
        $data['receivable'] = $partner->receivable();
        $data['payable'] = $partner->payable();
        $data['vouchers'] = $vouchers;

        return response()->json(['success' => true, 'data' => $data]);
    }

    /** Lịch sử thanh toán công nợ của đối tác. */
    public function payments(Request $request, int $id): JsonResponse
    {
        Partner::findOrFail($id);
        $page = TransactionPayment::with(['transaction:id,code,type', 'creator:id,name'])
            ->whereHas('transaction', fn($q) => $q->where('partner_id', $id))
            ->orderByDesc('paid_at')
            ->orderByDesc('id')
            ->paginate(20);

        return response()->json(['success' => true, 'data' => $page->items(), 'pagination' => [
            'current_page' => $page->currentPage(),
            'last_page' => $page->lastPage(),
            'total' => $page->total(),
        ]]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        $v = $request->validate([
            'code' => 'nullable|string|max:30|unique:partners,code,' . $id,
            'name' => 'sometimes|string|max:150',
            'type' => 'sometimes|in:supplier,customer,other',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:150',
            'address' => 'nullable|string|max:255',
            'tax_code' => 'nullable|string|max:30',
            'note' => 'nullable|string|max:500',
            'is_active' => 'nullable|boolean',
        ]);
        $partner->update($v);
        return response()->json(['success' => true, 'data' => $partner->fresh()]);
    }

    public function destroy(int $id): JsonResponse
    {
        $partner = Partner::findOrFail($id);
        if ($partner->transactions()->exists()) {
            return response()->json([
                'success' => false,
                'message' => 'Đối tác đã có phiếu thu/chi, không được xóa. Hãy tắt trạng thái hoạt động thay vì xóa.',
            ], 422);
        }
        $partner->delete();
        return response()->json(['success' => true]);
    }
}
