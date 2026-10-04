<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\ProductController;

Route::post('/login', [AuthController::class, 'login']);

// BẮT BUỘC ĐĂNG NHẬP MỚI ĐƯỢC GỌI CÁC API DƯỚI ĐÂY
Route::middleware('auth:sanctum')->group(function () {
    
    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    // API Quản lý Danh mục và Mặt hàng
    Route::apiResource('categories', CategoryController::class);
    Route::apiResource('products', ProductController::class);
    
});