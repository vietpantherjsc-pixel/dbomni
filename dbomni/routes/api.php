<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\BranchVisibilityController; // Gói 25: ẩn/hiện mặt hàng & thực đơn theo CN
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\InboundController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DisplayMenuController;
use App\Http\Controllers\Api\GroupOrderController;
use App\Http\Controllers\Api\MaterialController;
use App\Http\Controllers\Api\MaterialCategoryController;
use App\Http\Controllers\Api\MembershipTierController;
use App\Http\Controllers\Api\MenuAdminController;
use App\Http\Controllers\Api\OnlineOrderController;
use App\Http\Controllers\Api\OptionGroupController;
use App\Http\Controllers\Api\PriceListController;
use App\Http\Controllers\Api\ProductionController;
use App\Http\Controllers\Api\PromotionController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\StocktakeController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\OrderImportController; // Gói 23: import đơn từ Excel
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Api\TableController;
use App\Http\Controllers\Api\TransactionController; // Gói 27: thu chi
use App\Http\Controllers\Api\PartnerController; // Gói 29: đối tác công nợ
use App\Http\Controllers\Api\UploadController; // Gói 10f
use App\Http\Controllers\Api\RoleController; // Gói 26: chức vụ & phân quyền
use App\Http\Controllers\Api\EmployeeController; // Gói 26: nhân viên
use App\Http\Controllers\Api\EmployeeAuthController; // Gói 26: đăng nhập nhân viên + PIN
use App\Http\Controllers\Api\SalaryController; // Gói 26: lương theo giờ
use App\Http\Controllers\Api\WorkShiftController; // Gói 35: ca làm việc
use App\Http\Controllers\Api\ShiftRegistrationController; // Gói 35: đăng ký ca
use App\Http\Controllers\Api\WorkScheduleController; // Gói 35: xếp ca
use App\Http\Controllers\Api\AttendanceController; // Gói 35: chấm công QR
use App\Http\Controllers\Api\LeaveRequestController; // Gói 35: yêu cầu nghỉ/đổi ca
use App\Http\Controllers\Api\AttendanceQrController; // Gói 35: QR chấm công theo CN

// Gói 13: giới hạn 10 lần thử/phút chống dò mật khẩu
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

