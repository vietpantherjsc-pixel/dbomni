<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\InboundReceipt;
use App\Models\Material;
use App\Models\Partner;
use App\Models\Transaction;
use App\Models\TransactionCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// Gói 43: phiếu nhập hàng theo hóa đơn NCC (thuế/CK/phí VC, trả ngay/công nợ).
// Gói 60: dùng ValidatesEmployeeBranch để NV nhiều CN chọn CN thao tác.
class InboundReceiptController extends Controller
{
    use \App\Traits\ValidatesEmployeeBranch;

    public function index(Request $request): JsonResponse
    {
        $q = InboundReceipt::with(['branch', 'partner'])
            ->orderByDesc('id');
        if ($request->filled('branch_id')) $q->where('branch_id', $request->input('branch_id'));
        if ($request->filled('partner_id')) $q->where('partner_id', $request->input('partner_id'));
        if ($request->filled('status')) $q->where('status', $request->input('status'));
        if ($request->filled('payment_type')) $q->where('payment_type', $request->input('payment_type'));
        $per = min((int) $request->input('per_page', 20), 200);
        return response()->json(['success' => true, 'data' => $q->paginate($per)]);
    }

    public function show(int $id): JsonResponse
    {
        $r = InboundReceipt::with(['branch', 'partner', 'items.material', 'items.batch'])->findOrFail($id);
        return response()->json(['success' => true, 'data' => $r]);
    }

    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $isEmployee = $actor instanceof \App\Models\Employee;
        $v = $this->validateReceipt($request, false, !$isEmployee);
        // Gói 60: NV được chọn CN trong danh sách phân công (không nhận bừa từ client)
        $branchId = $isEmployee
            ? $this->resolveEmployeeBranch($actor, $request->input('branch_id'))
            : (int) $v['branch_id'];

        // Gói 55 p11b: cảnh báo giá nhập tăng so với lần nhập gần nhất (cùng NL + NCC).
        // Chỉ cảnh báo, không chặn. Tính trước transaction (read-only).
        $priceWarnings = $this->detectPriceIncreases($v, $branchId);

