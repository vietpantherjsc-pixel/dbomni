<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\BranchVisibilityController; // Gói 25: ẩn/hiện mặt hàng & thực đơn theo CN
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\InboundController;
use App\Http\Controllers\Api\OutboundController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\CustomerAddressController; // Gói 49: sổ địa chỉ
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
use App\Http\Controllers\Api\PaymentMethodController; // Gói 52
use App\Http\Controllers\Api\ProductAliasController; // Gói 55
use App\Http\Controllers\Api\UnitController; // Gói 52
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
use App\Http\Controllers\Api\AccountController; // Gói 57: quỹ/tài khoản
use App\Http\Controllers\Api\PrepaidExpenseController; // Gói 57: chi phí trả trước
use App\Http\Controllers\Api\DeliveryController; // Gói 60: giao hàng
use App\Http\Controllers\Api\DeliveryWebhookController; // Gói 60: webhook giao hàng
use App\Http\Controllers\Api\PartnerController; // Gói 29: đối tác công nợ
use App\Http\Controllers\Api\UploadController; // Gói 10f
use App\Http\Controllers\Api\RoleController; // Gói 26: chức vụ & phân quyền
use App\Http\Controllers\Api\EmployeeController; // Gói 26: nhân viên
use App\Http\Controllers\Api\EmployeeAuthController; // Gói 26: đăng nhập nhân viên + PIN
use App\Http\Controllers\Api\EmployeeInventoryController; // Gói 43: kho cho NV mobile
use App\Http\Controllers\Api\InboundReceiptController; // Gói 43: phiếu nhập theo hóa đơn
use App\Http\Controllers\Api\StockTransferController; // Gói 43: chuyển kho giữa các CN
use App\Http\Controllers\Api\SalaryController; // Gói 26: lương theo giờ
use App\Http\Controllers\Api\WorkShiftController; // Gói 35: ca làm việc
use App\Http\Controllers\Api\ShiftRegistrationController; // Gói 35: đăng ký ca
use App\Http\Controllers\Api\WorkScheduleController; // Gói 35: xếp ca
use App\Http\Controllers\Api\AttendanceController; // Gói 35: chấm công QR
use App\Http\Controllers\Api\LeaveRequestController; // Gói 35: yêu cầu nghỉ/đổi ca
use App\Http\Controllers\Api\AttendanceQrController; // Gói 35: QR chấm công theo CN
use App\Http\Controllers\Api\StaffHubQrController; // Gói 59: QR hub nhân viên
use App\Http\Controllers\Api\ViolationController; // Gói 40: lỗi 3 Chuyên
use App\Http\Controllers\Api\AffiliateController; // Gói 46: affiliate Zalo Mini App
use App\Http\Controllers\Api\ShiftLeaveController; // Gói 46: xin nghỉ theo ca
use App\Http\Controllers\Api\StocktakeAdjustmentController; // Gói 55 p11ag: duyệt điều chỉnh kho từ chênh lệch kiểm kê

// Gói 13: giới hạn 10 lần thử/phút chống dò mật khẩu
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

