<?php

namespace App\Services;

use App\Models\InboundReceiptItem;
use App\Models\Material;
use App\Models\Partner;
use App\Models\PurchaseOrder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

// Spec Phiếu đặt hàng NCC (2026-11-08) — LÕI DÙNG CHUNG Admin + Hub (§6A/T-11):
// validate · sinh mã · trạng thái · trình bày nằm hết ở đây, hai bề mặt chỉ
// khác nguồn chi nhánh + cặp actor. Cấm fork quy tắc theo bề mặt.
class PurchaseOrderService
{
    /**
     * Validate payload tạo/sửa (§6): ≥1 dòng · SL > 0 · NCC phải là supplier
     * đang hoạt động · đơn vị từng dòng thuộc nguyên liệu (đơn vị cơ sở hoặc
     * có trong material_units). Sai → ValidationException (422 như khuôn).
     */
    public function validatePayload(Request $request, bool $withBranch): array
    {
        $v = $request->validate([
            'branch_id' => ($withBranch ? 'required' : 'nullable') . '|exists:branches,id',
            'partner_id' => 'required|exists:partners,id',
            'order_date' => 'nullable|date',
            'note' => 'nullable|string|max:1000',
            'as_status' => 'nullable|in:draft,ordered',
            'items' => 'required|array|min:1|max:200',
            'items.*.material_id' => 'required|exists:materials,id',
            'items.*.quantity' => 'required|numeric|gt:0',
            'items.*.unit_name' => 'nullable|string|max:30',
            'items.*.note' => 'nullable|string|max:255',
        ]);

        $partner = Partner::find($v['partner_id']);
        if (!$partner || $partner->type !== 'supplier' || !$partner->is_active) {
            throw ValidationException::withMessages([
                'partner_id' => 'Nhà cung cấp không hợp lệ (phải là NCC đang hoạt động).',
            ]);
        }

        foreach ($v['items'] as $i => $item) {
            $material = Material::with('units')->find($item['material_id']);
            $unitName = $item['unit_name'] ?? $material->unit;
            if ($unitName !== $material->unit
                && !$material->units->contains('unit_name', $unitName)) {
                throw ValidationException::withMessages([
                    "items.$i.unit_name" => 'Đơn vị "' . $unitName . '" không thuộc nguyên liệu "' . $material->name . '".',
                ]);
            }
            $v['items'][$i]['unit_name'] = $unitName;
        }
        return $v;
    }

    public function create(array $v, int $branchId, ?int $userId, ?int $employeeId): PurchaseOrder
    {
        return DB::transaction(function () use ($v, $branchId, $userId, $employeeId) {
            $ordered = ($v['as_status'] ?? 'draft') === 'ordered';
            $po = PurchaseOrder::create([
                'code' => PurchaseOrder::nextCode(),
                'branch_id' => $branchId,
                'partner_id' => $v['partner_id'],
                'status' => $ordered ? 'ordered' : 'draft',
                'order_date' => $v['order_date'] ?? now()->toDateString(),
                'note' => $v['note'] ?? null,
                'created_by_user_id' => $userId,
                'created_by_employee_id' => $employeeId,
                'ordered_at' => $ordered ? now() : null,
            ]);
            $this->writeItems($po, $v['items']);
            return $po;
        });
    }

    public function updateDraft(PurchaseOrder $po, array $v): PurchaseOrder
    {
        if ($po->status !== 'draft') {
            throw ValidationException::withMessages([
                'status' => 'Chỉ sửa được phiếu đang ở trạng thái Nháp.',
            ]);
        }
        return DB::transaction(function () use ($po, $v) {
            $po->update([
                // Nháp chưa gắn phiếu nhập nào → cho đổi cả chi nhánh theo
                // payload (§6: PATCH dùng cùng payload tạo). Phía Hub không
                // truyền branch_id nên khóa này giữ nguyên chi nhánh phiên.
                'branch_id' => $v['branch_id'] ?? $po->branch_id,
                'partner_id' => $v['partner_id'],
                'order_date' => $v['order_date'] ?? $po->order_date?->toDateString(),
                'note' => $v['note'] ?? null,
            ]);
            $po->items()->delete();
            $this->writeItems($po, $v['items']);
            if (($v['as_status'] ?? 'draft') === 'ordered') {
                $po->update(['status' => 'ordered', 'ordered_at' => now()]);
            }
            return $po->fresh();
        });
    }

    public function markOrdered(PurchaseOrder $po): PurchaseOrder
    {
        if ($po->status !== 'draft') {
            throw ValidationException::withMessages([
                'status' => 'Chỉ chuyển Đã đặt được từ phiếu Nháp.',
            ]);
        }
        $po->update(['status' => 'ordered', 'ordered_at' => now()]);
        return $po;
    }

