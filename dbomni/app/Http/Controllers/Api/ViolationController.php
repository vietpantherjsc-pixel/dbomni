<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\User;
use App\Models\Violation;
use App\Models\ViolationType;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 40: Lỗi 3 Chuyên — ghi nhận vi phạm (quản lý ghi / NV tự báo), danh mục loại lỗi.
class ViolationController extends Controller
{
    private function serialize(Violation $v): array
    {
        $v->loadMissing(['employee:id,full_name', 'type:id,category,name']);
        return [
            'id' => $v->id,
            'employee_id' => $v->employee_id,
            'employee_name' => $v->employee?->full_name,
            'violation_type_id' => $v->violation_type_id,
            'violation_name' => $v->violation_name,
            'category' => $v->type?->category,
            'category_name' => $v->type ? ViolationType::CATEGORIES[$v->type->category] ?? null : null,
            'points' => (int) $v->points,
            'date' => $v->date?->format('Y-m-d'),
            'note' => $v->note,
            'source' => $v->source,
            'source_label' => $v->source === 'self' ? 'NV tự báo' : 'Quản lý ghi',
            'created_at' => $v->created_at?->format('Y-m-d H:i'),
        ];
    }

    private function monthRange(Request $request): array
    {
        $month = $request->query('month', Carbon::now()->format('Y-m'));
        if (!preg_match('/^\d{4}-\d{2}$/', (string) $month)) {
            abort(response()->json(['success' => false, 'message' => 'Tháng không hợp lệ (YYYY-MM).'], 422));
        }
        $start = Carbon::createFromFormat('Y-m-d', $month . '-01')->startOfDay();
        return [$month, $start->toDateString(), $start->copy()->endOfMonth()->toDateString()];
    }

    // GET /api/violations?month=YYYY-MM&employee_id=&branch_id=
    public function index(Request $request): JsonResponse
    {
        [$month, $from, $to] = $this->monthRange($request);
        $q = Violation::with(['employee:id,full_name', 'type:id,category,name'])
            ->whereBetween('date', [$from, $to]);
        if ($request->filled('employee_id')) $q->where('employee_id', $request->integer('employee_id'));
        if ($request->filled('branch_id')) $q->where('branch_id', $request->integer('branch_id'));
        $items = $q->orderBy('date', 'desc')->orderBy('id', 'desc')->get()
            ->map(fn ($v) => $this->serialize($v));
        return response()->json(['success' => true, 'data' => ['month' => $month, 'items' => $items]]);
    }

    // POST /api/violations  (quản lý ghi)
    public function store(Request $request): JsonResponse
    {
        $v = $request->validate([
            'employee_id' => 'required|exists:employees,id',
            'violation_type_id' => 'required|exists:violation_types,id',
            'points' => 'nullable|integer|min:1|max:100',
            'date' => 'required|date_format:Y-m-d',
            'note' => 'nullable|string|max:255',
        ]);
        $type = ViolationType::findOrFail($v['violation_type_id']);
        $emp = Employee::findOrFail($v['employee_id']);
        $actor = $request->user();
        $item = Violation::create([
            'employee_id' => $emp->id,
            'violation_type_id' => $type->id,
            'violation_name' => $type->name,
            'points' => $v['points'] ?? $type->default_points,
            'date' => $v['date'],
            'note' => $v['note'] ?? null,
            'source' => 'manager',
            'created_by' => $actor instanceof User ? $actor->id : null,
            'branch_id' => $emp->branch_id,
        ]);
        return response()->json(['success' => true, 'data' => $this->serialize($item)], 201);
    }

    // PUT /api/violations/{id}
    public function update(Request $request, int $id): JsonResponse
    {
        $item = Violation::findOrFail($id);
        $v = $request->validate([
            'violation_type_id' => 'nullable|exists:violation_types,id',
            'points' => 'nullable|integer|min:1|max:100',
            'date' => 'nullable|date_format:Y-m-d',
            'note' => 'nullable|string|max:255',
        ]);
        if (!empty($v['violation_type_id'])) {
            $type = ViolationType::findOrFail($v['violation_type_id']);
            $item->violation_type_id = $type->id;
            $item->violation_name = $type->name; // đổi loại → sync lại tên
        }
        if (isset($v['points'])) $item->points = $v['points'];
        if (isset($v['date'])) $item->date = $v['date'];
        if (array_key_exists('note', $v)) $item->note = $v['note'];
        $item->save();
        return response()->json(['success' => true, 'data' => $this->serialize($item)]);
    }

    // DELETE /api/violations/{id}
    public function destroy(int $id): JsonResponse
    {
        Violation::findOrFail($id)->delete();
        return response()->json(['success' => true]);
    }

