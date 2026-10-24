<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\SapoImportRun;
use App\Models\SapoImportSuspect;
use App\Services\Sapo\SapoImportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// =====================================================================
// Cầu nối Sapo — Phần A (2026-10-21): API import file Excel Sapo thủ công
// (upload tại Admin) + xem nhật ký các lần import.
// - Phần B bổ sung API map/cấu hình; Phần C gọi cùng service qua IMAP;
//   Phần D bổ sung API xử lý hàng đợi "nghi ngờ".
// =====================================================================
class SapoImportController extends Controller
{
    public function __construct(private SapoImportService $service)
    {
    }

    /** POST /api/sapo/import — upload file Excel Sapo cho 1 chi nhánh, import ngay */
    public function import(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => 'required|file|mimes:xlsx,xls|max:10240',
            'branch_id' => 'required|integer|exists:branches,id',
        ]);

        $file = $request->file('file');
        $run = $this->service->importFile(
            $file->getRealPath(),
            $file->getClientOriginalName(),
            (int) $validated['branch_id'],
            'upload',
            $request->user()?->id
        );

        if ($run->status === 'error') {
            return response()->json([
                'success' => false,
                'message' => $run->error,
                'data' => $run,
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Import xong: tạo mới ' . $run->created_count . ' đơn, nghi ngờ ' . $run->suspect_count . ' đơn.',
            'data' => $run,
        ]);
    }

    /** GET /api/sapo/import-runs — danh sách các lần import gần nhất */
    public function runs(Request $request): JsonResponse
    {
        $runs = SapoImportRun::with('branch:id,name')
            ->orderByDesc('id')
            ->limit(min(100, max(1, (int) $request->query('limit', 30))))
            ->get();

        return response()->json(['success' => true, 'data' => $runs]);
    }

    /** GET /api/sapo/import-runs/{id} — chi tiết 1 lần import + danh sách nghi ngờ */
    public function runDetail(int $id): JsonResponse
    {
        $run = SapoImportRun::with(['branch:id,name', 'suspects' => fn($q) => $q->orderBy('id')->limit(500)])
            ->findOrFail($id);

        return response()->json(['success' => true, 'data' => $run]);
    }

    // ---------------- Phần D: hàng đợi "nghi ngờ" ----------------

    /** GET /api/sapo/suspects?status=pending&reason=&q= — danh sách nghi ngờ */
    public function suspects(Request $request): JsonResponse
    {
        $query = SapoImportSuspect::with(['branch:id,name', 'run:id,filename,source', 'resolvedBy:id,name'])
            ->orderByDesc('id');
        $status = (string) $request->query('status', 'pending');
        if ($status !== 'all') {
            $query->where('status', $status);
        }
        if ($reason = trim((string) $request->query('reason', ''))) {
            $query->where('reason', $reason);
        }
        if ($q = trim((string) $request->query('q', ''))) {
            $query->where('sapo_invoice_code', 'like', '%' . $q . '%');
        }
        $rows = $query->limit(300)->get();

        return response()->json(['success' => true, 'data' => $rows]);
    }

    /** POST /api/sapo/suspects/{id}/rerun — chạy lại từ payload sau khi đã map/xử lý */
    public function suspectRerun(Request $request, int $id): JsonResponse
    {
        $suspect = SapoImportSuspect::findOrFail($id);
        if ($err = $this->guardPending($suspect)) {
            return $err;
        }
        $res = $this->service->importInvoice($suspect->payload, (int) $suspect->branch_id);
        return $this->applyRerunResult($request, $suspect, $res, 'Đã chạy lại thành công.');
    }

    /** POST /api/sapo/suspects/{id}/force-create — quản lý xác nhận là đơn mới thật (bỏ qua chốt chặn nghi trùng) */
    public function suspectForceCreate(Request $request, int $id): JsonResponse
    {
        $suspect = SapoImportSuspect::findOrFail($id);
        if ($err = $this->guardPending($suspect)) {
            return $err;
        }
        $res = $this->service->importInvoice($suspect->payload, (int) $suspect->branch_id, true);
        return $this->applyRerunResult($request, $suspect, $res, 'Quản lý xác nhận là đơn mới thật — đã tạo đơn và trừ kho.');
    }

    /** POST /api/sapo/suspects/{id}/discard — bỏ qua hẳn, có ghi lý do xử lý */
    public function suspectDiscard(Request $request, int $id): JsonResponse
    {
        $suspect = SapoImportSuspect::findOrFail($id);
        if ($err = $this->guardPending($suspect)) {
            return $err;
        }
        $data = $request->validate(['resolution' => 'nullable|string|max:255']);
        $suspect->update([
            'status' => 'discarded',
            'resolution' => $data['resolution'] ?? 'Quản lý bỏ qua.',
            'resolved_by' => $request->user()?->id,
            'resolved_at' => now(),
        ]);
        return response()->json(['success' => true, 'message' => 'Đã bỏ qua nghi ngờ này.', 'data' => $suspect->fresh()]);
    }

    private function guardPending(SapoImportSuspect $suspect): ?JsonResponse
    {
        if ($suspect->status !== 'pending') {
            return response()->json([
                'success' => false,
                'message' => 'Nghi ngờ này đã được xử lý (' . $suspect->status . ') — không chạy lại lần 2.',
            ], 422);
        }
        if (!$suspect->branch_id) {
            return response()->json([
                'success' => false,
                'message' => 'Nghi ngờ không gắn chi nhánh — không thể chạy lại.',
            ], 422);
        }
        return null;
    }

    private function applyRerunResult(Request $request, SapoImportSuspect $suspect, array $res, string $createdNote): JsonResponse
    {
        switch ($res['result']) {
            case 'created':
                $suspect->update([
                    'status' => 'resolved',
                    'resolved_order_id' => $res['order_id'] ?? null,
                    'resolution' => $createdNote,
                    'resolved_by' => $request->user()?->id,
                    'resolved_at' => now(),
                ]);
                return response()->json(['success' => true, 'message' => 'Đã tạo đơn thành công.', 'data' => $suspect->fresh()]);
            case 'duplicate':
                $existing = Order::where('sapo_invoice_code', $suspect->sapo_invoice_code)->first(['id']);
                $suspect->update([
                    'status' => 'resolved',
                    'resolved_order_id' => $existing?->id,
                    'resolution' => 'Đơn đã có trong DBOMNI (trùng mã hóa đơn) — không tạo lại.',
                    'resolved_by' => $request->user()?->id,
                    'resolved_at' => now(),
                ]);
                return response()->json(['success' => true, 'message' => 'Đơn đã tồn tại — đã đóng nghi ngờ.', 'data' => $suspect->fresh()]);
            case 'dbomni':
                $suspect->update([
                    'status' => 'resolved',
                    'resolution' => 'Đơn thuộc kênh DBOMNI — bỏ qua theo quy tắc lọc kênh.',
                    'resolved_by' => $request->user()?->id,
                    'resolved_at' => now(),
                ]);
                return response()->json(['success' => true, 'message' => 'Đơn kênh DBOMNI — đã đóng nghi ngờ.', 'data' => $suspect->fresh()]);
            case 'cancelled':
                $suspect->update([
                    'status' => 'resolved',
                    'resolution' => 'Hóa đơn đã hủy trên Sapo.',
                    'resolved_by' => $request->user()?->id,
                    'resolved_at' => now(),
                ]);
                return response()->json(['success' => true, 'message' => 'Hóa đơn đã hủy — đã đóng nghi ngờ.', 'data' => $suspect->fresh()]);
            default: // vẫn nghi ngờ (có thể đã đổi lý do sau khi map thêm)
                $suspect->update([
                    'reason' => $res['reason'] ?? $suspect->reason,
                    'detail' => $res['detail'] ?? $suspect->detail,
                ]);
                return response()->json([
                    'success' => true,
                    'message' => 'Vẫn chưa import được: ' . ($res['detail'] ?? ($res['reason'] ?? 'chưa rõ lý do')),
                    'data' => $suspect->fresh(),
                ]);
        }
    }
}