        try {
            $receipt = DB::transaction(function () use ($v, $branchId, $actor, $isEmployee) {
                $totals = $this->calcTotals($v);
                $receipt = InboundReceipt::create([
                    'code' => InboundReceipt::nextCode(),
                    'branch_id' => $branchId,
                    'partner_id' => $v['partner_id'] ?? null,
                    'invoice_no' => $v['invoice_no'] ?? null,
                    'receipt_date' => $v['receipt_date'] ?? now()->toDateString(),
                    'tax_included' => (bool) ($v['tax_included'] ?? true),
                    'tax_rate' => $v['tax_rate'] ?? 0,
                    'discount_amount' => $v['discount_amount'] ?? 0,
                    'shipping_fee' => $v['shipping_fee'] ?? 0,
                    'subtotal' => $totals['subtotal'],
                    'vat_amount' => $totals['vat_amount'],
                    'grand_total' => $totals['grand_total'],
                    'payment_type' => $v['payment_type'] ?? 'paid',
                    // Gói 59: NV tạo → nháp chờ quản lý duyệt; admin tạo → xác nhận ngay
                    // K-R1 (2026-10-17): draft KHÔNG động đến kho/tiền — chỉ khi duyệt mới tạo Batch + phiếu chi
                    'status' => $isEmployee ? 'draft' : 'confirmed',
                    'note' => $v['note'] ?? null,
                    'created_by_user_id' => !$isEmployee && $actor instanceof \App\Models\User ? $actor->id : null,
                    'created_by_employee_id' => $isEmployee ? $actor->id : null,
                ]);
                foreach ($v['items'] as $item) {
                    $material = Material::findOrFail($item['material_id']);
                    // Gói 55 p11ac: lookup material_units theo purchase_unit từng dòng (giống InboundController::createBatch)
                    $inputUnit = $item['purchase_unit'] ?? null;
                    $rate = 1;
                    $purchaseUnit = $material->unit;
                    if ($inputUnit && $inputUnit !== $material->unit) {
                        $mu = $material->units()->where('unit_name', $inputUnit)->first();
                        if ($mu) {
                            $rate = (float) $mu->conversion_rate;
                            $purchaseUnit = $mu->unit_name;
                        } else {
                            // Fallback legacy
                            $rate = (float) ($material->conversion_rate ?: 1);
                            $purchaseUnit = $material->purchase_unit ?: $material->unit;
                        }
                    }
                    $baseQty = (float) $item['purchase_quantity'] * $rate;
                    $lineTotal = (float) $item['purchase_quantity'] * (float) ($item['unit_cost'] ?? 0);
                    // Gói 55 p11ae: batch.unit_cost phải là giá theo ĐƠN VỊ CƠ SỞ
                    // (trừ kho tính theo baseQty), nên chia cho rate.
                    // Giá theo đơn vị mua giữ nguyên ở receipt item.
                    $batchUnitCost = $rate > 0 ? (float) ($item['unit_cost'] ?? 0) / $rate : (float) ($item['unit_cost'] ?? 0);
                    // K-R1: chỉ tạo Batch khi đã confirmed (admin tạo hoặc đã duyệt);
                    // draft của NV chỉ lưu dòng hàng, chưa có batch_id
                    $batch = null;
                    if (!$isEmployee) {
                        $batch = Batch::create([
                            'material_id' => $material->id,
                            'branch_id' => $branchId,
                            'receipt_id' => $receipt->id,
                            'batch_code' => $item['batch_code'] ?? ('BATCH-' . strtoupper(Str::random(8))),
                            'initial_quantity' => $baseQty,
                            'current_quantity' => $baseQty,
                            'unit_cost' => $batchUnitCost,
                            'expired_at' => $item['expired_at'] ?? null,
                            'status' => 'active',
                        ]);
                    }
                    $receipt->items()->create([
                        'material_id' => $material->id,
                        'batch_id' => $batch?->id,
                        'purchase_quantity' => $item['purchase_quantity'],
                        'purchase_unit' => $purchaseUnit,
                        'conversion_rate' => $rate,
                        'unit_cost' => $item['unit_cost'] ?? 0,
                        'line_total' => $lineTotal,
                        'expired_at' => $item['expired_at'] ?? null,
                        'batch_code' => $batch?->batch_code ?? $item['batch_code'] ?? null,
                    ]);
                }
                // K-R1: chỉ sinh phiếu chi khi đã confirmed
                if (!$isEmployee) {
                    $this->createExpense($receipt);
                }
                return $receipt;
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã tạo phiếu nhập ' . $receipt->code . '.',
            'data' => $receipt->load(['items.material', 'partner']),
            // Gói 55 p11b: cảnh báo giá nhập tăng (frontend hiện banner vàng)
            'price_warnings' => $priceWarnings,
        ], 201);
    }

    // Gói 55 p11b: so sánh đơn giá (quy về đơn vị cơ sở) với lần nhập gần nhất
    // cùng nguyên liệu + cùng NCC. Tăng vượt ngưỡng settings.price_increase_alert_pct
    // (mặc định 10%) thì trả về warning — không chặn phiếu.
    private function detectPriceIncreases(array $v, int $branchId): array
    {
        $alertPct = (float) \App\Models\Setting::get('price_increase_alert_pct', '10');
        if ($alertPct <= 0) return [];
        $partnerId = $v['partner_id'] ?? null;
        $warnings = [];
        foreach ($v['items'] ?? [] as $item) {
            $materialId = (int) ($item['material_id'] ?? 0);
            $newBaseCost = (float) ($item['unit_cost'] ?? 0);
            if ($materialId <= 0 || $newBaseCost <= 0) continue;
            // Quy về đơn vị cơ sở để so sánh đúng (giống logic store)
            $material = Material::find($materialId);
            if ($material) {
                $inputUnit = $item['purchase_unit'] ?? null;
                $rate = 1;
                if ($inputUnit && $inputUnit !== $material->unit) {
                    $mu = $material->units()->where('unit_name', $inputUnit)->first();
                    $rate = $mu ? (float) $mu->conversion_rate : (float) ($material->conversion_rate ?: 1);
                }
                if ($rate > 0) $newBaseCost = $newBaseCost / $rate;
            }
            // Lần nhập gần nhất cùng NL (+ cùng NCC nếu có)
            $q = \App\Models\InboundReceiptItem::where('material_id', $materialId)
                ->whereHas('receipt', function ($rq) use ($branchId, $partnerId) {
                    $rq->where('branch_id', $branchId)->where('status', 'confirmed');
                    if ($partnerId) $rq->where('partner_id', $partnerId);
                })
                ->orderByDesc('id');
            $last = $q->first();
            if (!$last) continue;
            $lastRate = (float) ($last->conversion_rate ?: 1);
            $lastBaseCost = $lastRate > 0 ? (float) $last->unit_cost / $lastRate : (float) $last->unit_cost;
            if ($lastBaseCost <= 0) continue;
            $pct = ($newBaseCost - $lastBaseCost) / $lastBaseCost * 100;
            if ($pct >= $alertPct) {
                $warnings[] = [
                    'material_id' => $materialId,
                    'material_name' => $material?->name ?? ('NL #' . $materialId),
                    'unit' => $material?->unit ?? '',
                    'old_price' => round($lastBaseCost, 2),
                    'new_price' => round($newBaseCost, 2),
                    'pct' => round($pct, 1),
                ];
            }
        }
        return $warnings;
    }