    // GET /api/violations/summary?month=YYYY-MM → tổng điểm lỗi theo NV
    public function summary(Request $request): JsonResponse
    {
        [$month, $from, $to] = $this->monthRange($request);
        $rows = Violation::whereBetween('date', [$from, $to])
            ->selectRaw('employee_id, SUM(points) as total_points')
            ->groupBy('employee_id')->get()
            ->map(fn ($r) => ['employee_id' => (int) $r->employee_id, 'total_points' => (int) $r->total_points]);
        return response()->json(['success' => true, 'data' => ['month' => $month, 'items' => $rows]]);
    }

    // ---------- Danh mục loại lỗi ----------
    // GET /api/violation-types
    public function typesIndex(): JsonResponse
    {
        $items = ViolationType::orderBy('category')->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($t) => [
                'id' => $t->id, 'category' => $t->category,
                'category_name' => ViolationType::CATEGORIES[$t->category] ?? $t->category,
                'name' => $t->name, 'default_points' => (int) $t->default_points,
                'sort_order' => (int) $t->sort_order, 'is_active' => (bool) $t->is_active,
            ]);
        return response()->json(['success' => true, 'data' => $items]);
    }

    // POST /api/violation-types
    public function typesStore(Request $request): JsonResponse
    {
        $v = $request->validate([
            'category' => 'required|in:chuyen_can,chuyen_mon,chuyen_nghiep',
            'name' => 'required|string|max:255',
            'default_points' => 'required|integer|min:1|max:100',
            'sort_order' => 'nullable|integer|min:0',
        ]);
        $t = ViolationType::create([
            'category' => $v['category'], 'name' => $v['name'],
            'default_points' => $v['default_points'], 'sort_order' => $v['sort_order'] ?? 0,
            'is_active' => true,
        ]);
        return response()->json(['success' => true, 'data' => $t], 201);
    }

    // PUT /api/violation-types/{id}
    public function typesUpdate(Request $request, int $id): JsonResponse
    {
        $t = ViolationType::findOrFail($id);
        $v = $request->validate([
            'name' => 'nullable|string|max:255',
            'default_points' => 'nullable|integer|min:1|max:100',
            'is_active' => 'nullable|boolean',
            'sort_order' => 'nullable|integer|min:0',
        ]);
        $t->fill(array_filter($v, fn ($x) => $x !== null));
        $t->save();
        return response()->json(['success' => true, 'data' => $t]);
    }

    // DELETE /api/violation-types/{id}
    public function typesDestroy(int $id): JsonResponse
    {
        $t = ViolationType::findOrFail($id);
        if (Violation::where('violation_type_id', $id)->exists()) {
            return response()->json(['success' => false, 'message' => 'Loại lỗi đang được sử dụng, không thể xóa. Hãy tắt trạng thái thay vì xóa.'], 422);
        }
        $t->delete();
        return response()->json(['success' => true]);
    }

    // ---------- NV tự báo (token nhân viên) ----------
    // GET /api/employee/my-violations?month=YYYY-MM
    public function myIndex(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        [$month, $from, $to] = $this->monthRange($request);
        $items = Violation::with(['type:id,category,name'])
            ->where('employee_id', $emp->id)
            ->whereBetween('date', [$from, $to])
            ->orderBy('date', 'desc')->get()
            ->map(fn ($v) => $this->serialize($v));
        return response()->json(['success' => true, 'data' => ['month' => $month, 'items' => $items]]);
    }

    // POST /api/employee/my-violations
    public function myStore(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'violation_type_id' => 'required|exists:violation_types,id',
            'date' => 'required|date_format:Y-m-d',
            'note' => 'nullable|string|max:255',
            'points' => 'nullable|integer|min:1|max:100', // NV được sửa tay số lỗi
        ]);
        $type = ViolationType::where('id', $v['violation_type_id'])->where('is_active', true)->firstOrFail();
        $item = Violation::create([
            'employee_id' => $emp->id,
            'violation_type_id' => $type->id,
            'violation_name' => $type->name,
            'points' => $v['points'] ?? $type->default_points,
            'date' => $v['date'],
            'note' => $v['note'] ?? null,
            'source' => 'self',
            'created_by' => null,
            'branch_id' => $emp->branch_id,
        ]);
        return response()->json(['success' => true, 'data' => $this->serialize($item)], 201);
    }

    // GET /api/employee/violation-types — danh mục cho NV tự báo
    public function employeeTypes(): JsonResponse
    {
        $items = ViolationType::where('is_active', true)
            ->orderBy('category')->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn ($t) => [
                'id' => $t->id, 'category' => $t->category,
                'category_name' => ViolationType::CATEGORIES[$t->category] ?? $t->category,
                'name' => $t->name, 'default_points' => (int) $t->default_points,
            ]);
        return response()->json(['success' => true, 'data' => $items]);
    }
}