// Gói 35: đăng nhập trang nhân viên (public) — QR chấm công / đăng ký ca riêng
Route::post('/employee/qr-login', [EmployeeAuthController::class, 'qrLogin'])->middleware('throttle:10,1');
Route::post('/employee/phone-login', [EmployeeAuthController::class, 'phonePinLogin'])->middleware('throttle:10,1');
Route::middleware(['auth:sanctum', 'employee.active'])->prefix('employee')->group(function () {
    Route::get('/me', [EmployeeAuthController::class, 'me']);
    Route::get('/work-shifts', [ShiftRegistrationController::class, 'availableShifts']);
    Route::get('/shift-registrations/week', [ShiftRegistrationController::class, 'myWeek']);
    Route::post('/shift-registrations/week', [ShiftRegistrationController::class, 'submitWeek']);
    Route::post('/attendance/check-in', [AttendanceController::class, 'checkIn']);
    Route::post('/attendance/check-out', [AttendanceController::class, 'checkOut']);
    Route::get('/attendance/history', [AttendanceController::class, 'myHistory']);
    Route::get('/attendance/today', [AttendanceController::class, 'myToday']);
    Route::get('/my-violations', [ViolationController::class, 'myIndex']); // Gói 40: NV xem lỗi của mình
    Route::post('/my-violations', [ViolationController::class, 'myStore']); // Gói 40: NV tự báo lỗi
    Route::get('/violation-types', [ViolationController::class, 'employeeTypes']); // Gói 40: danh mục cho NV
    Route::get('/leave-requests', [LeaveRequestController::class, 'myList']);
    Route::post('/leave-requests', [LeaveRequestController::class, 'store']);
    // Gói 46: xin nghỉ theo ca (/xin-nghi)
    Route::get('/shift-leaves/my-shifts', [ShiftLeaveController::class, 'myShifts']);
    Route::get('/shift-leaves', [ShiftLeaveController::class, 'myList']);
    Route::post('/shift-leaves', [ShiftLeaveController::class, 'store']);
    // Gói 43: kho cho NV (3 trang mobile /kiem-ke, /che-bien, /nhap-kho)
    Route::get('/materials', [EmployeeInventoryController::class, 'materials']);
    Route::get('/suppliers', [EmployeeInventoryController::class, 'suppliers']);
    Route::get('/stocktakes', [EmployeeInventoryController::class, 'stocktakes']);
    Route::get('/stocktake-meta', [EmployeeInventoryController::class, 'branches']); // Gói 55 p11t
    Route::post('/stocktakes/{id}/items', [EmployeeInventoryController::class, 'addStocktakeItems']); // Gói 55 p11w
    Route::delete('/stocktakes/{id}/items/{itemId}', [EmployeeInventoryController::class, 'removeStocktakeItem']); // Gói 55 p11w
    Route::delete('/stocktakes/{id}', [EmployeeInventoryController::class, 'deleteStocktake']); // Gói 55 p11w
    Route::post('/stocktakes', [EmployeeInventoryController::class, 'storeStocktake']);
    Route::get('/stocktakes/{id}', [EmployeeInventoryController::class, 'showStocktake']);
    Route::patch('/stocktakes/{id}/counts', [EmployeeInventoryController::class, 'updateStocktakeCounts']);
    Route::post('/stocktakes/{id}/confirm', [EmployeeInventoryController::class, 'confirmStocktake']);
    Route::get('/production-materials', [EmployeeInventoryController::class, 'productionMaterials']);
    Route::get('/production-recipes', [EmployeeInventoryController::class, 'productionRecipes']);
    Route::post('/productions', [EmployeeInventoryController::class, 'storeProduction']);
    Route::get('/productions', [EmployeeInventoryController::class, 'productions']);
    Route::post('/inbound-receipts', [EmployeeInventoryController::class, 'storeInboundReceipt']);
    // K-R1: NV xem phiếu nhập nháp của mình
    Route::get('/inbound-receipts', [EmployeeInventoryController::class, 'myInboundReceipts']);
    Route::post('/outbound-receipts', [EmployeeInventoryController::class, 'storeOutboundReceipt']); // Gói 55 p11aa
    Route::post('/stock-transfers', [EmployeeInventoryController::class, 'storeStockTransfer']); // Gói 55 p11aa
    Route::get('/units', [UnitController::class, 'index']); // Gói 55 p11z: đơn vị tính cho NV chọn
    Route::post('/transactions', [TransactionController::class, 'store']); // Gói 59: NV tạo phiếu thu/chi (chờ duyệt)
});
// Gói 26: đăng nhập nhân viên (username/password)
Route::post('/employee/login', [EmployeeAuthController::class, 'login'])->middleware('throttle:10,1');