    // Admin sửa phiếu khi có sai sót: chỉ khi chưa phát sinh thanh toán công nợ
    // và batch chưa bị xuất dùng (đối với sửa số lượng).
    public function update(Request $request, int $id): JsonResponse
    {
        $receipt = InboundReceipt::with('items.batch')->findOrFail($id);
        // K-R1: cho phép sửa cả phiếu draft (chưa có batch, chưa sinh phiếu chi)
        if (!in_array($receipt->status, ['confirmed', 'draft'], true)) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã hủy, không sửa được.'], 422);
        }
        $isDraft = $receipt->status === 'draft';
        $txn = Transaction::where('related_type', 'inbound_receipt')->where('related_id', $receipt->id)->first();
        if ($txn && $txn->payments()->exists()) {
            return response()->json(['success' => false, 'message' => 'Phiếu đã phát sinh thanh toán, chỉ sửa được ghi chú.'], 422);
        }
        $v = $this->validateReceipt($request, true);

        try {
            DB::transaction(function () use ($v, $receipt, $txn, $request, $isDraft) {
                // Cập nhật header
                $up = [];
                foreach (['partner_id', 'invoice_no', 'receipt_date', 'tax_included', 'tax_rate', 'discount_amount', 'shipping_fee', 'note'] as $f) {
                    if (array_key_exists($f, $v)) $up[$f] = $v[$f];
                }
                // Cập nhật dòng hàng: chỉ cho sửa khi batch chưa xuất dùng
                // K-R1: phiếu draft chưa có batch → sửa trực tiếp dòng hàng
                if (isset($v['items'])) {
                    foreach ($v['items'] as $ri) {
                        if (empty($ri['id'])) continue;
                        $line = $receipt->items->firstWhere('id', $ri['id']);
                        if (!$line) continue;
                        if ($isDraft || !$line->batch) {
                            // Draft: chưa có batch, sửa thẳng dòng hàng
                            $line->update([
                                'purchase_quantity' => $ri['purchase_quantity'] ?? $line->purchase_quantity,
                                'unit_cost' => $ri['unit_cost'] ?? $line->unit_cost,
                                'line_total' => (float) ($ri['purchase_quantity'] ?? $line->purchase_quantity)
                                    * (float) ($ri['unit_cost'] ?? $line->unit_cost),
                                'expired_at' => $ri['expired_at'] ?? $line->expired_at,
                            ]);
                            continue;
                        }
                        $batch = $line->batch;
                        $touched = (float) $batch->current_quantity != (float) $batch->initial_quantity;
                        $newQty = (float) ($ri['purchase_quantity'] ?? $line->purchase_quantity);
                        $newCost = (float) ($ri['unit_cost'] ?? $line->unit_cost);
                        if ($touched && abs($newQty - (float) $line->purchase_quantity) > 0.0001) {
                            throw new \Exception('Dòng "' . ($line->material?->name ?? '') . '" đã xuất dùng một phần, không sửa được số lượng.');
                        }
                        $rate = (float) $line->conversion_rate ?: 1;
                        $baseQty = $newQty * $rate;
                        $batch->update([
                            'initial_quantity' => $baseQty,
                            'current_quantity' => $touched ? $batch->current_quantity : $baseQty,
                            'unit_cost' => $newCost,
                            'expired_at' => $ri['expired_at'] ?? $line->expired_at,
                        ]);
                        $line->update([
                            'purchase_quantity' => $newQty,
                            'unit_cost' => $newCost,
                            'line_total' => $newQty * $newCost,
                            'expired_at' => $ri['expired_at'] ?? $line->expired_at,
                        ]);
                    }
                    $receipt->refresh();
                }
                if (!empty($up)) $receipt->update($up);
                // Tính lại tổng
                $totals = $this->calcTotals([
                    'items' => $receipt->items->map(fn ($l) => [
                        'purchase_quantity' => $l->purchase_quantity,
                        'unit_cost' => $l->unit_cost,
                    ])->all(),
                    'tax_included' => $receipt->tax_included,
                    'tax_rate' => $receipt->tax_rate,
                    'discount_amount' => $receipt->discount_amount,
                    'shipping_fee' => $receipt->shipping_fee,
                ]);
                $receipt->update($totals);
                // Đồng bộ phiếu chi
                if ($txn) {
                    $txn->update([
                        'amount' => $totals['grand_total'],
                        'paid_amount' => $txn->status === 'paid' ? $totals['grand_total'] : $txn->paid_amount,
                        'partner_id' => $receipt->partner_id,
                    ]);
                }
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
        return response()->json(['success' => true, 'message' => 'Đã cập nhật phiếu nhập.', 'data' => $receipt->fresh()->load(['items.material', 'partner'])]);
    }

    // Hủy phiếu: chỉ khi tất cả batch chưa xuất dùng
    public function cancel(int $id): JsonResponse
    {
        $receipt = InboundReceipt::with('items.batch')->findOrFail($id);
        // K-R1: cho phép hủy cả phiếu draft (chưa động kho/tiền)
        if (!in_array($receipt->status, ['confirmed', 'draft'], true)) {
            return response()->json(['success' => false, 'message' => 'Phiếu không ở trạng thái đã nhập hoặc nháp.'], 422);
        }
        foreach ($receipt->items as $line) {
            if ($line->batch && (float) $line->batch->current_quantity != (float) $line->batch->initial_quantity) {
                return response()->json(['success' => false, 'message' => 'Nguyên liệu "' . ($line->material?->name ?? '') . '" đã xuất dùng, không hủy được.'], 422);
            }
        }
        DB::transaction(function () use ($receipt) {
            foreach ($receipt->items as $line) {
                if ($line->batch) $line->batch->delete();
            }
            Transaction::where('related_type', 'inbound_receipt')->where('related_id', $receipt->id)->delete();
            $receipt->update(['status' => 'cancelled']);
        });
        return response()->json(['success' => true, 'message' => 'Đã hủy phiếu nhập.']);
    }

    /**
     * K-R1: Quản lý duyệt phiếu nhập nháp của NV.
     * Khi duyệt: tạo Batch (cộng kho) + sinh phiếu chi. Dùng lockForUpdate chống duyệt 2 lần.
     */
    public function approve(int $id): JsonResponse
    {
        try {
            $receipt = DB::transaction(function () use ($id) {
                $receipt = InboundReceipt::with('items.material')->lockForUpdate()->findOrFail($id);
                if ($receipt->status !== 'draft') {
                    throw new \Exception('Chỉ duyệt được phiếu đang ở trạng thái nháp.');
                }
                foreach ($receipt->items as $line) {
                    if ($line->batch_id) continue; // đã có batch (phòng race)
                    $material = $line->material ?? Material::findOrFail($line->material_id);
                    $rate = (float) ($line->conversion_rate ?: 1);
                    $baseQty = (float) $line->purchase_quantity * $rate;
                    $batchUnitCost = $rate > 0 ? (float) $line->unit_cost / $rate : (float) $line->unit_cost;
                    $batch = Batch::create([
                        'material_id' => $material->id,
                        'branch_id' => $receipt->branch_id,
                        'receipt_id' => $receipt->id,
                        'batch_code' => $line->batch_code ?? ('BATCH-' . strtoupper(Str::random(8))),
                        'initial_quantity' => $baseQty,
                        'current_quantity' => $baseQty,
                        'unit_cost' => $batchUnitCost,
                        'expired_at' => $line->expired_at,
                        'status' => 'active',
                    ]);
                    $line->update(['batch_id' => $batch->id, 'batch_code' => $batch->batch_code]);
                }
                $receipt->update(['status' => 'confirmed']);
                $this->createExpense($receipt);
                return $receipt;
            });
        } catch (\Exception $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }
        return response()->json([
            'success' => true,
            'message' => 'Đã duyệt phiếu nhập ' . $receipt->code . '.',
            'data' => $receipt->load(['items.material', 'partner']),
        ]);
    }

    private function validateReceipt(Request $request, bool $isUpdate = false, bool $requireBranch = true): array
    {
        $rules = [
            'branch_id' => ($requireBranch && !$isUpdate ? 'required' : 'nullable') . '|exists:branches,id',
            'partner_id' => 'nullable|exists:partners,id',
            'invoice_no' => 'nullable|string|max:100',
            'receipt_date' => 'nullable|date',
            'tax_included' => 'nullable|boolean',
            'tax_rate' => 'nullable|numeric|min:0|max:100',
            'discount_amount' => 'nullable|numeric|min:0',
            'shipping_fee' => 'nullable|numeric|min:0',
            'payment_type' => 'nullable|in:paid,debt',
            'note' => 'nullable|string|max:1000',
            'items' => ($isUpdate ? 'nullable' : 'required') . '|array|min:1|max:200',
            'items.*.id' => 'nullable|exists:inbound_receipt_items,id',
            'items.*.material_id' => 'required|exists:materials,id',
            'items.*.purchase_quantity' => 'required|numeric|min:0.001',
            'items.*.purchase_unit' => 'nullable|string|max:30', // Gói 55 p11ac: đơn vị mua từng dòng
            'items.*.unit_cost' => 'nullable|numeric|min:0',
            'items.*.expired_at' => 'nullable|date',
            'items.*.batch_code' => 'nullable|string|max:50',
        ];
        return $request->validate($rules);
    }

    // subtotal = Σ SL×đơn giá; VAT tách từ giá đã gồm thuế; grand = subtotal − CK + phí VC
    private function calcTotals(array $v): array
    {
        $subtotal = 0;
        foreach ($v['items'] ?? [] as $it) {
            $subtotal += (float) ($it['purchase_quantity'] ?? 0) * (float) ($it['unit_cost'] ?? 0);
        }
        $rate = (float) ($v['tax_rate'] ?? 0);
        $vat = 0;
        if (!empty($v['tax_included']) && $rate > 0) {
            $vat = $subtotal * $rate / (100 + $rate);
        } elseif ($rate > 0) {
            $vat = $subtotal * $rate / 100;
        }
        $grand = $subtotal - (float) ($v['discount_amount'] ?? 0) + (float) ($v['shipping_fee'] ?? 0);
        if (empty($v['tax_included']) && $rate > 0) {
            $grand += $vat; // giá chưa gồm thuế → cộng VAT
        }
        return [
            'subtotal' => round($subtotal, 2),
            'vat_amount' => round($vat, 2),
            'grand_total' => round(max($grand, 0), 2),
        ];
    }

    private function createExpense(InboundReceipt $receipt): void
    {
        $cat = TransactionCategory::firstOrCreate(
            ['name' => 'Nhập hàng', 'type' => 'expense'],
            ['is_system' => true]
        );
        $isDebt = $receipt->payment_type === 'debt';
        Transaction::create([
            'code' => Transaction::nextCode('expense'),
            'type' => 'expense',
            'category_id' => $cat->id,
            'branch_id' => $receipt->branch_id,
            'partner_id' => $receipt->partner_id,
            'amount' => $receipt->grand_total,
            'paid_amount' => $isDebt ? 0 : $receipt->grand_total,
            'paid_at' => $isDebt ? null : now()->toDateString(),
            'status' => $isDebt ? 'pending' : 'paid',
            'related_type' => 'inbound_receipt',
            'related_id' => $receipt->id,
            'note' => 'Nhập hàng ' . $receipt->code . ($receipt->invoice_no ? ' (HĐ ' . $receipt->invoice_no . ')' : ''),
            'created_by' => $receipt->created_by_user_id,
        ]);
    }
}
