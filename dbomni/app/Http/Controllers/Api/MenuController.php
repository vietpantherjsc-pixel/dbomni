<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;

class MenuController extends Controller
{
    /**
     * Lấy toàn bộ thực đơn kèm danh mục và tùy chọn cho Zalo Mini App
     */
    public function index(): JsonResponse
    {
        $menu = Category::where('is_active', true)
            ->orderBy('order', 'asc')
            ->with(['products' => function ($query) {
                $query->where('is_active', true)
                      ->with('options');
            }])
            ->get();

        // Eager load cả products và options của từng product
        $categories = \App\Models\Category::with(['products.options'])->get();

        return response()->json([
            'success' => true,
            'message' => 'Lấy danh sách thực đơn thành công',
            'data' => $menu
        ], 200);
    }
}