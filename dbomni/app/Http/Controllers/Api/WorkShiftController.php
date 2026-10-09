<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WorkShift;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 35: Quản lý ca làm việc (KHÁC ca thu ngân của ShiftController Gói 1).
class WorkShiftController extends Controller
{
    // Gói 35b: chuẩn hóa giờ về dạng 24h "H:i" trước khi validate
    // (chấp nhận "07:00:00", "07:00 AM"/"1:00 PM" từ client gửi sai định dạng)
    private function normTime(?string $v): ?string
    {
        if ($v === null || trim($v) === '') return $v;
        $v = trim($v);
        if (preg_match('/^(\d{1,2}):(\d{2})(?::\d{2})?$/', $v, $m)) {
            return sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
        }
        if (preg_match('/^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i', $v, $m)) {
            $h = ((int) $m[1]) % 12 + (strtoupper($m[3]) === 'P' ? 12 : 0);
            return sprintf('%02d:%02d', $h, (int) $m[2]);
        }
        return $v; // để validation báo lỗi như cũ
    }

    private function normTimes(Request $request, array $fields): void
    {
        $merge = [];
        foreach ($fields as $f) {
            if ($request->filled($f)) $merge[$f] = $this->normTime($request->input($f));
        }
        if ($merge) $request->merge($merge);
    }
    public function index(Request $request): JsonResponse
    {
        $q = WorkShift::orderBy('sort_order')->orderBy('id');
        if ($request->filled('branch_id')) {
            $q->where(function ($qq) use ($request) {
                $qq->whereNull('branch_id')->orWhere('branch_id', $request->integer('branch_id'));
            });
        }
        if ($request->boolean('active_only')) $q->where('is_active', true);
        return response()->json(['success' => true, 'data' => $q->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->normTimes($request, ['start_time', 'end_time']);
        $v = $request->validate([
            'name' => 'required|string|max:100',
            'branch_id' => 'nullable|exists:branches,id',
            'start_time' => 'required|date_format:H:i',
            'end_time' => 'required|date_format:H:i',
            'is_active' => 'boolean',
        ]);
        $v['sort_order'] = (int) WorkShift::max('sort_order') + 1;
        $shift = WorkShift::create($v);
        return response()->json(['success' => true, 'message' => 'Đã thêm ca làm việc.', 'data' => $shift]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $shift = WorkShift::findOrFail($id);
        $this->normTimes($request, ['start_time', 'end_time']);
        $v = $request->validate([
            'name' => 'sometimes|string|max:100',
            'branch_id' => 'nullable|exists:branches,id',
            'start_time' => 'sometimes|date_format:H:i',
            'end_time' => 'sometimes|date_format:H:i',
            'is_active' => 'boolean',
        ]);
        $shift->update($v);
        return response()->json(['success' => true, 'message' => 'Đã cập nhật ca.', 'data' => $shift]);
    }

    public function destroy(int $id): JsonResponse
    {
        $shift = WorkShift::findOrFail($id);
        if ($shift->registrations()->exists() || $shift->schedules()->exists()) {
            return response()->json(['success' => false, 'message' => 'Ca đã có đăng ký/xếp lịch, chỉ được tắt thay vì xóa.'], 422);
        }
        $shift->delete();
        return response()->json(['success' => true, 'message' => 'Đã xóa ca.']);
    }

    public function reorder(Request $request): JsonResponse
    {
        $ids = $request->validate(['ids' => 'required|array'])['ids'];
        foreach (array_values($ids) as $i => $id) {
            WorkShift::where('id', $id)->update(['sort_order' => $i]);
        }
        return response()->json(['success' => true, 'message' => 'Đã lưu thứ tự ca.']);
    }
}
