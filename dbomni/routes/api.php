<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\InboundController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DisplayMenuController;
use App\Http\Controllers\Api\GroupOrderController;
use App\Http\Controllers\Api\MaterialController;
use App\Http\Controllers\Api\MembershipTierController;
use App\Http\Controllers\Api\MenuAdminController;
use App\Http\Controllers\Api\OnlineOrderController;
use App\Http\Controllers\Api\OptionGroupController;
use App\Http\Controllers\Api\PriceListController;
use App\Http\Controllers\Api\ProductionController;
use App\Http\Controllers\Api\PromotionController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\StocktakeController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Api\TableController;
use App\Http\Controllers\Api\UploadController; // Gói 10f

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
    Route::patch('/products/{product}/favorite', [ProductController::class, 'toggleFavorite']); // Gói 9

    // Thực đơn (POS / Zalo Mini App)
    Route::get('/menu', [MenuController::class, 'index']);
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — POS dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index']);

    // Chi nhánh (dropdown)
    Route::get('/branches', [BranchController::class, 'index']);

    // Đơn hàng
    Route::get('/orders', [OrderController::class, 'index']);
    Route::post('/orders', [OrderController::class, 'store']);
    Route::get('/orders/history', [OrderController::class, 'history']);
    Route::get('/orders/code/{code}', [OrderController::class, 'showByCode']);
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus']);
    Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel']);
    Route::post('/orders/{id}/split', [OrderController::class, 'split']);   // Gói 3: tách đơn
    Route::post('/orders/merge', [OrderController::class, 'merge']);       // Gói 3: gộp đơn
    Route::get('/orders/held', [OrderController::class, 'heldOrders']);    // Gói 3b: danh sách đơn lưu
    Route::post('/orders/{id}/finalize', [OrderController::class, 'finalize']); // Gói 3b: thanh toán đơn lưu

    // Bàn phục vụ (Gói 3)
    Route::get('/tables', [TableController::class, 'index']);
    Route::post('/tables', [TableController::class, 'store']);
    Route::patch('/tables/{id}', [TableController::class, 'update']);
    Route::delete('/tables/{id}', [TableController::class, 'destroy']);

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
    Route::post('/inbound/bulk', [InboundController::class, 'storeBulk']);

    // Gói 4: nguyên vật liệu
    Route::get('/materials', [MaterialController::class, 'index']);
    Route::post('/materials', [MaterialController::class, 'store']);
    Route::patch('/materials/{id}', [MaterialController::class, 'update']);
    Route::delete('/materials/{id}', [MaterialController::class, 'destroy']);

    // Gói 4: chế biến bán thành phẩm
    Route::get('/production-recipes', [ProductionController::class, 'recipes']);
    Route::post('/production-recipes', [ProductionController::class, 'storeRecipe']);
    Route::delete('/production-recipes/{id}', [ProductionController::class, 'destroyRecipe']);
    Route::get('/productions', [ProductionController::class, 'index']);
    Route::post('/productions', [ProductionController::class, 'produce']);

    // Gói 4: kiểm kê kho
    Route::get('/stocktakes', [StocktakeController::class, 'index']);
    Route::get('/stocktakes/{id}', [StocktakeController::class, 'show']);
    Route::post('/stocktakes', [StocktakeController::class, 'store']);
    Route::patch('/stocktakes/{id}/counts', [StocktakeController::class, 'updateCounts']);
    Route::post('/stocktakes/{id}/confirm', [StocktakeController::class, 'confirm']);

    // Gói 5: CRM — khách hàng
    Route::get('/customers', [CustomerController::class, 'index']);
    Route::post('/customers', [CustomerController::class, 'store']);
    Route::get('/customers/{id}', [CustomerController::class, 'show']);
    Route::patch('/customers/{id}', [CustomerController::class, 'update']);
    Route::post('/customers/{id}/adjust-points', [CustomerController::class, 'adjustPoints']);

    // Gói 5: hạng thành viên + cấu hình quy đổi điểm
    Route::get('/membership-tiers', [MembershipTierController::class, 'index']);
    Route::post('/membership-tiers', [MembershipTierController::class, 'store']);
    Route::patch('/membership-tiers/{id}', [MembershipTierController::class, 'update']);
    Route::delete('/membership-tiers/{id}', [MembershipTierController::class, 'destroy']);
    Route::post('/membership-tiers/redeem-config', [MembershipTierController::class, 'updateRedeemConfig']);

    // Gói 5: khuyến mại
    Route::get('/promotions', [PromotionController::class, 'index']);
    Route::post('/promotions/eligible', [PromotionController::class, 'eligible']);
    Route::post('/promotions', [PromotionController::class, 'store']);
    Route::get('/promotions/{id}', [PromotionController::class, 'show']);
    Route::patch('/promotions/{id}', [PromotionController::class, 'update']);
    Route::delete('/promotions/{id}', [PromotionController::class, 'destroy']);

    // Gói 6: nhân viên xác nhận đơn online (đã nhận tiền -> trừ kho, vào KDS)
    Route::post('/orders/{id}/confirm-payment', [OnlineOrderController::class, 'confirmPayment']);

    // Gói 6: cấu hình bán online
    Route::post('/branches', [BranchController::class, 'store']);
    Route::patch('/branches/{id}', [BranchController::class, 'update']);

    // Gói 10f: upload ảnh cover Mini App (jpg/png/webp <= 1MB, tự crop 1200x500)
    Route::post('/uploads/cover', [UploadController::class, 'cover']);
    Route::post('/settings', [SettingsController::class, 'update']);
    Route::get('/settings', [SettingsController::class, 'index']); // Gói 8a: thuế & giá
    // Gói 7p: màu chủ đạo giao diện (Đại Vương tự pick)
    Route::get('/settings/theme', [SettingsController::class, 'theme']);

    // Gói 8a: kênh bán hàng (giá theo kênh)
    Route::get('/price-lists', [PriceListController::class, 'index']);
    Route::post('/price-lists', [PriceListController::class, 'store']);
    Route::post('/price-lists/reorder', [PriceListController::class, 'reorder']);
    Route::patch('/price-lists/{priceList}', [PriceListController::class, 'update']);
    Route::delete('/price-lists/{priceList}', [PriceListController::class, 'destroy']);

    // Gói 7b: nhóm tùy chọn
    Route::get('/option-groups', [OptionGroupController::class, 'index']);
    Route::post('/option-groups', [OptionGroupController::class, 'store']);
    Route::patch('/option-groups/{id}', [OptionGroupController::class, 'update']);
    Route::delete('/option-groups/{id}', [OptionGroupController::class, 'destroy']);
    Route::post('/option-groups/{id}/options', [OptionGroupController::class, 'storeOption']);
    Route::patch('/options/{id}', [OptionGroupController::class, 'updateOption']);
    Route::delete('/options/{id}', [OptionGroupController::class, 'destroyOption']);
    // Gói 8a: kéo-thả, gán mặt hàng, định mức tùy chọn
    Route::post('/option-groups/reorder', [OptionGroupController::class, 'reorder']);
    Route::post('/option-groups/{id}/options/reorder', [OptionGroupController::class, 'reorderOptions']);
    Route::get('/option-groups/{id}/products', [OptionGroupController::class, 'products']);
    Route::post('/option-groups/{id}/products', [OptionGroupController::class, 'assignProducts']);
    Route::get('/options/{id}/recipes', [OptionGroupController::class, 'optionRecipes']);
    Route::put('/options/{id}/recipes', [OptionGroupController::class, 'updateOptionRecipes']);

    // Gói 7f: quản lý thực đơn (POS/App)
    Route::get('/menus', [MenuAdminController::class, 'index']);
    Route::post('/menus', [MenuAdminController::class, 'store']);
    Route::post('/menus/reorder', [MenuAdminController::class, 'reorder']);
    Route::get('/menus/{id}', [MenuAdminController::class, 'show']);
    Route::patch('/menus/{id}', [MenuAdminController::class, 'update']);
    Route::delete('/menus/{id}', [MenuAdminController::class, 'destroy']);
    Route::post('/menus/{id}/products', [MenuAdminController::class, 'attachProduct']);
    Route::delete('/menus/{id}/products/{productId}', [MenuAdminController::class, 'detachProduct']);
    Route::post('/menus/{id}/products/reorder', [MenuAdminController::class, 'reorderProducts']);
    Route::get('/menus/{id}/search-products', [MenuAdminController::class, 'searchProducts']);

    // Quản trị
    Route::get('/admin/dashboard/stats', [AdminDashboardController::class, 'stats']);
    Route::post('/admin/inventory/inward', [InboundController::class, 'store']);
});

