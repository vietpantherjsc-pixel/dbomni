<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\LeaveRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Gói 35: Yêu cầu nghỉ / đổi ca — NV tạo, admin duyệt/từ chối.
class LeaveRequestController extends Controller
{
    // NV tạo yêu cầu (chỉ của chính mình)
    public function store(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $v = $request->validate([
            'type' => 'required|in:nghi,doica,khac',
            'date_from' => 'required|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'reason' => 'nullable|string|max:500',
        ]);
        $lr = LeaveRequest::create($v + ['employee_id' => $emp->id]);
        return response()->json(['success' => true, 'message' => 'Đã gửi yêu cầu, chờ quản lý duyệt.', 'data' => $lr]);
    }

    // NV xem yêu cầu của mình
    public function myList(Request $request): JsonResponse
    {
        /** @var Employee $emp */
        $emp = $request->user();
        $items = LeaveRequest::where('employee_id', $emp->id)->orderBy('created_at', 'desc')->get();
        return response()->json(['success' => true, 'data' => $items]);
    }

    // Admin: danh sách (lọc theo trạng thái)
    public function index(Request $request): JsonResponse
    {
        $q = LeaveRequest::with('employee:id,full_name,branch_id')->orderBy('created_at', 'desc');
        if ($request->filled('status')) $q->where('status', $request->string('status'));
        return response()->json(['success' => true, 'data' => $q->get()]);
    }

    public function approve(Request $request, int $id): JsonResponse
    {
        $lr = LeaveRequest::findOrFail($id);
        $lr->update(['status' => 'approved', 'handled_by' => $request->user()?->id]);
        return response()->json(['success' => true, 'message' => 'Đã duyệt yêu cầu.']);
    }

    public function reject(Request $request, int $id): JsonResponse
    {
        $lr = LeaveRequest::findOrFail($id);
        $lr->update(['status' => 'rejected', 'handled_by' => $request->user()?->id]);
        return response()->json(['success' => true, 'message' => 'Đã từ chối yêu cầu.']);
    }
}
