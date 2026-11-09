<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PurchaseOrder;
use App\Services\PurchaseOrderService;
use App\Support\ApprovalActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Spec Phiếu đặt hàng NCC (2026-11-08) — bề mặt Admin. Toàn bộ logic ở
// PurchaseOrderService (dùng chung với Hub, T-11). Nhóm route:
// permission:inventory.manage. Phiếu đặt KHÔNG qua hàng chờ duyệt.
class PurchaseOrderController extends Controller
{
    use \App\Traits\ValidatesEmployeeBranch;

    public function __construct(private PurchaseOrderService $svc)
    {
    }

    // Vá khẩn cách ly chi nhánh (TESTER bấm sống 2026-11-08): khuôn
    // denyReceiptBranch của InboundReceiptController — actor là Employee
    // (NV có inventory.manage qua role vẫn vào được bề mặt này) thì phiếu
    // ngoài chi nhánh phân công coi như không tồn tại (404 như bề mặt Hub).
    // Actor User (admin) không bị gác.
    protected function denyPoBranch(Request $request, $branchId): ?JsonResponse
    {
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee && !in_array((int) $branchId, $actor->allBranchIds(), true)) {
            return response()->json(['success' => false, 'message' => 'Không tìm thấy phiếu đặt hàng.'], 404);
        }
        return null;
    }

    public function index(Request $request): JsonResponse
    {
        $q = PurchaseOrder::with(['branch', 'partner', 'createdByUser', 'createdByEmployee.role', 'items'])
            ->orderByDesc('id');
        // Khuôn inbound index: NV tự thu danh sách về các CN được phân công
        $actor = $request->user();
        if ($actor instanceof \App\Models\Employee) {
            $q->whereIn('branch_id', $actor->allBranchIds());
        }
        if ($request->filled('branch_id')) $q->where('branch_id', $request->input('branch_id'));
        if ($request->filled('status')) $q->where('status', $request->input('status'));
        if ($request->filled('partner_id')) $q->where('partner_id', $request->input('partner_id'));
        if ($request->filled('search')) $q->where('code', 'like', '%' . $request->input('search') . '%');
        $per = min((int) $request->input('per_page', 20), 200);
        $page = $q->paginate($per);
        $page->getCollection()->transform(fn ($po) => $this->svc->present($po));
        return response()->json(['success' => true, 'data' => $page]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $po = PurchaseOrder::findOrFail($id);
        if ($deny = $this->denyPoBranch($request, $po->branch_id)) return $deny;
        return response()->json(['success' => true, 'data' => $this->svc->present($po, true)]);
    }

    public function store(Request $request): JsonResponse
    {
        $v = $this->svc->validatePayload($request, true);
        $actor = $request->user();
        // Khuôn inbound store: NV tạo thì chi nhánh resolve theo phân công
        // (gửi CN ngoài phân công → rơi về CN chính của NV, không lọt CN lạ)
        $branchId = $actor instanceof \App\Models\Employee
            ? $this->resolveEmployeeBranch($actor, $v['branch_id'])
            : (int) $v['branch_id'];
        [$userId, $employeeId] = ApprovalActor::ids($request->user());
        $po = $this->svc->create($v, $branchId, $userId, $employeeId);
        return response()->json([
            'success' => true,
            'message' => 'Đã tạo phiếu đặt hàng ' . $po->code . '.',
            'data' => $this->svc->present($po, true),
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $po = PurchaseOrder::findOrFail($id);
        if ($deny = $this->denyPoBranch($request, $po->branch_id)) return $deny;
        $v = $this->svc->validatePayload($request, true);
        // NV sửa nháp: chi nhánh của phiếu đứng yên (không dời phiếu sang CN
        // khác qua payload); admin giữ quyền đổi CN cho phiếu nháp như spec.
        if ($request->user() instanceof \App\Models\Employee) {
            $v['branch_id'] = $po->branch_id;
        }
        $po = $this->svc->updateDraft($po, $v);
        return response()->json([
            'success' => true,
            'message' => 'Đã cập nhật phiếu đặt hàng ' . $po->code . '.',
            'data' => $this->svc->present($po, true),
        ]);
    }

    public function markOrdered(Request $request, int $id): JsonResponse
    {
        $po = PurchaseOrder::findOrFail($id);
        if ($deny = $this->denyPoBranch($request, $po->branch_id)) return $deny;
        $po = $this->svc->markOrdered($po);
        return response()->json([
            'success' => true,
            'message' => 'Đã chuyển phiếu ' . $po->code . ' sang Đã đặt.',
            'data' => $this->svc->present($po, true),
        ]);
    }

    public function cancel(Request $request, int $id): JsonResponse
    {
        $po = PurchaseOrder::findOrFail($id);
        if ($deny = $this->denyPoBranch($request, $po->branch_id)) return $deny;
        [$userId, $employeeId] = ApprovalActor::ids($request->user());
        $po = $this->svc->cancel($po, $userId, $employeeId);
        return response()->json([
            'success' => true,
            'message' => 'Đã hủy phiếu đặt hàng ' . $po->code . '.',
            'data' => $this->svc->present($po, true),
        ]);
    }
}
