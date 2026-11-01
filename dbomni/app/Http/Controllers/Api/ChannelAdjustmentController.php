<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\ChannelMonthlyAdjustment;
use App\Models\Employee;
use App\Models\PriceList;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

// Gói "PNL kênh sàn đầy đủ" (2026-10-31): nhập phí marketing sàn theo
// (kênh × chi nhánh × tháng). Route nằm trong nhóm permission:finance.manage
// (mirror CheckPermission) như phiếu thu-chi. Chỉ 1 con số: marketing_fee.
class ChannelAdjustmentController extends Controller
{
    /** [actor_id, actor_type] của người đang thao tác (User admin hoặc Employee) */
    private function actor(Request $request): array
    {
        $u = $request->user();
        if (!$u) {
            return [null, null];
        }
        return [(int) $u->id, $u instanceof Employee ? 'employee' : 'user'];
    }

    /** Employee chỉ ghi được dòng của chi nhánh mình phụ trách (User admin: toàn chuỗi) */
    private function assertBranchScope(Request $request, int $branchId): void
    {
        $u = $request->user();
        if ($u instanceof Employee && !in_array($branchId, $u->allBranchIds(), true)) {
            abort(403, 'Chi nhánh này không thuộc phạm vi phụ trách của bạn.');
        }
    }

    private function actorName(?int $id, ?string $type): ?string
    {
        if (!$id || !$type) {
            return null;
        }
        return $type === 'employee'
            ? (Employee::find($id)->name ?? null)
            : (User::find($id)->name ?? null);
    }

    private function present(ChannelMonthlyAdjustment $row): array
    {
        return [
            'id' => (int) $row->id,
            'channel_code' => $row->channel_code,
            'branch_id' => (int) $row->branch_id,
            'branch' => $row->branch->name ?? null,
            'month' => $row->month->format('Y-m'),
            'marketing_fee' => (float) $row->marketing_fee,
            'note' => $row->note,
            'status' => $row->status,
            'void_reason' => $row->void_reason,
            'created_by_name' => $this->actorName($row->created_by ? (int) $row->created_by : null, $row->created_by_type),
            'updated_by_name' => $this->actorName($row->updated_by ? (int) $row->updated_by : null, $row->updated_by_type),
            'voided_by_name' => $this->actorName($row->voided_by ? (int) $row->voided_by : null, $row->voided_by_type),
            'voided_at' => $row->voided_at?->format('d/m/Y H:i'),
            'updated_at' => $row->updated_at?->format('d/m/Y H:i'),
        ];
    }

    /** Kênh được phép nhập = bảng giá thuộc nhóm đối tác (sàn) */
    private function partnerLists()
    {
        return PriceList::where('category', 'partner')->orderBy('sort_order')->orderBy('id')
            ->get(['id', 'code', 'name', 'is_active']);
    }

    /** Danh sách dòng đối soát của 1 tháng (+ lọc chi nhánh nếu có) kèm meta kênh/CN cho giao diện dựng bảng */
    public function index(Request $request): JsonResponse
    {
        $monthStr = (string) $request->query('month', now()->format('Y-m'));
        try {
            $month = Carbon::createFromFormat('Y-m', $monthStr)->startOfMonth();
        } catch (\Throwable $e) {
            return response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (định dạng YYYY-MM).'], 422);
        }
        $branchId = (int) $request->query('branch_id', 0);
        $rows = ChannelMonthlyAdjustment::with('branch:id,name')
            ->whereDate('month', $month->toDateString())
            ->when($branchId > 0, fn($q) => $q->where('branch_id', $branchId))
            ->orderBy('branch_id')
            ->get()
            ->map(fn($r) => $this->present($r))
            ->all();
        return response()->json(['success' => true, 'data' => [
            'month' => $month->format('Y-m'),
            'channels' => $this->partnerLists()->map(fn($pl) => [
                'code' => $pl->code, 'name' => $pl->name, 'is_active' => (bool) $pl->is_active,
            ])->all(),
            'branches' => Branch::orderBy('id')->get(['id', 'name'])->map(fn($b) => [
                'id' => (int) $b->id, 'name' => $b->name,
            ])->all(),
            'rows' => $rows,
        ]]);
    }

