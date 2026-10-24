<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Material;
use App\Models\OutboundReceipt;
use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// Gói 55 p11z: phiếu XUẤT KHO — tạo nháp, chốt trừ kho theo FIFO.
class OutboundController extends Controller
{
    // Audit 2026-10-23 B-5: NV chỉ xem/thao tác phiếu xuất thuộc CN phân công.
    protected function denyReceiptBranch(Request $request, $branchId): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Phiếu không thuộc chi nhánh bạn được phân công.'], 403);
        }
        return null;
    }
    use \App\Traits\ValidatesEmployeeBranch;
    /**
     * Danh sách phiếu xuất theo chi nhánh (phân trang).
     */
    public function index(Request $request): JsonResponse
    {
        $v = $request->validate([
            'branch_id' => 'nullable|exists:branches,id',
            'status' => 'nullable|in:draft,confirmed,cancelled',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $q = OutboundReceipt::with(['branch:id,name', 'employee:id,name'])
            ->withCount('items')
            ->orderByDesc('id');

        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $q->whereIn('branch_id', $actor->allBranchIds());
        }
        if (!empty($v['branch_id'])) {
            $q->where('branch_id', $v['branch_id']);
        }
        if (!empty($v['status'])) {
            $q->where('status', $v['status']);
        }

        $perPage = $v['per_page'] ?? 20;
        $paginator = $q->paginate($perPage);

        return response()->json([
            'success' => true,
            'data' => $paginator,
            'reasons' => OutboundReceipt::REASONS,
        ]);
    }

    /**
     * Tạo phiếu xuất nháp — chưa trừ kho lúc tạo.
     */
    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        $isEmployee = $actor instanceof \App\Models\Employee;
        $v = $request->validate([
            'branch_id' => ($isEmployee ? 'nullable' : 'required') . '|exists:branches,id',
            'employee_id' => 'nullable|exists:employees,id',
            'reason' => ['required', \Illuminate\Validation\Rule::in(\App\Models\SharedCategory::activeCodes('outbound_reasons'))], // Spec danh mục dùng chung
            'note' => 'nullable|string|max:1000',
            'items' => 'required|array|min:1|max:100',
            'items.*.material_id' => 'required|exists:materials,id',
            'items.*.quantity' => 'required|numeric|min:0.01',
            'items.*.note' => 'nullable|string|max:500',
        ]);
        // Gói 60: NV được chọn CN trong danh sách phân công
        $branchId = $isEmployee
            ? $this->resolveEmployeeBranch($actor, $v['branch_id'] ?? null)
            : (int) $v['branch_id'];
        $employeeId = $isEmployee ? (int) $actor->id : ($v['employee_id'] ?? null);

        $receipt = DB::transaction(function () use ($v, $request, $branchId, $employeeId) {
            $r = OutboundReceipt::create([
                'code' => OutboundReceipt::nextCode(),
                'branch_id' => $branchId,
                'employee_id' => $employeeId,
                'reason' => $v['reason'],
                'note' => $v['note'] ?? null,
                'status' => 'draft',
                'total_quantity' => 0,
                'created_by' => $request->user()?->id,
            ]);

            $total = 0;
            foreach ($v['items'] as $item) {
                $material = Material::findOrFail($item['material_id']);
                $r->items()->create([
                    'material_id' => $material->id,
                    'quantity' => $item['quantity'],
                    'unit' => $material->unit,
                    'note' => $item['note'] ?? null,
                ]);
                $total += (float) $item['quantity'];
            }
            $r->update(['total_quantity' => $total]);

            return $r->load(['items.material:id,name,unit', 'branch:id,name']);
        });

        return response()->json([
            'success' => true,
            'message' => "Đã tạo phiếu xuất {$receipt->code} ({$receipt->items->count()} dòng).",
            'data' => $receipt,
        ], 201);
    }

    /**
     * Chi tiết phiếu xuất kèm các dòng + nguyên liệu.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $receipt = OutboundReceipt::with([
            'items.material' => fn ($q) => $q->withTrashed(),
            'branch:id,name',
            'employee:id,name',
        ])->findOrFail($id);

        if ($deny = $this->denyReceiptBranch($request, $receipt->branch_id)) return $deny;
        $data = $receipt->toArray();
        $data['reason_label'] = $receipt->reason_label;

        return response()->json(['success' => true, 'data' => $data]);
    }

    /**
     * Chốt phiếu — trừ kho theo FIFO cho từng dòng.
     * Rollback toàn bộ nếu bất kỳ nguyên liệu nào không đủ tồn.
     */
    public function confirm(Request $request, int $id): JsonResponse
    {
        $receipt = OutboundReceipt::with('items')->findOrFail($id);
        if ($deny = $this->denyReceiptBranch($request, $receipt->branch_id)) return $deny;

        if ($receipt->status !== 'draft') {
            return response()->json([
                'success' => false,
                'message' => 'Chỉ chốt được phiếu đang ở trạng thái nháp.',
            ], 422);
        }

        try {
            $deducted = DB::transaction(function () use ($receipt) {
                // Khóa phiếu để 2 request không chốt trùng
                $locked = OutboundReceipt::where('id', $receipt->id)->lockForUpdate()->first();
                if ($locked->status !== 'draft') {
                    throw new \Exception('Phiếu đã được xử lý.');
                }

                $needs = [];
                foreach ($receipt->items as $item) {
                    $needs[$item->material_id] = ($needs[$item->material_id] ?? 0) + (float) $item->quantity;
                }

                $service = new InventoryService();
                // Gói 55 p11af: ghi nhật ký xuất kho từng lô
                $details = $service->deductMaterialsDetailed($receipt->branch_id, $needs, [
                    'type' => 'outbound',
                    'id' => $receipt->id,
                    'note' => 'Chốt phiếu xuất ' . $receipt->code,
                ]);

                // Gói "Chờ duyệt trên Hub" (2026-10-21): ghi vết người chốt (User hoặc Employee).
                // TESTER fix: chỉ fallback auth()->id() khi CẢ 2 đều null — ở Hub,
                // auth()->id() trả mã NV, ghi vào cột FK users sẽ vi phạm FK/sai người.
                [$confirmUserId, $confirmEmployeeId] = \App\Support\ApprovalActor::ids($request->user());
                if ($confirmUserId === null && $confirmEmployeeId === null) {
                    $confirmUserId = auth()->id();
                }
                $locked->update([
                    'status' => 'confirmed',
                    'confirmed_by' => $confirmUserId,
                    'confirmed_by_employee_id' => $confirmEmployeeId,
                    'confirmed_at' => now(),
                ]);

                return $details;
            });
        } catch (\Exception $e) {
            \Log::error('Outbound confirm failed', [
                'receipt_id' => $id,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => $this->clientErrorMessage($e),
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => "Đã chốt phiếu {$receipt->code}, trừ kho theo FIFO.",
            'data' => ['deducted' => $deducted],
        ]);
    }

    /**
     * Hủy phiếu — chỉ cho hủy khi còn nháp (giữ toàn vẹn số liệu đã chốt).
     */
    public function cancel(Request $request, int $id): JsonResponse
    {
        $receipt = OutboundReceipt::findOrFail($id);
        if ($deny = $this->denyReceiptBranch($request, $receipt->branch_id)) return $deny;

        if ($receipt->status !== 'draft') {
            return response()->json([
                'success' => false,
                'message' => 'Chỉ hủy được phiếu nháp. Phiếu đã chốt không thể hủy để giữ toàn vẹn số liệu kho.',
            ], 422);
        }

        // TESTER fix 🟡d: ghi vết NV hủy phiếu để hiện trong "Đã xử lý hôm nay" trên Hub
        [, $cancelEmployeeId] = \App\Support\ApprovalActor::ids();
        $receipt->update(['status' => 'cancelled', 'cancelled_by_employee_id' => $cancelEmployeeId]);

        return response()->json([
            'success' => true,
            'message' => "Đã hủy phiếu {$receipt->code}.",
        ]);
    }
}