    public function cancel(PurchaseOrder $po, ?int $userId, ?int $employeeId): PurchaseOrder
    {
        if (!in_array($po->status, ['draft', 'ordered'], true)) {
            throw ValidationException::withMessages([
                'status' => 'Phiếu đã nhận hàng hoặc đã hủy — không hủy được nữa.',
            ]);
        }
        $po->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancelled_by_user_id' => $userId,
            'cancelled_by_employee_id' => $employeeId,
        ]);
        return $po;
    }

    private function writeItems(PurchaseOrder $po, array $items): void
    {
        foreach ($items as $item) {
            $po->items()->create([
                'material_id' => $item['material_id'],
                'quantity' => $item['quantity'],
                'unit_name' => $item['unit_name'],
                'note' => $item['note'] ?? null,
            ]);
        }
    }

    /** Hệ số quy đổi về đơn vị cơ sở của 1 đơn vị (đọc model trực tiếp như InboundReceiptController). */
    private function unitRate(Material $material, string $unitName): float
    {
        if ($unitName === $material->unit) {
            return 1.0;
        }
        $mu = $material->units->firstWhere('unit_name', $unitName);
        return $mu ? (float) $mu->conversion_rate : 1.0;
    }

    /**
     * Số đã nhận của 1 dòng đặt, QUY VỀ đơn vị của dòng đặt (§5.3/T-07): cộng
     * các dòng nhập cùng nguyên liệu ở phiếu nhập liên kết ĐÃ XÁC NHẬN (SL ×
     * conversion_rate của dòng nhập → đơn vị cơ sở), rồi chia cho hệ số của
     * đơn vị dòng đặt.
     */
    public function receivedQuantity(PurchaseOrder $po, $item): float
    {
        $material = $item->material ?? Material::with('units')->find($item->material_id);
        if (!$material) {
            return 0.0;
        }
        $base = (float) InboundReceiptItem::query()
            ->where('material_id', $item->material_id)
            ->whereHas('receipt', function ($q) use ($po) {
                $q->where('purchase_order_id', $po->id)->where('status', 'confirmed');
            })
            ->get()
            ->sum(fn ($ri) => (float) $ri->purchase_quantity * (float) ($ri->conversion_rate ?: 1));
        $rate = $this->unitRate($material, $item->unit_name);
        return $rate > 0 ? $base / $rate : $base;
    }

    /** Trình bày 1 phiếu (snake_case). $detail = kèm dòng + phiếu nhập liên kết. */
    public function present(PurchaseOrder $po, bool $detail = false): array
    {
        $po->loadMissing(['branch', 'partner', 'createdByUser', 'createdByEmployee.role']);
        $creator = $po->createdByEmployee ?? $po->createdByUser;
        $data = [
            'id' => $po->id,
            'code' => $po->code,
            'branch_id' => $po->branch_id,
            'branch' => $po->branch ? [
                'id' => $po->branch->id,
                'name' => $po->branch->name,
                'address' => $po->branch->address,
                'phone' => $po->branch->phone,
            ] : null,
            'partner_id' => $po->partner_id,
            'partner' => $po->partner ? [
                'id' => $po->partner->id,
                'name' => $po->partner->name,
                'phone' => $po->partner->phone,
                'address' => $po->partner->address,
            ] : null,
            'status' => $po->status,
            'order_date' => $po->order_date?->toDateString(),
            'note' => $po->note,
            'items_count' => $po->relationLoaded('items') ? $po->items->count() : $po->items()->count(),
            'created_by_user_id' => $po->created_by_user_id,
            'created_by_employee_id' => $po->created_by_employee_id,
            'creator_name' => $po->createdByEmployee?->full_name ?? $po->createdByUser?->name,
            'creator_role' => $po->createdByEmployee ? ($po->createdByEmployee->role?->name ?? 'Nhân viên') : 'Quản trị viên',
            'ordered_at' => $po->ordered_at?->toDateTimeString(),
            'received_at' => $po->received_at?->toDateTimeString(),
            'cancelled_at' => $po->cancelled_at?->toDateTimeString(),
            'created_at' => $po->created_at?->toDateTimeString(),
        ];
        if ($detail) {
            $po->loadMissing(['items.material.units']);
            $data['items'] = $po->items->map(fn ($item) => [
                'id' => $item->id,
                'material_id' => $item->material_id,
                'material_name' => $item->material?->name,
                'base_unit' => $item->material?->unit,
                'quantity' => (float) $item->quantity,
                'unit_name' => $item->unit_name,
                'note' => $item->note,
                'received_quantity' => round($this->receivedQuantity($po, $item), 4),
            ])->values();
            $data['inbound_receipts'] = $po->inboundReceipts()
                ->orderBy('id')
                ->get(['id', 'code', 'status', 'receipt_date', 'created_at'])
                ->map(fn ($r) => [
                    'id' => $r->id,
                    'code' => $r->code,
                    'status' => $r->status,
                    'receipt_date' => $r->receipt_date?->toDateString(),
                ])->values();
        }
        return $data;
    }
}
