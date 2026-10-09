<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;

class MenuController extends Controller
{
    /**
     * Lấy toàn bộ thực đơn kèm danh mục và tùy chọn cho Zalo Mini App.
     *
     * Gói 1 (2026-10-04): Sửa orderBy('order') -> orderBy('sort_order') cho khớp
     * schema bảng categories; xóa query thừa không dùng tới.
     */
    public function index(): JsonResponse
    {
        $menu = Category::where('is_active', true)
            ->orderBy('sort_order', 'asc')
            ->with(['products' => function ($query) {
                $query->where('is_active', true)
                    ->where('is_service_fee', false) // Gói 6: ẩn món "Phí dịch vụ" (hệ thống tự tính)
                    ->with(['options', 'optionGroups' => function ($q) {
                        // Gói 7b: nhóm tùy chọn (Size/Độ ngọt/Đá/Topping) kèm options
                        // Gói 34e: sắp xếp nhóm tùy chọn theo sort_order của admin
                        $q->where('is_active', true)->orderBy('sort_order')->orderBy('id')
                            ->with(['options' => fn($qq) => $qq->orderBy('sort_order')->orderBy('id')]);
                    }]);
            }])
            ->get();

        return response()->json([
            'success' => true,
            'message' => 'Lấy danh sách thực đơn thành công',
            'data' => $menu
        ], 200);
    }
}
