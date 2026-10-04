<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\InboundController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ShiftController;

Route::post('/login', [AuthController::class, 'login']);

// BẮT BUỘC ĐĂNG NHẬP MỚI ĐƯỢC GỌI CÁC API DƯỚI ĐÂY
// Gói 1 (2026-10-04): Route hóa toàn bộ controllers (trước đây 6/9 controller chưa có route).
Route::middleware('auth:sanctum')->group(function () {

    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    // Danh mục & mặt hàng
    Route::apiResource('categories', CategoryController::class);
    Route::apiResource('products', ProductController::class);

    // Thực đơn (POS / Zalo Mini App)
    Route::get('/menu', [MenuController::class, 'index']);

    // Chi nhánh (dropdown)
    Route::get('/branches', [BranchController::class, 'index']);

    // Đơn hàng
    Route::post('/orders', [OrderController::class, 'store']);
    Route::get('/orders/history', [OrderController::class, 'history']);
    Route::get('/orders/code/{code}', [OrderController::class, 'showByCode']);
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus']);
    Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel']);

    // Màn hình bếp/bar (KDS) — frontend poll mỗi 3s
    Route::get('/kds/orders', [OrderController::class, 'kdsOrders']);

    // Ca làm việc
    Route::get('/shifts/current', [ShiftController::class, 'currentShift']);
    Route::post('/shifts/open', [ShiftController::class, 'openShift']);
    Route::post('/shifts/{id}/expense', [ShiftController::class, 'addExpense']);
    Route::post('/shifts/{id}/close', [ShiftController::class, 'closeShift']);

    // Kho
    Route::get('/inventory/branch/{branchId}', [InventoryController::class, 'getStockByBranch']);
    Route::post('/inbound', [InboundController::class, 'store']);

    // Quản trị
    Route::get('/admin/dashboard/stats', [AdminDashboardController::class, 'stats']);
    Route::post('/admin/inventory/inward', [InboundController::class, 'store']);
});