// BẮT BUỘC ĐĂNG NHẬP MỚI ĐƯỢC GỌI CÁC API DƯỚI ĐÂY
// Gói 1 (2026-10-04): Route hóa toàn bộ controllers (trước đây 6/9 controller chưa có route).
Route::middleware('auth:sanctum')->group(function () {

    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    // Danh mục & mặt hàng — Gói SEC: ghi mặt hàng chỉ role có products.manage (đọc mở cho POS)
    // Gói 55 p11ae: danh mục ghi cũng cần products.manage (trước đây NV bất kỳ sửa được)
    Route::get('/categories', [CategoryController::class, 'index']);
    Route::get('/categories/{category}', [CategoryController::class, 'show']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/categories', [CategoryController::class, 'store']);
        Route::put('/categories/{category}', [CategoryController::class, 'update']);
        Route::patch('/categories/{category}', [CategoryController::class, 'update']);
        Route::delete('/categories/{category}', [CategoryController::class, 'destroy']);
    });
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{product}', [ProductController::class, 'show']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/products', [ProductController::class, 'store']);
        Route::put('/products/{product}', [ProductController::class, 'update']);
        Route::patch('/products/{product}', [ProductController::class, 'update']);
        Route::delete('/products/{product}', [ProductController::class, 'destroy']);
    });
    Route::patch('/products/{product}/favorite', [ProductController::class, 'toggleFavorite']); // Gói 9
    // Gói 33: thao tác hàng loạt mặt hàng — CHỈ admin cấp cao nhất (role có "*")
    Route::middleware('permission:products.bulk')->group(function () {
        Route::post('/products/bulk-action', [ProductController::class, 'bulkAction']);
        Route::post('/products/bulk-update', [ProductController::class, 'bulkUpdate']);
    });

    // Gói 25: ẩn/hiện mặt hàng & thực đơn theo chi nhánh (mặc định hiện tất cả, chỉ lưu override ẩn)
    // Gói 55 p11ae: ghi cần products.manage
    Route::get('/visibility/products', [BranchVisibilityController::class, 'productMatrix']);
    Route::get('/visibility/menus', [BranchVisibilityController::class, 'menuMatrix']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/visibility/products/toggle', [BranchVisibilityController::class, 'toggleProduct']);
        Route::post('/visibility/products/sync', [BranchVisibilityController::class, 'syncProducts']);
        Route::post('/visibility/menus/toggle', [BranchVisibilityController::class, 'toggleMenu']);
        Route::post('/visibility/menus/sync', [BranchVisibilityController::class, 'syncMenus']);
    });

    // Thực đơn (POS / Zalo Mini App)
    Route::get('/menu', [MenuController::class, 'index']);
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — POS dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index']);

    // Chi nhánh (dropdown)
    Route::get('/branches', [BranchController::class, 'index']);

    // Gói 15 (2026-10-08): Báo cáo Giám đốc — 1 endpoint trả đủ 4 tab — Gói SEC: chỉ role có reports.view
    Route::middleware('permission:reports.view')->group(function () {
        Route::get('/reports/overview', [ReportController::class, 'overview']);
        // Gói 17: Báo cáo kho + Báo cáo thu chi/PNL
        Route::get('/reports/inventory', [ReportController::class, 'inventory']);
        Route::get('/reports/pnl', [ReportController::class, 'pnl']);
        // Gói 56 (2026-10-14): KPI vận hành trong ngày
        Route::get('/reports/operations', [ReportController::class, 'operations']);
        // Gói 57: Menu Engineering + xuất Excel chi tiết bill
        Route::get('/reports/menu-engineering', [ReportController::class, 'menuEngineering']);
        Route::get('/reports/revenue/export', [ReportController::class, 'exportRevenue']);
        // Gói 55 p11ag: báo cáo đơn hủy theo nhân viên (chống gian lận)
        Route::get('/reports/cancelled-by-staff', [ReportController::class, 'cancelledByStaff']);
    });

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
    // Gói 60: giao hàng — thử tạo lại đơn hãng, xem log, báo cáo failover
    Route::post('/orders/{order}/delivery/retry', [DeliveryController::class, 'retry']);
    Route::get('/orders/{order}/delivery/logs', [DeliveryController::class, 'logs']);
    Route::get('/delivery/failover-report', [DeliveryController::class, 'failoverReport']);
    Route::get('/delivery/config', [DeliveryController::class, 'config']);

    // Bàn phục vụ (Gói 3) — Gói 55 p11ae: ghi cần branches.manage (POS chỉ đọc)
    Route::get('/tables', [TableController::class, 'index']);
    Route::middleware('permission:branches.manage')->group(function () {
        Route::post('/tables', [TableController::class, 'store']);
        Route::patch('/tables/{id}', [TableController::class, 'update']);
        Route::delete('/tables/{id}', [TableController::class, 'destroy']);
    });

    // Màn hình bếp/bar (KDS) — frontend poll mỗi 3s
    Route::get('/kds/orders', [OrderController::class, 'kdsOrders']);

    // Ca làm việc
    Route::get('/shifts/current', [ShiftController::class, 'currentShift']);
    Route::post('/shifts/open', [ShiftController::class, 'openShift']);
    Route::post('/shifts/{id}/expense', [ShiftController::class, 'addExpense']);
    Route::post('/shifts/{id}/close', [ShiftController::class, 'closeShift']);

    // Kho — Gói SEC: quick-adjust chỉ role có inventory.adjust
    Route::get('/inventory/branch/{branchId}', [InventoryController::class, 'getStockByBranch']);
    Route::middleware('permission:inventory.adjust')->post('/inventory/quick-adjust', [InventoryController::class, 'quickAdjust']); // Gói 55 p11: −/+ nhanh
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::post('/inbound', [InboundController::class, 'store']);
        Route::post('/inbound/bulk', [InboundController::class, 'storeBulk']);
        // Gói 55 p11b: duyệt đề xuất điều chỉnh kho từ chênh lệch kiểm kê
        Route::get('/stocktake-adjustments', [StocktakeAdjustmentController::class, 'index']);
        Route::post('/stocktake-adjustments/{id}/approve', [StocktakeAdjustmentController::class, 'approve']);
        Route::post('/stocktake-adjustments/{id}/reject', [StocktakeAdjustmentController::class, 'reject']);
    });

    // Gói 27 (2026-10-09): Thu-Chi — Gói SEC: chỉ role có finance.manage
    Route::middleware('permission:finance.manage')->group(function () {
        Route::get('/transactions', [TransactionController::class, 'index']);
        Route::post('/transactions', [TransactionController::class, 'store']);
        Route::put('/transactions/{id}', [TransactionController::class, 'update']);
        Route::delete('/transactions/{id}', [TransactionController::class, 'destroy']);
        Route::post('/transactions/{id}/pay', [TransactionController::class, 'pay']); // Gói 29: thanh toán trừ dần
        Route::post('/transactions/{id}/approve', [TransactionController::class, 'approve']); // Gói 59: duyệt phiếu NV
        Route::post('/transaction-categories', [TransactionController::class, 'storeCategory']);
        Route::put('/transaction-categories/{id}', [TransactionController::class, 'updateCategory']); // Gói 29
        Route::delete('/transaction-categories/{id}', [TransactionController::class, 'destroyCategory']);
        // Gói 57: quỹ/tài khoản + chi phí trả trước
        Route::apiResource('accounts', AccountController::class);
        Route::apiResource('prepaid-expenses', PrepaidExpenseController::class);
    });
    Route::get('/transaction-categories', [TransactionController::class, 'categories']);

    // Gói 29 (2026-10-09): Đối tác + công nợ (dùng chung toàn chuỗi)
    // Lưu ý: /partners/debt-summary PHẢI đứng trước /partners/{id} để không bị nuốt route.
    // Gói 55 p11ae: ghi cần inventory.manage (NCC phục vụ nhập hàng)
    Route::get('/partners', [PartnerController::class, 'index']);
    Route::get('/partners/debt-summary', [PartnerController::class, 'debtSummary']);
    Route::get('/partners/{id}', [PartnerController::class, 'show']);
    Route::get('/partners/{id}/payments', [PartnerController::class, 'payments']);
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::post('/partners', [PartnerController::class, 'store']);
        Route::put('/partners/{id}', [PartnerController::class, 'update']);
        Route::delete('/partners/{id}', [PartnerController::class, 'destroy']);
    });

    // Gói 4: nguyên vật liệu — Gói 55 p11ae: ghi cần inventory.manage
    Route::get('/materials', [MaterialController::class, 'index']);
    Route::get('/materials/{id}/linked-products', [MaterialController::class, 'linkedProducts']); // Gói 55 p11m
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::post('/materials/{id}/unlink', [MaterialController::class, 'unlinkProduct']); // Gói 55 p11n
        Route::post('/materials', [MaterialController::class, 'store']);
        Route::patch('/materials/{id}', [MaterialController::class, 'update']);
        Route::delete('/materials/{id}', [MaterialController::class, 'destroy']);
        Route::post('/materials/bulk', [MaterialController::class, 'bulk']); // Gói 55 p11l
        Route::post('/materials/bulk-update', [MaterialController::class, 'bulkUpdate']); // Gói 55 p11w
        Route::post('/materials/import-preview', [MaterialController::class, 'importPreview']); // Gói 55 p11s
    });

    // Gói 22: loại danh mục nguyên liệu (nhóm kiểm kho động) — Gói 55 p11ae: ghi cần inventory.manage
    Route::get('/material-categories', [MaterialCategoryController::class, 'index']);
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::post('/material-categories', [MaterialCategoryController::class, 'store']);
        Route::post('/material-categories/reorder', [MaterialCategoryController::class, 'reorder']);
        Route::patch('/material-categories/{id}', [MaterialCategoryController::class, 'update']);
        Route::delete('/material-categories/{id}', [MaterialCategoryController::class, 'destroy']);
    });

    // Gói 4: chế biến bán thành phẩm
    Route::get('/production-recipes', [ProductionController::class, 'recipes']);
    Route::post('/production-recipes', [ProductionController::class, 'storeRecipe']);
    Route::delete('/production-recipes/{id}', [ProductionController::class, 'destroyRecipe']);
    Route::get('/productions', [ProductionController::class, 'index']);
    Route::post('/productions', [ProductionController::class, 'produce']);

    // Gói 4: kiểm kê kho — Gói SEC: chỉ role có inventory.manage
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::get('/stocktakes', [StocktakeController::class, 'index']);
        Route::get('/stocktakes/{id}', [StocktakeController::class, 'show']);
        Route::post('/stocktakes', [StocktakeController::class, 'store']);
        Route::patch('/stocktakes/{id}/counts', [StocktakeController::class, 'updateCounts']);
        Route::post('/stocktakes/{id}/confirm', [StocktakeController::class, 'confirm']);
    });

    // Gói 43: chuyển kho giữa các chi nhánh — Gói SEC
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::get('/stock-transfers', [StockTransferController::class, 'index']);
        Route::get('/stock-transfers/{id}', [StockTransferController::class, 'show']);
        Route::post('/stock-transfers', [StockTransferController::class, 'store']);
        Route::post('/stock-transfers/{id}/confirm', [StockTransferController::class, 'confirm']);
        Route::post('/stock-transfers/{id}/cancel', [StockTransferController::class, 'cancel']);
        Route::get('/stock-transfer-stock', [StockTransferController::class, 'stock']);
    });
    // Gói 43: phiếu nhập hàng theo hóa đơn — Gói SEC
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::get('/inbound-receipts', [InboundReceiptController::class, 'index']);
        Route::get('/inbound-receipts/{id}', [InboundReceiptController::class, 'show']);
        Route::post('/inbound-receipts', [InboundReceiptController::class, 'store']);
        Route::patch('/inbound-receipts/{id}', [InboundReceiptController::class, 'update']);
        Route::post('/inbound-receipts/{id}/cancel', [InboundReceiptController::class, 'cancel']);
        // K-R1: duyệt phiếu nhập nháp của NV (cần inventory.manage)
        Route::post('/inbound-receipts/{id}/approve', [InboundReceiptController::class, 'approve']);
    });
    // Gói 55 p11z: phiếu xuất kho (trừ kho FIFO khi chốt) — Gói SEC
    Route::middleware('permission:inventory.manage')->group(function () {
        Route::get('/outbound-receipts', [OutboundController::class, 'index']);
        Route::post('/outbound-receipts', [OutboundController::class, 'store']);
        Route::get('/outbound-receipts/{id}', [OutboundController::class, 'show']);
        Route::post('/outbound-receipts/{id}/confirm', [OutboundController::class, 'confirm']);
        Route::post('/outbound-receipts/{id}/cancel', [OutboundController::class, 'cancel']);
    });

    // Gói 5: CRM — khách hàng — Gói 55 p11ae: ghi cần customers.manage (chống NV tự cộng điểm/nâng hạng)
    Route::get('/customers', [CustomerController::class, 'index']);
    Route::get('/customers/{id}', [CustomerController::class, 'show']);
    Route::middleware('permission:customers.manage')->group(function () {
        Route::post('/customers', [CustomerController::class, 'store']);
        Route::patch('/customers/{id}', [CustomerController::class, 'update']);
        Route::post('/customers/{id}/adjust-points', [CustomerController::class, 'adjustPoints']);
    });

    // Gói 5: hạng thành viên + cấu hình quy đổi điểm — Gói 55 p11ae: ghi cần customers.manage
    Route::get('/membership-tiers', [MembershipTierController::class, 'index']);
    Route::middleware('permission:customers.manage')->group(function () {
        Route::post('/membership-tiers', [MembershipTierController::class, 'store']);
        Route::patch('/membership-tiers/{id}', [MembershipTierController::class, 'update']);
        Route::delete('/membership-tiers/{id}', [MembershipTierController::class, 'destroy']);
        Route::post('/membership-tiers/redeem-config', [MembershipTierController::class, 'updateRedeemConfig']);
    });

    // Gói 5: khuyến mại — Gói SEC: ghi chỉ role có products.manage (eligible mở cho POS/Mini App)
    Route::get('/promotions', [PromotionController::class, 'index']);
    Route::post('/promotions/eligible', [PromotionController::class, 'eligible']);
    Route::get('/promotions/{id}', [PromotionController::class, 'show']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/promotions', [PromotionController::class, 'store']);
        Route::patch('/promotions/{id}', [PromotionController::class, 'update']);
        Route::delete('/promotions/{id}', [PromotionController::class, 'destroy']);
    });

    // Gói 6: nhân viên xác nhận đơn online (đã nhận tiền -> trừ kho, vào KDS)
    Route::post('/orders/{id}/confirm-payment', [OnlineOrderController::class, 'confirmPayment']);
    // Gói 11: tạo mã QR tích điểm cho đơn POS
    Route::post('/orders/{id}/claim-qr', [OrderController::class, 'claimQr']);

    // Gói 6: cấu hình bán online — Gói SEC: ghi chi nhánh chỉ role có branches.manage
    Route::middleware('permission:branches.manage')->group(function () {
        Route::post('/branches', [BranchController::class, 'store']);
        Route::patch('/branches/{id}', [BranchController::class, 'update']);
    });

    // Gói 10f: upload ảnh cover Mini App (jpg/png/webp <= 1MB, tự crop 1200x500)
    // Gói 38: settings + upload cover — CHỈ role có settings.edit
    Route::middleware('permission:settings.edit')->group(function () {
        Route::post('/uploads/cover', [UploadController::class, 'cover']);
        Route::post('/uploads/promo-banner', [UploadController::class, 'promoBanner']); // Gói 49e
        Route::post('/uploads/product-image', [UploadController::class, 'productImage']); // Gói 55
        Route::post('/settings', [SettingsController::class, 'update']);
        // Gói 52: phương thức thanh toán + đơn vị tính
        Route::get('/payment-methods', [PaymentMethodController::class, 'index']);
        Route::post('/payment-methods', [PaymentMethodController::class, 'store']);
        Route::put('/payment-methods/{id}', [PaymentMethodController::class, 'update']);
        Route::delete('/payment-methods/{id}', [PaymentMethodController::class, 'destroy']);
        // Gói 55: tên thay thế món (alias)
        Route::get('/product-aliases', [ProductAliasController::class, 'index']);
        Route::post('/product-aliases', [ProductAliasController::class, 'store']);
        Route::delete('/product-aliases/{id}', [ProductAliasController::class, 'destroy']);
        Route::get('/units', [UnitController::class, 'index']);
        Route::post('/units', [UnitController::class, 'store']);
        Route::put('/units/{id}', [UnitController::class, 'update']);
        Route::delete('/units/{id}', [UnitController::class, 'destroy']);
        // Gói 40: quản lý danh mục lỗi 3 Chuyên
        Route::post('/violation-types', [ViolationController::class, 'typesStore']);
        Route::put('/violation-types/{id}', [ViolationController::class, 'typesUpdate']);
        Route::delete('/violation-types/{id}', [ViolationController::class, 'typesDestroy']);
        // Gói 59: QR hub nhân viên (xem / tạo lại)
        Route::get('/staff-hub-qr', [StaffHubQrController::class, 'show']);
        Route::post('/staff-hub-qr/regenerate', [StaffHubQrController::class, 'regenerate']);
    });
    Route::get('/settings', [SettingsController::class, 'index']); // Gói 8a: thuế & giá
    // Gói 7p: màu chủ đạo giao diện (Đại Vương tự pick)
    Route::get('/settings/theme', [SettingsController::class, 'theme']);

    // Gói 8a: kênh bán hàng (giá theo kênh) — Gói 55 p11ae: ghi cần products.manage
    Route::get('/price-lists', [PriceListController::class, 'index']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/price-lists', [PriceListController::class, 'store']);
        Route::post('/price-lists/reorder', [PriceListController::class, 'reorder']);
        Route::patch('/price-lists/{priceList}', [PriceListController::class, 'update']);
        Route::delete('/price-lists/{priceList}', [PriceListController::class, 'destroy']);
    });

    // Gói 7b: nhóm tùy chọn — Gói 55 p11ae: ghi cần products.manage (đọc mở cho POS)
    Route::get('/option-groups', [OptionGroupController::class, 'index']);
    Route::get('/option-groups/{id}/products', [OptionGroupController::class, 'products']);
    Route::get('/options/{id}/recipes', [OptionGroupController::class, 'optionRecipes']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/option-groups', [OptionGroupController::class, 'store']);
        Route::patch('/option-groups/{id}', [OptionGroupController::class, 'update']);
        Route::delete('/option-groups/{id}', [OptionGroupController::class, 'destroy']);
        Route::post('/option-groups/{id}/options', [OptionGroupController::class, 'storeOption']);
        Route::patch('/options/{id}', [OptionGroupController::class, 'updateOption']);
        Route::delete('/options/{id}', [OptionGroupController::class, 'destroyOption']);
        // Gói 8a: kéo-thả, gán mặt hàng, định mức tùy chọn
        Route::post('/option-groups/reorder', [OptionGroupController::class, 'reorder']);
        Route::post('/option-groups/{id}/options/reorder', [OptionGroupController::class, 'reorderOptions']);
        Route::post('/option-groups/{id}/products', [OptionGroupController::class, 'assignProducts']);
        Route::put('/options/{id}/recipes', [OptionGroupController::class, 'updateOptionRecipes']);
    });

    // Gói 7f: quản lý thực đơn (POS/App) — Gói 55 p11ae: ghi cần products.manage
    Route::get('/menus', [MenuAdminController::class, 'index']);
    Route::get('/menus/{id}', [MenuAdminController::class, 'show']);
    Route::get('/menus/{id}/search-products', [MenuAdminController::class, 'searchProducts']);
    Route::middleware('permission:products.manage')->group(function () {
        Route::post('/menus', [MenuAdminController::class, 'store']);
        Route::post('/menus/reorder', [MenuAdminController::class, 'reorder']);
        Route::patch('/menus/{id}', [MenuAdminController::class, 'update']);
        Route::delete('/menus/{id}', [MenuAdminController::class, 'destroy']);
        Route::post('/menus/{id}/products', [MenuAdminController::class, 'attachProduct']);
        Route::delete('/menus/{id}/products/{productId}', [MenuAdminController::class, 'detachProduct']);
        Route::post('/menus/{id}/products/reorder', [MenuAdminController::class, 'reorderProducts']);
    });

    // Quản trị — Gói 55 p11ae: nhập kho trực tiếp cần inventory.manage
    Route::get('/admin/dashboard/stats', [AdminDashboardController::class, 'stats']);
    Route::middleware('permission:inventory.manage')->post('/admin/inventory/inward', [InboundController::class, 'store']);

    // Gói 26: Nhân sự — PIN nhanh cho POS/KDS (cần token đăng nhập)
    // Gói 38: throttle chống dò PIN + bắt buộc kèm phone/username (xem EmployeeAuthController@pinVerify)
    Route::post('/employee/pin-verify', [EmployeeAuthController::class, 'pinVerify'])->middleware('throttle:10,1');

    // Gói 26: Nhân sự — đọc (quyền staff.view)
    Route::middleware('permission:staff.view')->group(function () {
        Route::get('/roles/matrix', [RoleController::class, 'matrix']);
        Route::apiResource('roles', RoleController::class)->only(['index', 'show'])->parameters(['roles' => 'id']);
        Route::apiResource('employees', EmployeeController::class)->only(['index', 'show'])->parameters(['employees' => 'id']);
        Route::get('/salary/{id}', [SalaryController::class, 'show']);
        Route::get('/salary-summary', [SalaryController::class, 'summary']); // Gói 55: tổng hợp lương toàn NV
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
        Route::get('/attendances/shift-stats', [AttendanceController::class, 'shiftStats']); // Gói 46: cột Tổng số ca
        Route::get('/leave-requests', [LeaveRequestController::class, 'index']);
        Route::get('/shift-leaves', [ShiftLeaveController::class, 'index']); // Gói 46: xin nghỉ theo ca
        Route::get('/branches/{id}/attendance-qr', [AttendanceQrController::class, 'show']);
        Route::get('/schedule-notes', [WorkScheduleController::class, 'getNote']); // Gói 37
        Route::get('/schedule-notes/map', [WorkScheduleController::class, 'notesMap']); // Gói 37b

        // Gói 40: Lỗi 3 Chuyên — đọc (quyền staff.view, quản lý cửa hàng xem được, không thấy lương)
        Route::get('/violations', [ViolationController::class, 'index']);
        Route::get('/violations/summary', [ViolationController::class, 'summary']);
        Route::get('/violation-types', [ViolationController::class, 'typesIndex']);

        // Gói 46: Affiliate Zalo Mini App — đọc
        Route::get('/affiliate/top', [AffiliateController::class, 'top']);
        Route::get('/affiliate/orders', [AffiliateController::class, 'orders']);
    });

    // Gói 26: Nhân sự — ghi (quyền staff.edit)
    Route::middleware('permission:staff.edit')->group(function () {
        Route::apiResource('roles', RoleController::class)->only(['store', 'update', 'destroy'])->parameters(['roles' => 'id']);
        Route::apiResource('employees', EmployeeController::class)->only(['store', 'update', 'destroy'])->parameters(['employees' => 'id']);
        Route::post('/employees/{id}/reset-pin', [EmployeeController::class, 'resetPin']);
        Route::post('/employees/{id}/reset-password', [EmployeeController::class, 'resetPassword']);
        Route::post('/salary/{id}/record', [SalaryController::class, 'saveRecord']);
        Route::post('/salary/{id}/days', [SalaryController::class, 'saveDays']);
        Route::post('/salary/import-attendance', [SalaryController::class, 'importAttendance']); // Đổ giờ công từ chấm công
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
        // Gói 40: Trừ khác đa khoản
        Route::get('/salary/{employee}/deductions', [SalaryController::class, 'listDeductions']);
        Route::post('/salary/{employee}/deductions', [SalaryController::class, 'storeDeduction']);
        Route::put('/salary/deductions/{id}', [SalaryController::class, 'updateDeduction']);
        Route::delete('/salary/deductions/{id}', [SalaryController::class, 'destroyDeduction']);
        // Gói 40: Lỗi 3 Chuyên — ghi (quyền staff.edit)
        Route::post('/violations', [ViolationController::class, 'store']);
        Route::put('/violations/{id}', [ViolationController::class, 'update']);
        Route::delete('/violations/{id}', [ViolationController::class, 'destroy']);

        // Gói 35: Chấm công — ghi (quyền staff.edit)
        Route::post('/work-shifts/reorder', [WorkShiftController::class, 'reorder']);
        Route::apiResource('work-shifts', WorkShiftController::class)->only(['store', 'update', 'destroy'])->parameters(['work-shifts' => 'id']);
        Route::post('/work-schedules/assign', [WorkScheduleController::class, 'assign']);
        Route::post('/work-schedules/batch-save', [WorkScheduleController::class, 'batchSave']); // Gói 42: lưu hàng loạt các ô nháp của 1 CN
        Route::delete('/work-schedules/{id}', [WorkScheduleController::class, 'destroy']);
        Route::post('/work-shift-capacities', [WorkScheduleController::class, 'saveCapacity']); // Gói 37
        Route::put('/schedule-notes', [WorkScheduleController::class, 'saveNote']); // Gói 37
        Route::post('/leave-requests/{id}/approve', [LeaveRequestController::class, 'approve']);
        Route::post('/leave-requests/{id}/reject', [LeaveRequestController::class, 'reject']);
        // Gói 46: xin nghỉ theo ca — quản lý tạo trực tiếp / duyệt (tự gỡ ca) / từ chối
        Route::post('/shift-leaves', [ShiftLeaveController::class, 'managerStore']);
        Route::post('/shift-leaves/{id}/approve', [ShiftLeaveController::class, 'approve']);
        Route::post('/shift-leaves/{id}/reject', [ShiftLeaveController::class, 'reject']);
        Route::post('/shift-registrations/{id}/approve', [ShiftRegistrationController::class, 'approve']); // B2
        Route::post('/shift-registrations/{id}/reject', [ShiftRegistrationController::class, 'reject']); // B2
        Route::post('/shift-registrations/{id}/approve-and-assign', [ShiftRegistrationController::class, 'approveAndAssign']); // Gói 41: duyệt + tự xếp ca trên bảng Xếp ca
        Route::post('/branches/{id}/attendance-qr/regenerate', [AttendanceQrController::class, 'regenerate']);
    });
});