// Gói 35: đăng nhập trang nhân viên (public) — QR chấm công / đăng ký ca riêng
Route::post('/employee/qr-login', [EmployeeAuthController::class, 'qrLogin'])->middleware('throttle:10,1');
Route::post('/employee/phone-login', [EmployeeAuthController::class, 'phonePinLogin'])->middleware('throttle:10,1');
Route::middleware('auth:sanctum')->prefix('employee')->group(function () {
    Route::get('/me', [EmployeeAuthController::class, 'me']);
    Route::get('/work-shifts', [ShiftRegistrationController::class, 'availableShifts']);
    Route::get('/shift-registrations/week', [ShiftRegistrationController::class, 'myWeek']);
    Route::post('/shift-registrations/week', [ShiftRegistrationController::class, 'submitWeek']);
    Route::post('/attendance/check-in', [AttendanceController::class, 'checkIn']);
    Route::post('/attendance/check-out', [AttendanceController::class, 'checkOut']);
    Route::get('/attendance/history', [AttendanceController::class, 'myHistory']);
    Route::get('/attendance/today', [AttendanceController::class, 'myToday']);
    Route::get('/leave-requests', [LeaveRequestController::class, 'myList']);
    Route::post('/leave-requests', [LeaveRequestController::class, 'store']);
});
// Gói 26: đăng nhập nhân viên (username/password)
Route::post('/employee/login', [EmployeeAuthController::class, 'login'])->middleware('throttle:10,1');

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
    // Gói 33: thao tác hàng loạt mặt hàng — CHỈ admin cấp cao nhất (role có "*")
    Route::middleware('permission:products.bulk')->group(function () {
        Route::post('/products/bulk-action', [ProductController::class, 'bulkAction']);
        Route::post('/products/bulk-update', [ProductController::class, 'bulkUpdate']);
    });

    // Gói 25: ẩn/hiện mặt hàng & thực đơn theo chi nhánh (mặc định hiện tất cả, chỉ lưu override ẩn)
    Route::get('/visibility/products', [BranchVisibilityController::class, 'productMatrix']);
    Route::post('/visibility/products/toggle', [BranchVisibilityController::class, 'toggleProduct']);
    Route::post('/visibility/products/sync', [BranchVisibilityController::class, 'syncProducts']);
    Route::get('/visibility/menus', [BranchVisibilityController::class, 'menuMatrix']);
    Route::post('/visibility/menus/toggle', [BranchVisibilityController::class, 'toggleMenu']);
    Route::post('/visibility/menus/sync', [BranchVisibilityController::class, 'syncMenus']);

    // Thực đơn (POS / Zalo Mini App)
    Route::get('/menu', [MenuController::class, 'index']);
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — POS dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index']);

    // Chi nhánh (dropdown)
    Route::get('/branches', [BranchController::class, 'index']);

    // Gói 15 (2026-10-08): Báo cáo Giám đốc — 1 endpoint trả đủ 4 tab
    Route::get('/reports/overview', [ReportController::class, 'overview']);
    // Gói 17: Báo cáo kho + Báo cáo thu chi/PNL
    Route::get('/reports/inventory', [ReportController::class, 'inventory']);
    Route::get('/reports/pnl', [ReportController::class, 'pnl']);

    // Đơn hàng
    Route::get('/orders', [OrderController::class, 'index']);
    Route::post('/orders', [OrderController::class, 'store']);
    // Gói 13: xóa GET /orders/history (endpoint chết, Gói 12a thay thế bằng rule 24h ở OnlineOrderController)
    Route::get('/orders/code/{code}', [OrderController::class, 'showByCode']);
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus']);
    Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel']);
    // Gói 33: thao tác hàng loạt hóa đơn (hủy/xóa) — CHỈ admin cấp cao nhất (role có "*")
    Route::middleware('permission:orders.bulk')->post('/orders/bulk-action', [OrderController::class, 'bulkAction']);
    Route::post('/orders/{id}/split', [OrderController::class, 'split']);   // Gói 3: tách đơn
    Route::post('/orders/merge', [OrderController::class, 'merge']);       // Gói 3: gộp đơn
    Route::get('/orders/held', [OrderController::class, 'heldOrders']);    // Gói 3b: danh sách đơn lưu
    Route::post('/orders/{id}/finalize', [OrderController::class, 'finalize']); // Gói 3b: thanh toán đơn lưu
    // Gói 23: import đơn hàng từ Excel (wizard 4 bước)
    Route::post('/orders/import-excel', [OrderImportController::class, 'upload']);
    Route::post('/orders/import-excel/validate', [OrderImportController::class, 'validateRows']);
    Route::post('/orders/import-excel/confirm', [OrderImportController::class, 'confirm']);

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

    // Gói 27 (2026-10-09): Thu-Chi
    Route::get('/transactions', [TransactionController::class, 'index']);
    Route::post('/transactions', [TransactionController::class, 'store']);
    Route::put('/transactions/{id}', [TransactionController::class, 'update']);
    Route::delete('/transactions/{id}', [TransactionController::class, 'destroy']);
    Route::post('/transactions/{id}/pay', [TransactionController::class, 'pay']); // Gói 29: thanh toán trừ dần
    Route::get('/transaction-categories', [TransactionController::class, 'categories']);
    Route::post('/transaction-categories', [TransactionController::class, 'storeCategory']);
    Route::put('/transaction-categories/{id}', [TransactionController::class, 'updateCategory']); // Gói 29
    Route::delete('/transaction-categories/{id}', [TransactionController::class, 'destroyCategory']);

    // Gói 29 (2026-10-09): Đối tác + công nợ (dùng chung toàn chuỗi)
    // Lưu ý: /partners/debt-summary PHẢI đứng trước /partners/{id} để không bị nuốt route.
    Route::get('/partners', [PartnerController::class, 'index']);
    Route::post('/partners', [PartnerController::class, 'store']);
    Route::get('/partners/debt-summary', [PartnerController::class, 'debtSummary']);
    Route::get('/partners/{id}', [PartnerController::class, 'show']);
    Route::get('/partners/{id}/payments', [PartnerController::class, 'payments']);
    Route::put('/partners/{id}', [PartnerController::class, 'update']);
    Route::delete('/partners/{id}', [PartnerController::class, 'destroy']);

    // Gói 4: nguyên vật liệu
    Route::get('/materials', [MaterialController::class, 'index']);
    Route::post('/materials', [MaterialController::class, 'store']);
    Route::patch('/materials/{id}', [MaterialController::class, 'update']);
    Route::delete('/materials/{id}', [MaterialController::class, 'destroy']);

    // Gói 22: loại danh mục nguyên liệu (nhóm kiểm kho động)
    Route::get('/material-categories', [MaterialCategoryController::class, 'index']);
    Route::post('/material-categories', [MaterialCategoryController::class, 'store']);
    Route::post('/material-categories/reorder', [MaterialCategoryController::class, 'reorder']);
    Route::patch('/material-categories/{id}', [MaterialCategoryController::class, 'update']);
    Route::delete('/material-categories/{id}', [MaterialCategoryController::class, 'destroy']);

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
    // Gói 11: tạo mã QR tích điểm cho đơn POS
    Route::post('/orders/{id}/claim-qr', [OrderController::class, 'claimQr']);

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

    // Gói 26: Nhân sự — PIN nhanh cho POS/KDS (cần token đăng nhập)
    Route::post('/employee/pin-verify', [EmployeeAuthController::class, 'pinVerify']);

    // Gói 26: Nhân sự — đọc (quyền staff.view)
    Route::middleware('permission:staff.view')->group(function () {
        Route::get('/roles/matrix', [RoleController::class, 'matrix']);
        Route::apiResource('roles', RoleController::class)->only(['index', 'show'])->parameters(['roles' => 'id']);
        Route::apiResource('employees', EmployeeController::class)->only(['index', 'show'])->parameters(['employees' => 'id']);
        Route::get('/salary/{id}', [SalaryController::class, 'show']);
        Route::get('/salary/{id}/history', [SalaryController::class, 'history']);
        Route::get('/salary/{id}/days', [SalaryController::class, 'getDays']);
        Route::get('/employees/{id}/insurance', [SalaryController::class, 'getInsurance']);
        Route::get('/holidays', [SalaryController::class, 'holidays']);
        Route::get('/salary-policies', [SalaryController::class, 'getPolicies']); // Gói 30

        // Gói 35: Chấm công — đọc (quyền staff.view)
        Route::get('/work-shifts', [WorkShiftController::class, 'index']);
        Route::get('/shift-registrations/week', [ShiftRegistrationController::class, 'adminWeek']);
        Route::get('/work-schedules/week', [WorkScheduleController::class, 'week']);
        Route::get('/attendances/grid', [AttendanceController::class, 'grid']);
        Route::get('/leave-requests', [LeaveRequestController::class, 'index']);
        Route::get('/branches/{id}/attendance-qr', [AttendanceQrController::class, 'show']);
        Route::get('/schedule-notes', [WorkScheduleController::class, 'getNote']); // Gói 37
        Route::get('/schedule-notes/map', [WorkScheduleController::class, 'notesMap']); // Gói 37b
    });

    // Gói 26: Nhân sự — ghi (quyền staff.edit)
    Route::middleware('permission:staff.edit')->group(function () {
        Route::apiResource('roles', RoleController::class)->only(['store', 'update', 'destroy'])->parameters(['roles' => 'id']);
        Route::apiResource('employees', EmployeeController::class)->only(['store', 'update', 'destroy'])->parameters(['employees' => 'id']);
        Route::post('/employees/{id}/reset-pin', [EmployeeController::class, 'resetPin']);
        Route::post('/employees/{id}/reset-password', [EmployeeController::class, 'resetPassword']);
        Route::post('/salary/{id}/record', [SalaryController::class, 'saveRecord']);
        Route::post('/salary/{id}/days', [SalaryController::class, 'saveDays']);
        Route::post('/salary/{id}/wage-levels', [SalaryController::class, 'addWageLevel']);
        Route::delete('/salary/wage-levels/{id}', [SalaryController::class, 'deleteWageLevel']);
        Route::post('/salary/{id}/advances', [SalaryController::class, 'addAdvance']);
        Route::delete('/salary/advances/{id}', [SalaryController::class, 'deleteAdvance']);
        Route::post('/salary/{id}/bonuses', [SalaryController::class, 'addBonus']);
        Route::delete('/salary/bonuses/{id}', [SalaryController::class, 'deleteBonus']);
        Route::post('/employees/{id}/insurance', [SalaryController::class, 'saveInsurance']);
        Route::delete('/employees/{id}/insurance', [SalaryController::class, 'deleteInsurance']);
        Route::post('/holidays', [SalaryController::class, 'addHoliday']);
        Route::patch('/holidays/{id}', [SalaryController::class, 'updateHoliday']); // Gói 30
        Route::delete('/holidays/{id}', [SalaryController::class, 'deleteHoliday']);
        Route::put('/salary-policies', [SalaryController::class, 'savePolicies']); // Gói 30
        Route::put('/salary/{id}/violations', [SalaryController::class, 'saveViolations']); // Gói 30

        // Gói 35: Chấm công — ghi (quyền staff.edit)
        Route::post('/work-shifts/reorder', [WorkShiftController::class, 'reorder']);
        Route::apiResource('work-shifts', WorkShiftController::class)->only(['store', 'update', 'destroy'])->parameters(['work-shifts' => 'id']);
        Route::post('/work-schedules/assign', [WorkScheduleController::class, 'assign']);
        Route::delete('/work-schedules/{id}', [WorkScheduleController::class, 'destroy']);
        Route::post('/work-shift-capacities', [WorkScheduleController::class, 'saveCapacity']); // Gói 37
        Route::put('/schedule-notes', [WorkScheduleController::class, 'saveNote']); // Gói 37
        Route::post('/leave-requests/{id}/approve', [LeaveRequestController::class, 'approve']);
        Route::post('/leave-requests/{id}/reject', [LeaveRequestController::class, 'reject']);
        Route::post('/branches/{id}/attendance-qr/regenerate', [AttendanceQrController::class, 'regenerate']);
    });
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
    Route::get('/top-products', [OnlineOrderController::class, 'topProducts']); // Gói 34: top 10 bán chạy
    // Gói 9: đặt đơn nhóm
    Route::post('/group-orders', [GroupOrderController::class, 'store']);
    Route::get('/group-orders/{code}', [GroupOrderController::class, 'show']);
    Route::post('/group-orders/{code}/items', [GroupOrderController::class, 'addItem']);
    Route::patch('/group-orders/{code}/items/{id}', [GroupOrderController::class, 'updateItem']);
    Route::delete('/group-orders/{code}/items/{id}', [GroupOrderController::class, 'removeItem']);
    Route::post('/group-orders/{code}/checkout', [GroupOrderController::class, 'checkout']);
    // Gói 11: khách quét QR tích điểm để gán TV vào đơn POS (public, xác thực bằng token QR)
    Route::post('/orders/{code}/claim', [OnlineOrderController::class, 'claim']);
    // Gói 7p: màu chủ đạo giao diện (public cho Mini App)
    Route::get('/theme', [SettingsController::class, 'publicTheme']);
    Route::post('/shipping-fee', [OnlineOrderController::class, 'shippingFee']);
    Route::post('/promotions/eligible', [OnlineOrderController::class, 'eligiblePromotions']);
    Route::get('/customer', [OnlineOrderController::class, 'customer']);
    Route::post('/orders', [OnlineOrderController::class, 'store']);
    Route::get('/orders/{code}', [OnlineOrderController::class, 'track']);
    Route::post('/orders/{code}/cancel', [OnlineOrderController::class, 'cancel']);
});