    /** Validate phần chung của thao tác ghi; trả [dữ liệu sạch, priceList] hoặc ném lỗi validate */
    private function validateWrite(Request $request, bool $withKey): array
    {
        $rules = [
            'marketing_fee' => 'required|numeric|min:0',
            'note' => 'nullable|string|max:500',
        ];
        if ($withKey) {
            $rules += [
                'channel_code' => 'required|string|max:50',
                'branch_id' => 'required|integer|exists:branches,id',
                'month' => 'required|string|regex:/^\d{4}-\d{2}$/',
            ];
        }
        $data = $request->validate($rules);
        if ($withKey) {
            $pl = PriceList::whereRaw('LOWER(code) = ?', [mb_strtolower(trim($data['channel_code']))])->first();
            if (!$pl) {
                abort(422, 'Kênh không tồn tại trong bảng giá.');
            }
            if (($pl->category ?? null) !== 'partner') {
                abort(422, 'Chỉ nhập đối soát cho kênh sàn/đối tác — kênh tại quầy và kênh riêng không có đối soát sàn.');
            }
            $data['channel_code'] = $pl->code;
            $month = Carbon::createFromFormat('Y-m', $data['month'])->startOfMonth();
            if ($month->gt(now()->startOfMonth())) {
                abort(422, 'Không nhập đối soát cho tháng ở tương lai — số sàn chỉ có sau khi tháng kết thúc.');
            }
            $data['month_date'] = $month->toDateString();
        }
        return $data;
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateWrite($request, true);
        $this->assertBranchScope($request, (int) $data['branch_id']);
        [$actorId, $actorType] = $this->actor($request);

        $existing = ChannelMonthlyAdjustment::where('channel_code', $data['channel_code'])
            ->where('branch_id', $data['branch_id'])
            ->whereDate('month', $data['month_date'])
            ->first();
        if ($existing) {
            if ($existing->status === 'active') {
                return response()->json(['success' => false,
                    'message' => 'Đã có dòng đối soát cho kênh này ở chi nhánh trong tháng ' . $data['month']
                        . ' (dòng #' . $existing->id . ') — hãy sửa trực tiếp trên dòng đó.',
                    'data' => ['existing_id' => (int) $existing->id]], 422);
            }
            // Nhập lại sau hủy = mở lại chính dòng void và sửa số (không tạo dòng thứ hai)
            $existing->update([
                'status' => 'active',
                'marketing_fee' => $data['marketing_fee'],
                'note' => $data['note'] ?? null,
                'voided_by' => null, 'voided_by_type' => null, 'voided_at' => null, 'void_reason' => null,
                'updated_by' => $actorId, 'updated_by_type' => $actorType,
            ]);
            return response()->json(['success' => true, 'message' => 'Đã mở lại dòng đối soát đã hủy và cập nhật số.',
                'data' => $this->present($existing->fresh()->load('branch:id,name'))]);
        }

        $row = ChannelMonthlyAdjustment::create([
            'channel_code' => $data['channel_code'],
            'branch_id' => (int) $data['branch_id'],
            'month' => $data['month_date'],
            'marketing_fee' => $data['marketing_fee'],
            'note' => $data['note'] ?? null,
            'status' => 'active',
            'created_by' => $actorId, 'created_by_type' => $actorType,
            'updated_by' => $actorId, 'updated_by_type' => $actorType,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã lưu đối soát.',
            'data' => $this->present($row->load('branch:id,name'))]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $row = ChannelMonthlyAdjustment::findOrFail($id);
        $this->assertBranchScope($request, (int) $row->branch_id);
        if ($row->status !== 'active') {
            return response()->json(['success' => false, 'message' => 'Dòng đã hủy — hãy mở lại trước khi sửa số.'], 422);
        }
        $data = $this->validateWrite($request, false);
        [$actorId, $actorType] = $this->actor($request);
        $row->update([
            'marketing_fee' => $data['marketing_fee'],
            'note' => $data['note'] ?? null,
            'updated_by' => $actorId, 'updated_by_type' => $actorType,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã cập nhật.',
            'data' => $this->present($row->fresh()->load('branch:id,name'))]);
    }

    /** Hủy dòng đối soát (void) — bắt buộc lý do, dòng vẫn giữ để kiểm toán */
    public function voidAdjustment(Request $request, int $id): JsonResponse
    {
        $row = ChannelMonthlyAdjustment::findOrFail($id);
        $this->assertBranchScope($request, (int) $row->branch_id);
        if ($row->status === 'void') {
            return response()->json(['success' => false, 'message' => 'Dòng này đã ở trạng thái hủy.'], 422);
        }
        $data = $request->validate(['void_reason' => 'required|string|max:500']);
        [$actorId, $actorType] = $this->actor($request);
        $row->update([
            'status' => 'void',
            'voided_by' => $actorId, 'voided_by_type' => $actorType,
            'voided_at' => now(), 'void_reason' => $data['void_reason'],
            'updated_by' => $actorId, 'updated_by_type' => $actorType,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã hủy dòng đối soát.',
            'data' => $this->present($row->fresh()->load('branch:id,name'))]);
    }

    /** Mở lại dòng đã void (giữ nguyên số; sửa số qua update sau đó) */
    public function reopen(Request $request, int $id): JsonResponse
    {
        $row = ChannelMonthlyAdjustment::findOrFail($id);
        $this->assertBranchScope($request, (int) $row->branch_id);
        if ($row->status !== 'void') {
            return response()->json(['success' => false, 'message' => 'Dòng này đang hiệu lực, không cần mở lại.'], 422);
        }
        [$actorId, $actorType] = $this->actor($request);
        $row->update([
            'status' => 'active',
            'voided_by' => null, 'voided_by_type' => null, 'voided_at' => null, 'void_reason' => null,
            'updated_by' => $actorId, 'updated_by_type' => $actorType,
        ]);
        return response()->json(['success' => true, 'message' => 'Đã mở lại dòng đối soát.',
            'data' => $this->present($row->fresh()->load('branch:id,name'))]);
    }
}