// Gói 6: API public cho Zalo Mini App (không cần đăng nhập, định danh bằng SĐT)
// Gói 55 p11ae: throttle 60 req/phút cho cả group (chống spam đơn / lạm dụng proxy geocode)
Route::prefix('online')->middleware('throttle:60,1')->group(function () {
    Route::get('/branches', [OnlineOrderController::class, 'branches']);
    Route::get('/menu', [OnlineOrderController::class, 'menu']);
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — Mini App dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index']);
    Route::get('/ship-config', [OnlineOrderController::class, 'shipConfig']);
    Route::get('/geocode', [OnlineOrderController::class, 'geocode']); // Gói 50e: geocode qua backend
    Route::get('/geocode/suggest', [OnlineOrderController::class, 'geocodeSuggest']); // Gói 50f: gợi ý địa chỉ
    Route::get('/geocode/reverse', [OnlineOrderController::class, 'geocodeReverse']); // Gói 55 p3: GPS -> địa chỉ
    // Gói 55 p11ac: proxy tỉnh/thành + xã/phường (Zalo WebView chặn domain lạ)
    Route::get('/provinces', [OnlineOrderController::class, 'provinces']);
    Route::get('/wards', [OnlineOrderController::class, 'wards']);
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
    // Gói 48: banner KM cho carousel Mini App (public)
    Route::get('/promo-banners', [PromotionController::class, 'banners']);
    // Gói 52: PTTT public theo kênh (POS/Mini App)
    Route::get('/payment-methods/active', [PaymentMethodController::class, 'publicActive']);
    // Gói 49: sổ địa chỉ giao hàng (public, xác thực customer_id)
    Route::get('/addresses', [CustomerAddressController::class, 'index']);
    Route::post('/addresses', [CustomerAddressController::class, 'store']);
    Route::patch('/addresses/{id}', [CustomerAddressController::class, 'update']);
    Route::delete('/addresses/{id}', [CustomerAddressController::class, 'destroy']);
    Route::post('/shipping-fee', [OnlineOrderController::class, 'shippingFee']);
    Route::post('/promotions/eligible', [OnlineOrderController::class, 'eligiblePromotions']);
    Route::get('/customer', [OnlineOrderController::class, 'customer']);
    Route::post('/orders', [OnlineOrderController::class, 'store']);
    Route::get('/orders/{code}', [OnlineOrderController::class, 'track']);
    Route::post('/orders/{code}/cancel', [OnlineOrderController::class, 'cancel'])->middleware('throttle:10,1'); // Gói SEC2: chống brute-force mã đơn
    // Gói 60: báo giá giao hàng live cho checkout Mini App
    Route::post('/delivery/quote', [DeliveryController::class, 'quote'])->middleware('throttle:30,1');
    Route::get('/delivery/config', [DeliveryController::class, 'config']);
});

// Gói 60: webhook giao hàng từ hãng (public, verify chữ ký trong adapter)
Route::post('/webhooks/delivery/{provider}', [DeliveryWebhookController::class, 'handle'])
    ->where('provider', 'ahamove|lalamove')
    ->middleware('throttle:120,1');