// Gói 6: API public cho Zalo Mini App (không cần đăng nhập, định danh bằng SĐT)
Route::prefix('online')->group(function () {
    Route::get('/branches', [OnlineOrderController::class, 'branches']);
    Route::get('/menu', [OnlineOrderController::class, 'menu']);
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — Mini App dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index']);
    Route::get('/ship-config', [OnlineOrderController::class, 'shipConfig']);
    // Gói 9: trang chủ Mini App kiểu GrabFood
    Route::get('/shop-info', [OnlineOrderController::class, 'shopInfo']);
    Route::get('/sale-products', [OnlineOrderController::class, 'saleProducts']);
    // Gói 9: đặt đơn nhóm
    Route::post('/group-orders', [GroupOrderController::class, 'store']);
    Route::get('/group-orders/{code}', [GroupOrderController::class, 'show']);
    Route::post('/group-orders/{code}/items', [GroupOrderController::class, 'addItem']);
    Route::patch('/group-orders/{code}/items/{id}', [GroupOrderController::class, 'updateItem']);
    Route::delete('/group-orders/{code}/items/{id}', [GroupOrderController::class, 'removeItem']);
    Route::post('/group-orders/{code}/checkout', [GroupOrderController::class, 'checkout']);
    // Gói 7p: màu chủ đạo giao diện (public cho Mini App)
    Route::get('/theme', [SettingsController::class, 'publicTheme']);
    Route::post('/shipping-fee', [OnlineOrderController::class, 'shippingFee']);
    Route::post('/promotions/eligible', [OnlineOrderController::class, 'eligiblePromotions']);
    Route::get('/customer', [OnlineOrderController::class, 'customer']);
    Route::post('/orders', [OnlineOrderController::class, 'store']);
    Route::get('/orders/{code}', [OnlineOrderController::class, 'track']);
    Route::post('/orders/{code}/cancel', [OnlineOrderController::class, 'cancel']);
});
