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
use App\Http\Controllers\Api\AdminMinigameController; // Minigame (2026-11-01): Admin minigame
use App\Http\Controllers\Api\MenuAdminController;
use App\Http\Controllers\Api\OnlineOrderController;
use App\Http\Controllers\Api\OptionGroupController;
use App\Http\Controllers\Api\PriceListController;
use App\Http\Controllers\Api\SharedCategoryController;
use App\Http\Controllers\Api\ProductionController;
use App\Http\Controllers\Api\PromotionController;
use App\Http\Controllers\Api\PaymentMethodController; // Gói 52
use App\Http\Controllers\Api\PaymentController; // SPEC-01: thanh toán Zalo
use App\Http\Controllers\Api\ZaloAuthController; // Spec P4-P5: định danh user Zalo
use App\Http\Controllers\Api\CustomerPasswordController; // Spec mật khẩu khách (2026-11-05)
use App\Http\Controllers\Api\CustomerSessionController; // Spec mật khẩu khách §3.3/§7.3
use App\Http\Controllers\Api\CouponController; // SPEC-02: ví coupon
use App\Http\Controllers\Api\ProductAliasController; // Gói 55
use App\Http\Controllers\Api\UnitController; // Gói 52
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ChannelAdjustmentController; // Gói PNL kênh sàn (2026-10-31): đối soát phí marketing sàn theo tháng
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\StocktakeController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\OrderImportController; // Gói 23: import đơn từ Excel
use App\Http\Controllers\Api\SapoImportController; // Cầu nối Sapo (2026-10-21): import Excel Sapo
use App\Http\Controllers\Api\SapoAdminController; // Cầu nối Sapo — Phần B: map + cấu hình
use App\Http\Controllers\Api\SapoMailController; // Cầu nối Sapo — Phần C: hộp thư IMAP
use App\Http\Controllers\Api\VoucherController; // Spec 5 (2026-10-21): CRUD voucher — BỔ SUNG import còn thiếu
use App\Http\Controllers\Api\RDController; // SPEC R&D (2026-10-21): phân hệ R&D 3 tab
use App\Http\Controllers\Api\PointsController; // Loyalty 2.0 (2026-10-21): Cửa hàng điểm + lịch sử điểm
use App\Http\Controllers\Api\MinigameController; // Minigame (2026-11-01)
use App\Http\Controllers\Api\PointExchangeItemController; // Loyalty 2.0: Admin CRUD món đổi điểm
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
use App\Http\Controllers\Api\EmployeeApprovalController; // Gói "Chờ duyệt trên Hub" (2026-10-21)
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
use App\Http\Controllers\Api\InviteFriendsController; // "Mời bạn bè" (đổi tên từ AffiliateController Gói 46)
use App\Http\Controllers\Api\ShiftLeaveController; // Gói 46: xin nghỉ theo ca
use App\Http\Controllers\Api\ShiftSwapController; // Spec P4-B5: đổi ca thật giữa 2 NV
use App\Http\Controllers\Api\StocktakeAdjustmentController; // Gói 55 p11ag: duyệt điều chỉnh kho từ chênh lệch kiểm kê
use App\Http\Controllers\Api\PurchaseOrderController; // Spec Phiếu đặt hàng NCC (2026-11-08)
use App\Http\Controllers\Api\AdminAccountController; // Cây phân quyền §2.0A: tài khoản quản trị 2 tầng

// Gói 13: giới hạn 10 lần thử/phút chống dò mật khẩu
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

// Gói 35: đăng nhập trang nhân viên (public) — QR chấm công / đăng ký ca riêng
Route::post('/employee/qr-login', [EmployeeAuthController::class, 'qrLogin'])->middleware('throttle:10,1');
Route::post('/employee/phone-login', [EmployeeAuthController::class, 'phonePinLogin'])->middleware('throttle:10,1');
Route::post('/employee/password/change-with-ticket', [EmployeeAuthController::class, 'changePasswordWithTicket'])->middleware('throttle:10,1'); // Gói #102: đổi mật khẩu bắt buộc bằng vé
Route::middleware(['auth:sanctum', 'employee.active', 'ability:employee'])->prefix('employee')->group(function () {
    Route::get('/me', [EmployeeAuthController::class, 'me']);
    Route::post('/password/setup', [EmployeeAuthController::class, 'setupPassword']); // Gói #102: tự đặt mật khẩu trong phiên (PIN step-up)
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
    // Spec P4-B5: đổi ca thật giữa 2 NV (qua hub)
    Route::post('/shift-swaps', [ShiftSwapController::class, 'store']);
    Route::get('/shift-swaps/colleagues', [ShiftSwapController::class, 'colleagues']);
    Route::get('/shift-swaps/pending-for-me', [ShiftSwapController::class, 'pendingForMe']);
    Route::get('/shift-swaps/my-requests', [ShiftSwapController::class, 'myRequests']);
    Route::post('/shift-swaps/{id}/confirm', [ShiftSwapController::class, 'confirm']);
    // Audit 2026-10-23 A3-4/BM-11: cụm thao tác TẠI QUẦY (kho NV, thu/chi, hub)
    // bắt buộc kèm mã QR hub ?t= như thiết kế Gói 59 — frontend hub đã gắn sẵn.
    // → Gói phiên Hub 2026-11-05: cổng ?t= ĐÃ GỠ theo phán của Đại Vương.
    // Cụm tự phục vụ từ xa (đăng ký ca/xin nghỉ/chấm công) KHÔNG gắn để NV
    // còn dùng được ngoài quán như quyết định đã chốt Gói 35/46.
    // Gói phiên Hub 2026-11-05: bỏ hẳn wrapper staff_hub_token, nâng cụm kho NV
    // lên thẳng nhóm cha — phiên NV đăng nhập là đủ (phán Đại Vương 05/11).
    // (Bài học 2026-11-05: Route::group() trần không kèm mảng attributes sẽ
    // TypeError lúc đăng ký route — gỡ cổng là BỎ wrapper, không thay group rỗng.)
        // Gói 43: kho cho NV (3 trang mobile /kiem-ke, /che-bien, /nhap-kho)
        Route::get('/materials', [EmployeeInventoryController::class, 'materials']);
        Route::get('/suppliers', [EmployeeInventoryController::class, 'suppliers']);
        Route::get('/stocktakes', [EmployeeInventoryController::class, 'stocktakes']);
        Route::get('/stocktake-meta', [EmployeeInventoryController::class, 'branches']); // Gói 55 p11t
        Route::post('/stocktakes/{id}/items', [EmployeeInventoryController::class, 'addStocktakeItems'])->whereNumber('id'); // Gói 55 p11w
        Route::delete('/stocktakes/{id}/items/{itemId}', [EmployeeInventoryController::class, 'removeStocktakeItem'])->whereNumber('id')->whereNumber('itemId'); // Gói 55 p11w
        Route::delete('/stocktakes/{id}', [EmployeeInventoryController::class, 'deleteStocktake'])->whereNumber('id'); // Gói 55 p11w
        Route::post('/stocktakes', [EmployeeInventoryController::class, 'storeStocktake']);
        Route::get('/stocktakes/{id}', [EmployeeInventoryController::class, 'showStocktake'])->whereNumber('id');
        Route::patch('/stocktakes/{id}/counts', [EmployeeInventoryController::class, 'updateStocktakeCounts'])->whereNumber('id');
        Route::post('/stocktakes/{id}/confirm', [EmployeeInventoryController::class, 'confirmStocktake'])->whereNumber('id');
        Route::get('/production-materials', [EmployeeInventoryController::class, 'productionMaterials']);
        Route::get('/production-recipes', [EmployeeInventoryController::class, 'productionRecipes']);
        Route::post('/productions', [EmployeeInventoryController::class, 'storeProduction']);
        Route::get('/productions', [EmployeeInventoryController::class, 'productions']);
        Route::post('/inbound-receipts', [EmployeeInventoryController::class, 'storeInboundReceipt']);
        // K-R1: NV xem phiếu nhập nháp của mình
        Route::get('/inbound-receipts', [EmployeeInventoryController::class, 'myInboundReceipts']);
        // Spec Phiếu đặt hàng NCC §6A (2026-11-08): đặt hàng tại Hub — chi nhánh theo phiên, không qua duyệt
        Route::get('/purchase-orders', [EmployeeInventoryController::class, 'purchaseOrders']);
        Route::post('/purchase-orders', [EmployeeInventoryController::class, 'storePurchaseOrder']);
        Route::get('/purchase-orders/{id}', [EmployeeInventoryController::class, 'showPurchaseOrder'])->whereNumber('id');
        Route::patch('/purchase-orders/{id}', [EmployeeInventoryController::class, 'updatePurchaseOrder'])->whereNumber('id');
        Route::post('/purchase-orders/{id}/mark-ordered', [EmployeeInventoryController::class, 'markOrderedPurchaseOrder'])->whereNumber('id');
        Route::post('/purchase-orders/{id}/cancel', [EmployeeInventoryController::class, 'cancelPurchaseOrder'])->whereNumber('id');
        Route::post('/outbound-receipts', [EmployeeInventoryController::class, 'storeOutboundReceipt']); // Gói 55 p11aa
        Route::post('/stock-transfers', [EmployeeInventoryController::class, 'storeStockTransfer']); // Gói 55 p11aa
        Route::get('/units', [UnitController::class, 'index']); // Gói 55 p11z: đơn vị tính cho NV chọn
        Route::post('/transactions', [TransactionController::class, 'store']); // Gói 59: NV tạo phiếu thu/chi (chờ duyệt)

    // Gói "Chờ duyệt trên Hub" (2026-10-21): cụm Chờ duyệt cho quản lý trực ca.
    // Quyền kiểm bằng đúng middleware permission (mirror CheckPermission) theo từng nhóm loại.
    Route::get('/approvals/counts', [EmployeeApprovalController::class, 'counts']);
    Route::get('/approvals/processed-today', [EmployeeApprovalController::class, 'processedToday']);
    // Cây phân quyền §2: mỗi loại phiếu duyệt bằng đúng khóa approve lá của
    // mục con đó (EmployeeApprovalController::TYPES trỏ sang cùng khóa).
    Route::prefix('approvals')->group(function () {
        $approvalPerms = [
            'inbound' => 'inventory.inbound.approve',
            'outbound' => 'inventory.outbound.approve',
            'transfer' => 'inventory.transfer.approve',
            'stocktake_adjustment' => 'inventory.stocktake.approve',
        ];
        foreach ($approvalPerms as $t => $perm) {
            Route::middleware(["permission:{$perm}"])->group(function () use ($t) {
                Route::get("/$t", [EmployeeApprovalController::class, 'index'])->defaults('type', $t);
                Route::get("/$t/{id}", [EmployeeApprovalController::class, 'show'])->defaults('type', $t);
                Route::post("/$t/{id}/approve", [EmployeeApprovalController::class, 'approve'])->defaults('type', $t);
                Route::post("/$t/{id}/reject", [EmployeeApprovalController::class, 'reject'])->defaults('type', $t);
            });
        }
    });
    Route::middleware(['permission:finance.transactions.approve'])->prefix('approvals')->group(function () {
        Route::get('/transaction', [EmployeeApprovalController::class, 'index'])->defaults('type', 'transaction');
        Route::get('/transaction/{id}', [EmployeeApprovalController::class, 'show'])->defaults('type', 'transaction');
        Route::post('/transaction/{id}/approve', [EmployeeApprovalController::class, 'approve'])->defaults('type', 'transaction');
        Route::post('/transaction/{id}/reject', [EmployeeApprovalController::class, 'reject'])->defaults('type', 'transaction');
    });
    // Remedy NV-G5 (2026-11-06): công nợ chờ thu trong Hub — phiếu đã duyệt còn nợ + ghi thanh toán (PIN step-up, delegate pay()).
    Route::middleware(['permission:finance.transactions.pay'])->group(function () {
        Route::get('/debts', [EmployeeApprovalController::class, 'debts']);
        Route::post('/debts/{id}/pay', [EmployeeApprovalController::class, 'payDebt'])->whereNumber('id');
    });
    Route::prefix('approvals')->group(function () {
        $leavePerms = [
            'shift_registration' => 'attendance.registrations.approve',
            'leave_request' => 'attendance.leaves.approve',
        ];
        foreach ($leavePerms as $t => $perm) {
            Route::middleware(["permission:{$perm}"])->group(function () use ($t) {
                Route::get("/$t", [EmployeeApprovalController::class, 'index'])->defaults('type', $t);
                Route::get("/$t/{id}", [EmployeeApprovalController::class, 'show'])->defaults('type', $t);
                Route::post("/$t/{id}/approve", [EmployeeApprovalController::class, 'approve'])->defaults('type', $t);
                Route::post("/$t/{id}/reject", [EmployeeApprovalController::class, 'reject'])->defaults('type', $t);
            });
        }
    });
});
// Gói 26: đăng nhập nhân viên (username/password)
Route::post('/employee/login', [EmployeeAuthController::class, 'login'])->middleware('throttle:10,1');

// BẮT BUỘC ĐĂNG NHẬP MỚI ĐƯỢC GỌI CÁC API DƯỚI ĐÂY
// Gói 1 (2026-10-04): Route hóa toàn bộ controllers (trước đây 6/9 controller chưa có route).
Route::middleware('auth:sanctum')->group(function () {

    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    // Đăng xuất thật (2026-11-08): thu hồi đúng token đang gọi, phiên khác giữ nguyên
    Route::post('/logout', [AuthController::class, 'logout']);

    // Cây phân quyền §2.0A: đổi mật khẩu tạm tài khoản quản trị — KHÔNG gắn
    // middleware permission (người đang bị cờ must_change_password vẫn đổi được).
    // §EW 🟡: thêm throttle như các endpoint mật khẩu khác (10,1).
    Route::post('/user/password/change', [AuthController::class, 'changePassword'])->middleware('throttle:10,1');

    // Cây phân quyền §2.0/§2.0A: quản lý tài khoản quản trị (Chủ Sở Hữu +
    // Chủ Chi Nhánh) + nhật ký tài khoản — CHỈ Chủ Sở Hữu (gác thêm trong
    // controller; middleware staff.roles.edit giữ mặt phẳng quản trị phân
    // quyền, không phải quyền cấp qua chức vụ).
    Route::middleware('permission:staff.roles.edit')->group(function () {
        Route::get('/admin-accounts', [AdminAccountController::class, 'index']);
        Route::post('/admin-accounts', [AdminAccountController::class, 'store']);
        Route::delete('/admin-accounts/{id}', [AdminAccountController::class, 'destroy'])->whereNumber('id');
        Route::get('/account-audit-logs', [AdminAccountController::class, 'auditLogs']);
    });

    // Danh mục & mặt hàng — Gói SEC: ghi mặt hàng chỉ role có products.manage (đọc mở cho POS)
    // Gói 55 p11ae: danh mục ghi cũng cần products.manage (trước đây NV bất kỳ sửa được)
    Route::get('/categories', [CategoryController::class, 'index']);
    Route::get('/categories/{category}', [CategoryController::class, 'show']);
    Route::post('/categories', [CategoryController::class, 'store'])->middleware('permission:products.categories.create');
    Route::put('/categories/{category}', [CategoryController::class, 'update'])->middleware('permission:products.categories.edit');
    Route::patch('/categories/{category}', [CategoryController::class, 'update'])->middleware('permission:products.categories.edit');
    Route::delete('/categories/{category}', [CategoryController::class, 'destroy'])->middleware('permission:products.categories.delete');
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{product}', [ProductController::class, 'show']);
    Route::post('/products', [ProductController::class, 'store'])->middleware('permission:products.list.create');
    Route::put('/products/{product}', [ProductController::class, 'update'])->middleware('permission:products.list.edit');
    Route::patch('/products/{product}', [ProductController::class, 'update'])->middleware('permission:products.list.edit');
    Route::delete('/products/{product}', [ProductController::class, 'destroy'])->middleware('permission:products.list.delete');
    Route::patch('/products/{product}/favorite', [ProductController::class, 'toggleFavorite'])->middleware('permission:products.list.edit'); // Gói 9 + Audit 23/10 B-10
    // Gói 33: thao tác hàng loạt mặt hàng — CHỈ admin cấp cao nhất (role có "*")
    Route::middleware('permission:products.list.bulk')->group(function () {
        Route::post('/products/bulk-action', [ProductController::class, 'bulkAction']);
        Route::post('/products/bulk-update', [ProductController::class, 'bulkUpdate']);
    });

    // Gói 25: ẩn/hiện mặt hàng & thực đơn theo chi nhánh (mặc định hiện tất cả, chỉ lưu override ẩn)
    // Gói 55 p11ae: ghi cần products.manage
    Route::get('/visibility/products', [BranchVisibilityController::class, 'productMatrix']);
    Route::get('/visibility/menus', [BranchVisibilityController::class, 'menuMatrix']);
    Route::middleware('permission:products.list.edit')->group(function () {
        Route::post('/visibility/products/toggle', [BranchVisibilityController::class, 'toggleProduct']);
        Route::post('/visibility/products/sync', [BranchVisibilityController::class, 'syncProducts']);
    });
    Route::middleware('permission:products.menus.edit')->group(function () {
        Route::post('/visibility/menus/toggle', [BranchVisibilityController::class, 'toggleMenu']);
        Route::post('/visibility/menus/sync', [BranchVisibilityController::class, 'syncMenus']);
    });

    // Thực đơn (POS / Zalo Mini App)
    Route::get('/menu', [MenuController::class, 'index'])->middleware('throttle:online-read');
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — POS dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index'])->middleware('throttle:online-read');

    // Chi nhánh (dropdown)
    Route::get('/branches', [BranchController::class, 'index'])->middleware('throttle:online-read');

    // Gói 15 (2026-10-08): Báo cáo Giám đốc — 1 endpoint trả đủ 4 tab — mỗi
    // báo cáo gác đúng lá reports.* của nó (cây phân quyền §2).
    // Gói 17: Báo cáo kho + Báo cáo thu chi/PNL
    Route::get('/reports/overview', [ReportController::class, 'overview'])->middleware('permission:reports.overview.view');
    Route::get('/reports/inventory', [ReportController::class, 'inventory'])->middleware('permission:reports.inventory.view');
    Route::get('/reports/pnl', [ReportController::class, 'pnl'])->middleware('permission:reports.pnl.view');
    // Spec P4-C5: tổng hợp thu/chi theo danh mục + kỳ
    Route::get('/reports/cash-summary', [ReportController::class, 'cashSummary'])->middleware('permission:reports.cash.view');
    // Spec P4-C6: báo cáo nhân sự tổng hợp
    Route::get('/reports/hr-summary', [ReportController::class, 'hrSummary'])->middleware('permission:reports.hr.view');
    // Gói 56 (2026-10-14): KPI vận hành trong ngày
    Route::get('/reports/operations', [ReportController::class, 'operations'])->middleware('permission:reports.operations.view');
    // Gói 57: Menu Engineering + xuất Excel chi tiết bill
    Route::get('/reports/menu-engineering', [ReportController::class, 'menuEngineering'])->middleware('permission:reports.menu.view');
    Route::get('/reports/revenue/export', [ReportController::class, 'exportRevenue'])->middleware('permission:reports.revenue.export');
    // Gói 55 p11ag: báo cáo đơn hủy theo nhân viên (chống gian lận)
    Route::get('/reports/cancelled-by-staff', [ReportController::class, 'cancelledByStaff'])->middleware('permission:reports.cancelled.view');

    // Đơn hàng — Audit 2026-10-23 B-2/B-6/BM-04: đọc cần orders.view, tạo orders.create, thao tác ghi orders.edit
    Route::get('/orders', [OrderController::class, 'index'])->middleware('permission:orders.list.view');
    Route::post('/orders', [OrderController::class, 'store'])->middleware('permission:orders.create');
    // Gói 13: xóa GET /orders/history (endpoint chết, Gói 12a thay thế bằng rule 24h ở OnlineOrderController)
    Route::get('/orders/code/{code}', [OrderController::class, 'showByCode'])->middleware('permission:orders.list.view');
    Route::patch('/orders/{id}/status', [OrderController::class, 'updateStatus'])->middleware('permission:orders.edit');
    Route::post('/orders/{id}/cancel', [OrderController::class, 'cancel'])->middleware('permission:orders.edit');
    // Gói 33: thao tác hàng loạt hóa đơn (hủy/xóa) — CHỈ admin cấp cao nhất (role có "*")
    Route::middleware('permission:orders.bulk')->post('/orders/bulk-action', [OrderController::class, 'bulkAction']);
    Route::post('/orders/{id}/split', [OrderController::class, 'split'])->middleware('permission:orders.edit');   // Gói 3: tách đơn
    Route::post('/orders/merge', [OrderController::class, 'merge'])->middleware('permission:orders.edit');       // Gói 3: gộp đơn
    Route::get('/orders/held', [OrderController::class, 'heldOrders'])->middleware('permission:orders.list.view');    // Gói 3b: danh sách đơn lưu
    Route::post('/orders/{id}/finalize', [OrderController::class, 'finalize'])->middleware('permission:orders.edit'); // Gói 3b: thanh toán đơn lưu
    // Gói 23: import đơn hàng từ Excel (wizard 4 bước)
    Route::middleware('permission:orders.bulk')->group(function () {
        Route::post('/orders/import-excel', [OrderImportController::class, 'upload']);
        Route::post('/orders/import-excel/validate', [OrderImportController::class, 'validateRows']);
        Route::post('/orders/import-excel/confirm', [OrderImportController::class, 'confirm']);
    });
    // Audit 2026-10-23 B-3/BM-04 + cây phân quyền §3.4(d): cụm Sapo gác
    // theo settings.sapo.* — RIÊNG cấu hình hộp thư IMAP (chứa App Password)
    // thuộc tầng bí mật settings.secrets.* (chỉ Chủ Sở Hữu).
    Route::middleware('permission:settings.sapo.view')->group(function () {
        // Cầu nối Sapo — Phần A: nhật ký import
        Route::get('/sapo/import-runs', [SapoImportController::class, 'runs']);
        Route::get('/sapo/import-runs/{id}', [SapoImportController::class, 'runDetail']);
        // Cầu nối Sapo — Phần B: map tên món/tùy chọn + cấu hình (đọc)
        Route::get('/sapo/meta', [SapoAdminController::class, 'meta']);
        Route::get('/sapo/unmapped', [SapoAdminController::class, 'unmapped']);
        Route::get('/sapo/products-catalog', [SapoAdminController::class, 'productsCatalog']);
        Route::get('/sapo/options-catalog', [SapoAdminController::class, 'optionsCatalog']);
        Route::get('/sapo/config', [SapoAdminController::class, 'config']);
        Route::get('/sapo/maps/{table}', [SapoAdminController::class, 'mapIndex']);
        // Thu gọn map (2026-10-30): đăng ký TRƯỚC route {id} để 'redundant' không bị nuốt thành id
        Route::get('/sapo/maps/{table}/redundant', [SapoAdminController::class, 'mapRedundant']);
        // Cầu nối Sapo — Phần C: nhật ký hộp thư
        Route::get('/sapo/mail/logs', [SapoMailController::class, 'logs']);
        // Cầu nối Sapo — Phần D: hàng đợi nghi ngờ (đọc)
        Route::get('/sapo/suspects', [SapoImportController::class, 'suspects']);
    });
    Route::middleware('permission:settings.sapo.edit')->group(function () {
        // Cầu nối Sapo — Phần A: import file Excel Sapo
        Route::post('/sapo/import', [SapoImportController::class, 'import']);
        // Cầu nối Sapo — Phần B: cấu hình + map (ghi)
        Route::put('/sapo/config', [SapoAdminController::class, 'updateConfig']);
        Route::post('/sapo/maps/{table}', [SapoAdminController::class, 'mapStore']);
        Route::delete('/sapo/maps/{table}/redundant', [SapoAdminController::class, 'mapPruneRedundant']);
        Route::delete('/sapo/maps/{table}/{id}', [SapoAdminController::class, 'mapDestroy']);
        // Cầu nối Sapo — Phần C: kiểm tra mail ngay (không chạm mật khẩu)
        Route::post('/sapo/mail/check-now', [SapoMailController::class, 'checkNow']);
        // Cầu nối Sapo — Phần D: xử lý hàng đợi nghi ngờ
        Route::post('/sapo/suspects/{id}/rerun', [SapoImportController::class, 'suspectRerun']);
        Route::post('/sapo/suspects/{id}/force-create', [SapoImportController::class, 'suspectForceCreate']);
        Route::post('/sapo/suspects/{id}/discard', [SapoImportController::class, 'suspectDiscard']);
        Route::post('/sapo/suspects/{id}/resolve', [SapoImportController::class, 'suspectResolve']); // Gói 4 (2026-10-28): đánh dấu đã xử lý tay
    });
    // Cầu nối Sapo — Phần C: cấu hình hộp thư IMAP (tầng bí mật, chỉ Owner).
    Route::get('/sapo/mail/config', [SapoMailController::class, 'config'])->middleware('permission:settings.secrets.view');
    Route::put('/sapo/mail/config', [SapoMailController::class, 'updateConfig'])->middleware('permission:settings.secrets.edit');
    // Gói 60: giao hàng — thử tạo lại đơn hãng, xem log, báo cáo failover
    Route::post('/orders/{order}/delivery/retry', [DeliveryController::class, 'retry'])->middleware('permission:orders.edit');
    // Spec KDS book ship (2026-11-06): thao tác đặt ship tại KDS — báo phí theo
    // đơn · đặt hãng · hủy tìm/chuyển tay · bắt đầu tay · chuyển bước tay · đính chính ghim
    Route::post('/orders/{order}/delivery/quote', [DeliveryController::class, 'quoteForOrder']);
    Route::post('/orders/{order}/delivery/book', [DeliveryController::class, 'book']);
    Route::post('/orders/{order}/delivery/to-manual', [DeliveryController::class, 'toManual']);
    Route::post('/orders/{order}/delivery/manual/start', [DeliveryController::class, 'manualStart']);
    Route::post('/orders/{order}/delivery/manual/advance', [DeliveryController::class, 'manualAdvance']);
    Route::post('/orders/{order}/delivery/pin', [DeliveryController::class, 'correctPin']);
    Route::get('/orders/{order}/delivery/logs', [DeliveryController::class, 'logs']);
    Route::get('/delivery/failover-report', [DeliveryController::class, 'failoverReport']);
    Route::get('/delivery/config', [DeliveryController::class, 'config'])->middleware('throttle:online-read');

    // Bàn phục vụ (Gói 3) — Gói 55 p11ae: ghi cần branches.manage (POS chỉ đọc)
    Route::get('/tables', [TableController::class, 'index']);
    Route::post('/tables', [TableController::class, 'store'])->middleware('permission:branches.tables.create');
    Route::patch('/tables/{id}', [TableController::class, 'update'])->middleware('permission:branches.tables.edit');
    Route::delete('/tables/{id}', [TableController::class, 'destroy'])->middleware('permission:branches.tables.delete');

    // Màn hình bếp/bar (KDS) — frontend poll mỗi 3s
    Route::get('/kds/orders', [OrderController::class, 'kdsOrders']);

    // Ca làm việc
    Route::get('/shifts/current', [ShiftController::class, 'currentShift']);
    Route::post('/shifts/open', [ShiftController::class, 'openShift']);
    Route::post('/shifts/{id}/expense', [ShiftController::class, 'addExpense']);
    Route::post('/shifts/{id}/close', [ShiftController::class, 'closeShift']);

    // Kho — Gói SEC: quick-adjust chỉ role có inventory.adjust
    Route::get('/inventory/branch/{branchId}', [InventoryController::class, 'getStockByBranch']);
    // Spec P4-A1/A2: BTP dưới ngưỡng khẩu phần + lô sắp hết HSD
    Route::get('/inventory/btp-low-stock', [InventoryController::class, 'btpLowStock']);
    Route::get('/inventory/expiring-batches', [InventoryController::class, 'expiringBatches']);
    Route::middleware('permission:inventory.stock.adjust')->post('/inventory/quick-adjust', [InventoryController::class, 'quickAdjust']); // Gói 55 p11: −/+ nhanh
    Route::middleware('permission:inventory.inbound.create')->group(function () {
        Route::post('/inbound', [InboundController::class, 'store']);
        Route::post('/inbound/bulk', [InboundController::class, 'storeBulk']);
    });
    // Gói 55 p11b: duyệt đề xuất điều chỉnh kho từ chênh lệch kiểm kê
    Route::get('/stocktake-adjustments', [StocktakeAdjustmentController::class, 'index'])->middleware('permission:inventory.stocktake.view');
    Route::middleware('permission:inventory.stocktake.approve')->group(function () {
        Route::post('/stocktake-adjustments/{id}/approve', [StocktakeAdjustmentController::class, 'approve'])->whereNumber('id');
        Route::post('/stocktake-adjustments/{id}/reject', [StocktakeAdjustmentController::class, 'reject'])->whereNumber('id');
    });

    // Gói 27 (2026-10-09): Thu-Chi — gác theo lá finance.* của cây §2.
    // Quỹ/tài khoản + chi phí trả trước: cây không có mục con riêng, xếp vào
    // miền finance.transactions (số tài chính) theo từng hành động.
    Route::get('/transactions', [TransactionController::class, 'index'])->middleware('permission:finance.transactions.view');
    Route::post('/transactions', [TransactionController::class, 'store'])->middleware('permission:finance.transactions.create');
    Route::put('/transactions/{id}', [TransactionController::class, 'update'])->middleware('permission:finance.transactions.edit');
    Route::delete('/transactions/{id}', [TransactionController::class, 'destroy'])->middleware('permission:finance.transactions.delete');
    Route::post('/transactions/{id}/pay', [TransactionController::class, 'pay'])->middleware('permission:finance.transactions.pay'); // Gói 29: thanh toán trừ dần
    Route::post('/transactions/{id}/approve', [TransactionController::class, 'approve'])->middleware('permission:finance.transactions.approve'); // Gói 59: duyệt phiếu NV
    Route::post('/transactions/{id}/reject', [TransactionController::class, 'reject'])->middleware('permission:finance.transactions.approve'); // Gói "Chờ duyệt trên Hub" (2026-10-21): từ chối + lý do bắt buộc
    Route::post('/transaction-categories', [TransactionController::class, 'storeCategory'])->middleware('permission:finance.categories.create');
    Route::put('/transaction-categories/{id}', [TransactionController::class, 'updateCategory'])->middleware('permission:finance.categories.edit'); // Gói 29
    Route::delete('/transaction-categories/{id}', [TransactionController::class, 'destroyCategory'])->middleware('permission:finance.categories.delete');
    // Gói 57: quỹ/tài khoản + chi phí trả trước
    Route::apiResource('accounts', AccountController::class)->only(['index', 'show'])->middleware('permission:finance.transactions.view')->whereNumber('account');
    Route::apiResource('accounts', AccountController::class)->only(['store'])->middleware('permission:finance.transactions.create')->whereNumber('account');
    Route::apiResource('accounts', AccountController::class)->only(['update'])->middleware('permission:finance.transactions.edit')->whereNumber('account');
    Route::apiResource('accounts', AccountController::class)->only(['destroy'])->middleware('permission:finance.transactions.delete')->whereNumber('account');
    Route::apiResource('prepaid-expenses', PrepaidExpenseController::class)->only(['index', 'show'])->middleware('permission:finance.transactions.view');
    Route::apiResource('prepaid-expenses', PrepaidExpenseController::class)->only(['store'])->middleware('permission:finance.transactions.create');
    Route::apiResource('prepaid-expenses', PrepaidExpenseController::class)->only(['update'])->middleware('permission:finance.transactions.edit');
    Route::apiResource('prepaid-expenses', PrepaidExpenseController::class)->only(['destroy'])->middleware('permission:finance.transactions.delete');
    // Gói PNL kênh sàn (2026-10-31): đối soát phí marketing sàn theo (kênh × CN × tháng)
    Route::get('/channel-adjustments', [ChannelAdjustmentController::class, 'index'])->middleware('permission:finance.channels.view');
    Route::post('/channel-adjustments', [ChannelAdjustmentController::class, 'store'])->middleware('permission:finance.channels.create');
    Route::put('/channel-adjustments/{id}', [ChannelAdjustmentController::class, 'update'])->middleware('permission:finance.channels.edit');
    Route::post('/channel-adjustments/{id}/void', [ChannelAdjustmentController::class, 'voidAdjustment'])->middleware('permission:finance.channels.edit');
    Route::post('/channel-adjustments/{id}/reopen', [ChannelAdjustmentController::class, 'reopen'])->middleware('permission:finance.channels.edit');
    Route::get('/transaction-categories', [TransactionController::class, 'categories']);

    // Gói 29 (2026-10-09): Đối tác + công nợ (dùng chung toàn chuỗi)
    // Lưu ý: /partners/debt-summary PHẢI đứng trước /partners/{id} để không bị nuốt route.
    // Gói 55 p11ae: ghi cần inventory.manage (NCC phục vụ nhập hàng)
    Route::get('/partners', [PartnerController::class, 'index']);
    Route::get('/partners/debt-summary', [PartnerController::class, 'debtSummary']);
    Route::get('/partners/{id}', [PartnerController::class, 'show'])->whereNumber('id');
    Route::get('/partners/{id}/payments', [PartnerController::class, 'payments'])->whereNumber('id');
    Route::post('/partners', [PartnerController::class, 'store'])->middleware('permission:inventory.partners.create');
    Route::put('/partners/{id}', [PartnerController::class, 'update'])->whereNumber('id')->middleware('permission:inventory.partners.edit');
    Route::delete('/partners/{id}', [PartnerController::class, 'destroy'])->whereNumber('id')->middleware('permission:inventory.partners.delete');

    // Gói 4: nguyên vật liệu — Gói 55 p11ae: ghi cần inventory.manage
    Route::get('/materials', [MaterialController::class, 'index']);
    Route::get('/materials/{id}/linked-products', [MaterialController::class, 'linkedProducts']); // Gói 55 p11m
    Route::post('/materials/{id}/unlink', [MaterialController::class, 'unlinkProduct'])->middleware('permission:inventory.materials.edit'); // Gói 55 p11n
    Route::post('/materials', [MaterialController::class, 'store'])->middleware('permission:inventory.materials.create');
    Route::patch('/materials/{id}', [MaterialController::class, 'update'])->middleware('permission:inventory.materials.edit');
    Route::delete('/materials/{id}', [MaterialController::class, 'destroy'])->middleware('permission:inventory.materials.delete');
    Route::post('/materials/bulk', [MaterialController::class, 'bulk'])->middleware('permission:inventory.materials.edit'); // Gói 55 p11l
    Route::post('/materials/bulk-update', [MaterialController::class, 'bulkUpdate'])->middleware('permission:inventory.materials.edit'); // Gói 55 p11w
    Route::post('/materials/import-preview', [MaterialController::class, 'importPreview'])->middleware('permission:inventory.materials.edit'); // Gói 55 p11s

    // Gói 22: loại danh mục nguyên liệu (nhóm kiểm kho động) — Gói 55 p11ae: ghi cần inventory.manage
    Route::get('/material-categories', [MaterialCategoryController::class, 'index']);
    Route::post('/material-categories', [MaterialCategoryController::class, 'store'])->middleware('permission:inventory.materials.create');
    Route::post('/material-categories/reorder', [MaterialCategoryController::class, 'reorder'])->middleware('permission:inventory.materials.edit');
    Route::patch('/material-categories/{id}', [MaterialCategoryController::class, 'update'])->middleware('permission:inventory.materials.edit');
    Route::delete('/material-categories/{id}', [MaterialCategoryController::class, 'destroy'])->middleware('permission:inventory.materials.delete');

    // Gói 4: chế biến bán thành phẩm
    Route::get('/production-recipes', [ProductionController::class, 'recipes']);
    Route::post('/production-recipes', [ProductionController::class, 'storeRecipe'])->middleware('permission:inventory.production.create');
    Route::delete('/production-recipes/{id}', [ProductionController::class, 'destroyRecipe'])->middleware('permission:inventory.production.delete');
    Route::post('/productions', [ProductionController::class, 'produce'])->middleware('permission:inventory.production.create');
    Route::get('/productions', [ProductionController::class, 'index']);

    // Gói 4: kiểm kê kho — Gói SEC: chỉ role có inventory.manage
    Route::get('/stocktakes', [StocktakeController::class, 'index'])->middleware('permission:inventory.stocktake.view');
    Route::get('/stocktakes/{id}', [StocktakeController::class, 'show'])->whereNumber('id')->middleware('permission:inventory.stocktake.view');
    Route::post('/stocktakes', [StocktakeController::class, 'store'])->middleware('permission:inventory.stocktake.create');
    Route::patch('/stocktakes/{id}/counts', [StocktakeController::class, 'updateCounts'])->whereNumber('id')->middleware('permission:inventory.stocktake.edit');
    Route::post('/stocktakes/{id}/confirm', [StocktakeController::class, 'confirm'])->whereNumber('id')->middleware('permission:inventory.stocktake.edit');

    // Gói 43: chuyển kho giữa các chi nhánh — Gói SEC
    Route::get('/stock-transfers', [StockTransferController::class, 'index'])->middleware('permission:inventory.transfer.view');
    Route::get('/stock-transfers/{id}', [StockTransferController::class, 'show'])->whereNumber('id')->middleware('permission:inventory.transfer.view');
    Route::post('/stock-transfers', [StockTransferController::class, 'store'])->middleware('permission:inventory.transfer.create');
    Route::post('/stock-transfers/{id}/confirm', [StockTransferController::class, 'confirm'])->whereNumber('id')->middleware('permission:inventory.transfer.approve');
    Route::post('/stock-transfers/{id}/cancel', [StockTransferController::class, 'cancel'])->whereNumber('id')->middleware('permission:inventory.transfer.delete');
    Route::get('/stock-transfer-stock', [StockTransferController::class, 'stock'])->middleware('permission:inventory.transfer.view');
    // Gói 43: phiếu nhập hàng theo hóa đơn — Gói SEC
    Route::get('/inbound-receipts', [InboundReceiptController::class, 'index'])->middleware('permission:inventory.inbound.view');
    Route::get('/inbound-receipts/{id}', [InboundReceiptController::class, 'show'])->whereNumber('id')->middleware('permission:inventory.inbound.view');
    Route::post('/inbound-receipts', [InboundReceiptController::class, 'store'])->middleware('permission:inventory.inbound.create');
    Route::patch('/inbound-receipts/{id}', [InboundReceiptController::class, 'update'])->whereNumber('id')->middleware('permission:inventory.inbound.edit');
    Route::post('/inbound-receipts/{id}/cancel', [InboundReceiptController::class, 'cancel'])->whereNumber('id')->middleware('permission:inventory.inbound.delete');
    // K-R1: duyệt phiếu nhập nháp của NV
    Route::post('/inbound-receipts/{id}/approve', [InboundReceiptController::class, 'approve'])->whereNumber('id')->middleware('permission:inventory.inbound.approve');
    // Spec Phiếu đặt hàng NCC (2026-11-08): phiếu đặt hàng tới NCC — không qua duyệt
    Route::get('/purchase-orders', [PurchaseOrderController::class, 'index'])->middleware('permission:inventory.purchase.view');
    Route::post('/purchase-orders', [PurchaseOrderController::class, 'store'])->middleware('permission:inventory.purchase.create');
    Route::get('/purchase-orders/{id}', [PurchaseOrderController::class, 'show'])->whereNumber('id')->middleware('permission:inventory.purchase.view');
    Route::patch('/purchase-orders/{id}', [PurchaseOrderController::class, 'update'])->whereNumber('id')->middleware('permission:inventory.purchase.edit');
    Route::post('/purchase-orders/{id}/mark-ordered', [PurchaseOrderController::class, 'markOrdered'])->whereNumber('id')->middleware('permission:inventory.purchase.edit');
    Route::post('/purchase-orders/{id}/cancel', [PurchaseOrderController::class, 'cancel'])->whereNumber('id')->middleware('permission:inventory.purchase.delete');
    // Gói 55 p11z: phiếu xuất kho (trừ kho FIFO khi chốt) — Gói SEC
    Route::get('/outbound-receipts', [OutboundController::class, 'index'])->middleware('permission:inventory.outbound.view');
    Route::post('/outbound-receipts', [OutboundController::class, 'store'])->middleware('permission:inventory.outbound.create');
    Route::get('/outbound-receipts/{id}', [OutboundController::class, 'show'])->whereNumber('id')->middleware('permission:inventory.outbound.view');
    Route::post('/outbound-receipts/{id}/confirm', [OutboundController::class, 'confirm'])->whereNumber('id')->middleware('permission:inventory.outbound.approve');
    Route::post('/outbound-receipts/{id}/cancel', [OutboundController::class, 'cancel'])->whereNumber('id')->middleware('permission:inventory.outbound.delete');

    // Gói 5: CRM — khách hàng — Gói 55 p11ae: ghi cần customers.manage (chống NV tự cộng điểm/nâng hạng)
    Route::get('/customers', [CustomerController::class, 'index'])->middleware('permission:customers.list.view');
    Route::get('/customers/{id}', [CustomerController::class, 'show'])->middleware('permission:customers.list.view')->whereNumber('id');
    Route::post('/customers', [CustomerController::class, 'store'])->middleware('permission:customers.list.create');
    Route::patch('/customers/{id}', [CustomerController::class, 'update'])->whereNumber('id')->middleware('permission:customers.list.edit');
    // Spec mật khẩu khách §5.3/§7.4: cửa sổ đặt mật khẩu tại quầy + cấp lại mã TV.
    Route::post('/customers/{id}/password-setup-window', [CustomerController::class, 'openPasswordSetupWindow'])->whereNumber('id')->middleware('permission:customers.list.edit');
    Route::delete('/customers/{id}/password-setup-window', [CustomerController::class, 'closePasswordSetupWindow'])->whereNumber('id')->middleware('permission:customers.list.edit');
    Route::post('/customers/{id}/regenerate-member-code', [CustomerController::class, 'regenerateMemberCode'])->whereNumber('id')->middleware('permission:customers.list.edit');
    Route::post('/customers/{id}/adjust-points', [CustomerController::class, 'adjustPoints'])->whereNumber('id')->middleware('permission:customers.list.points');
    // Loyalty 2.0: thu hồi coupon trong ví (hoàn điểm về lô gốc nếu coupon do đổi điểm phát)
    Route::post('/customers/{id}/coupons/{couponId}/revoke', [CustomerController::class, 'revokeCoupon'])->whereNumber('id')->whereNumber('couponId')->middleware('permission:customers.list.edit');

    // Gói 5: hạng thành viên + cấu hình quy đổi điểm — Gói 55 p11ae: ghi cần customers.manage
    Route::get('/membership-tiers', [MembershipTierController::class, 'index']);
    Route::post('/membership-tiers', [MembershipTierController::class, 'store'])->middleware('permission:customers.tiers.edit');
    Route::patch('/membership-tiers/{id}', [MembershipTierController::class, 'update'])->middleware('permission:customers.tiers.edit');
    Route::delete('/membership-tiers/{id}', [MembershipTierController::class, 'destroy'])->middleware('permission:customers.tiers.edit');
    Route::post('/membership-tiers/redeem-config', [MembershipTierController::class, 'updateRedeemConfig'])->middleware('permission:customers.tiers.edit');
    // Loyalty 2.0: cấu hình loyalty toàn cục (cửa sổ/HSD/cảnh báo/Double Days/coupon chào hạng)
    Route::post('/membership-tiers/loyalty-config', [MembershipTierController::class, 'updateLoyaltyConfig'])->middleware('permission:customers.tiers.edit');
    // Minigame (2026-11-01): cấu hình + vận hành + thu hồi điểm theo phiên
    Route::get('/admin/minigame/config', [AdminMinigameController::class, 'config'])->middleware('permission:customers.minigame.view');
    Route::post('/admin/minigame/config', [AdminMinigameController::class, 'updateConfig'])->middleware('permission:customers.minigame.edit');
    Route::get('/admin/minigame/stats', [AdminMinigameController::class, 'stats'])->middleware('permission:customers.minigame.view');
    Route::get('/admin/minigame/sessions', [AdminMinigameController::class, 'sessions'])->middleware('permission:customers.minigame.view');
    Route::post('/admin/minigame/sessions/{id}/revoke', [AdminMinigameController::class, 'revoke'])->middleware('permission:customers.minigame.edit');

    // Loyalty 2.0: Cửa hàng điểm — Admin CRUD món đổi (đọc mở trong nhóm auth,
    // ghi cần customers.manage như các cấu hình loyalty khác)
    Route::get('/point-exchange-items', [PointExchangeItemController::class, 'index']);
    Route::post('/point-exchange-items', [PointExchangeItemController::class, 'store'])->middleware('permission:customers.exchange.create');
    Route::patch('/point-exchange-items/{id}', [PointExchangeItemController::class, 'update'])->middleware('permission:customers.exchange.edit');
    Route::delete('/point-exchange-items/{id}', [PointExchangeItemController::class, 'destroy'])->middleware('permission:customers.exchange.delete');

    // Gói 5: khuyến mại — Gói SEC: ghi chỉ role có products.manage (eligible mở cho POS/Mini App)
    Route::get('/promotions', [PromotionController::class, 'index']);
    Route::post('/promotions/eligible', [PromotionController::class, 'eligible'])->middleware('throttle:online-read')->middleware('throttle:60,1');
    Route::get('/promotions/{id}', [PromotionController::class, 'show']);
    Route::post('/promotions', [PromotionController::class, 'store'])->middleware('permission:products.promotions.create');
    Route::patch('/promotions/{id}', [PromotionController::class, 'update'])->middleware('permission:products.promotions.edit');
    Route::delete('/promotions/{id}', [PromotionController::class, 'destroy'])->middleware('permission:products.promotions.delete');

    // Spec 5 (2026-10-21): UI quản lý voucher — CRUD backend MỚI TOÀN BỘ.
    // Ghi: cùng phân quyền quản lý KM; đọc mở như /promotions.
    Route::get('/vouchers', [VoucherController::class, 'index']);
    Route::get('/vouchers/{id}', [VoucherController::class, 'show']);
    Route::get('/vouchers/{id}/usages', [VoucherController::class, 'usages']);
    Route::post('/vouchers', [VoucherController::class, 'store'])->middleware('permission:products.vouchers.create');
    Route::put('/vouchers/{id}', [VoucherController::class, 'update'])->middleware('permission:products.vouchers.edit');
    Route::delete('/vouchers/{id}', [VoucherController::class, 'destroy'])->middleware('permission:products.vouchers.delete');

    // SPEC R&D (2026-10-21, Đại Vương chốt): phân hệ R&D 3 tab — menu cấp 1 riêng.
    // Đọc: controller tự kiểm products.rd.view HOẶC reports.overview.view. Ghi/duyệt: products.rd.edit.
    Route::get('/rd/meta', [RDController::class, 'meta']);
    Route::get('/rd/products', [RDController::class, 'index']);
    Route::get('/rd/products/{id}', [RDController::class, 'show']);
    Route::get('/rd/fixed-costs', [RDController::class, 'fixedCosts']);
    Route::get('/rd/break-even', [RDController::class, 'breakEven']);
    Route::post('/rd/products', [RDController::class, 'store'])->middleware('permission:products.rd.create');
    Route::put('/rd/products/{id}', [RDController::class, 'update'])->middleware('permission:products.rd.edit');
    Route::put('/rd/products/{id}/quick-price', [RDController::class, 'quickPrice'])->middleware('permission:products.rd.edit');
    Route::post('/rd/products/{id}/clone', [RDController::class, 'clone'])->middleware('permission:products.rd.edit');
    Route::post('/rd/products/{id}/approve', [RDController::class, 'approve'])->middleware('permission:products.rd.approve');
    Route::post('/rd/products/{id}/discard', [RDController::class, 'discard'])->middleware('permission:products.rd.edit');
    Route::post('/rd/products/{id}/restore', [RDController::class, 'restore'])->middleware('permission:products.rd.edit');
    Route::delete('/rd/products/{id}', [RDController::class, 'destroy'])->middleware('permission:products.rd.delete');
    Route::post('/rd/fixed-costs', [RDController::class, 'storeFixedCost'])->middleware('permission:products.rd.create');
    Route::put('/rd/fixed-costs/{id}', [RDController::class, 'updateFixedCost'])->middleware('permission:products.rd.edit');
    Route::delete('/rd/fixed-costs/{id}', [RDController::class, 'destroyFixedCost'])->middleware('permission:products.rd.delete');
    Route::put('/rd/utilities-category', [RDController::class, 'setUtilitiesCategory'])->middleware('permission:products.rd.edit');

    // Gói 6: nhân viên xác nhận đơn online (đã nhận tiền -> trừ kho, vào KDS)
    Route::post('/orders/{id}/confirm-payment', [OnlineOrderController::class, 'confirmPayment'])->middleware('permission:orders.edit');
    // Gói 11: tạo mã QR tích điểm cho đơn POS
    Route::post('/orders/{id}/claim-qr', [OrderController::class, 'claimQr'])->middleware('permission:orders.edit');

    // Gói 6: cấu hình bán online — Gói SEC: ghi chi nhánh chỉ role có branches.manage
    Route::post('/branches', [BranchController::class, 'store'])->middleware('permission:branches.list.create');
    Route::patch('/branches/{id}', [BranchController::class, 'update'])->middleware('permission:branches.list.edit');

    // Gói 10f: upload ảnh cover Mini App (jpg/png/webp <= 1MB, tự crop 1200x500)
    // Gói 38: settings + upload cover — CHỈ role có settings.general.edit
    // Cây phân quyền §2.11/§3.4(d): thiết lập tách theo 5 mục settings.* —
    // RIÊNG QR Hub (chứa token) thuộc tầng bí mật settings.secrets.*.
    Route::middleware('permission:settings.general.edit')->group(function () {
        Route::post('/uploads/cover', [UploadController::class, 'cover']);
        Route::post('/uploads/promo-banner', [UploadController::class, 'promoBanner']); // Gói 49e
        Route::post('/uploads/product-image', [UploadController::class, 'productImage']); // Gói 55
        Route::post('/uploads/logo', [UploadController::class, 'logo']); // Logo sidebar Admin (2026-10-21)
        Route::post('/settings', [SettingsController::class, 'update']);
        // Gói chính sách Mini App vào Cài đặt Admin: đường lưu RIÊNG cho nội
        // dung chính sách (dài hơn rào 255 ký tự của POST /settings).
        Route::post('/settings/privacy-policy', [SettingsController::class, 'updatePrivacyPolicy']);
        Route::post('/settings/privacy-policy/reset', [SettingsController::class, 'resetPrivacyPolicy']);
        Route::get('/units', [UnitController::class, 'index']);
        Route::post('/units', [UnitController::class, 'store']);
        Route::put('/units/{id}', [UnitController::class, 'update']);
        Route::delete('/units/{id}', [UnitController::class, 'destroy']);
        // Spec danh mục dùng chung (2026-10-19): CRUD 13 tab danh mục nghiệp vụ
        Route::get('/shared-categories/groups', [SharedCategoryController::class, 'groups']);
        Route::get('/shared-categories/all', [SharedCategoryController::class, 'adminIndex']);
        Route::post('/shared-categories', [SharedCategoryController::class, 'store']);
        Route::patch('/shared-categories/{id}', [SharedCategoryController::class, 'update']);
        Route::delete('/shared-categories/{id}', [SharedCategoryController::class, 'destroy']);
        Route::post('/shared-categories/restore-defaults', [SharedCategoryController::class, 'restoreDefaults']);
    });
    // Gói 52: phương thức thanh toán + đơn vị tính
    Route::get('/payment-methods', [PaymentMethodController::class, 'index'])->middleware('permission:settings.payments.view');
    Route::middleware('permission:settings.payments.edit')->group(function () {
        Route::post('/payment-methods', [PaymentMethodController::class, 'store']);
        Route::put('/payment-methods/{id}', [PaymentMethodController::class, 'update']);
        Route::delete('/payment-methods/{id}', [PaymentMethodController::class, 'destroy']);
    });
    // Gói 55: tên thay thế món (alias) — dữ kiện mặt hàng
    Route::get('/product-aliases', [ProductAliasController::class, 'index'])->middleware('permission:products.list.view');
    Route::post('/product-aliases', [ProductAliasController::class, 'store'])->middleware('permission:products.list.edit');
    Route::delete('/product-aliases/{id}', [ProductAliasController::class, 'destroy'])->middleware('permission:products.list.edit');
    // Gói 40: quản lý danh mục lỗi 3 Chuyên (cấu hình nhân sự phi-lương)
    Route::post('/violation-types', [ViolationController::class, 'typesStore'])->middleware('permission:staff.config.edit');
    Route::put('/violation-types/{id}', [ViolationController::class, 'typesUpdate'])->middleware('permission:staff.config.edit');
    Route::delete('/violation-types/{id}', [ViolationController::class, 'typesDestroy'])->middleware('permission:staff.config.edit');
    // Gói 59: QR hub nhân viên (xem / tạo lại) — tầng bí mật, chỉ Chủ Sở Hữu.
    Route::get('/staff-hub-qr', [StaffHubQrController::class, 'show'])->middleware('permission:settings.secrets.view');
    Route::post('/staff-hub-qr/regenerate', [StaffHubQrController::class, 'regenerate'])->middleware('permission:settings.secrets.edit');
    Route::get('/settings', [SettingsController::class, 'index']); // Gói 8a: thuế & giá
    // Gói 7p: màu chủ đạo giao diện (Đại Vương tự pick)
    Route::get('/settings/theme', [SettingsController::class, 'theme']);

    // Gói 8a: kênh bán hàng (giá theo kênh) — Gói 55 p11ae: ghi cần products.manage
    Route::get('/price-lists', [PriceListController::class, 'index']);
    // Spec danh mục dùng chung (2026-10-19): dropdown danh mục public (chỉ active)
    Route::get('/shared-categories', [SharedCategoryController::class, 'index']);
    Route::post('/price-lists', [PriceListController::class, 'store'])->middleware('permission:products.prices.create');
    Route::post('/price-lists/reorder', [PriceListController::class, 'reorder'])->middleware('permission:products.prices.edit');
    Route::patch('/price-lists/{priceList}', [PriceListController::class, 'update'])->middleware('permission:products.prices.edit');
    Route::delete('/price-lists/{priceList}', [PriceListController::class, 'destroy'])->middleware('permission:products.prices.delete');

    // Gói 7b: nhóm tùy chọn — Gói 55 p11ae: ghi cần products.manage (đọc mở cho POS)
    Route::get('/option-groups', [OptionGroupController::class, 'index']);
    Route::get('/option-groups/{id}/products', [OptionGroupController::class, 'products']);
    Route::get('/options/{id}/recipes', [OptionGroupController::class, 'optionRecipes']);
    Route::post('/option-groups', [OptionGroupController::class, 'store'])->middleware('permission:products.options.create');
    Route::patch('/option-groups/{id}', [OptionGroupController::class, 'update'])->middleware('permission:products.options.edit');
    Route::delete('/option-groups/{id}', [OptionGroupController::class, 'destroy'])->middleware('permission:products.options.delete');
    Route::post('/option-groups/{id}/options', [OptionGroupController::class, 'storeOption'])->middleware('permission:products.options.create');
    Route::patch('/options/{id}', [OptionGroupController::class, 'updateOption'])->middleware('permission:products.options.edit');
    Route::delete('/options/{id}', [OptionGroupController::class, 'destroyOption'])->middleware('permission:products.options.delete');
    // Gói 8a: kéo-thả, gán mặt hàng, định mức tùy chọn
    Route::post('/option-groups/reorder', [OptionGroupController::class, 'reorder'])->middleware('permission:products.options.edit');
    Route::post('/option-groups/{id}/options/reorder', [OptionGroupController::class, 'reorderOptions'])->middleware('permission:products.options.edit');
    Route::post('/option-groups/{id}/products', [OptionGroupController::class, 'assignProducts'])->middleware('permission:products.options.edit');
    Route::put('/options/{id}/recipes', [OptionGroupController::class, 'updateOptionRecipes'])->middleware('permission:products.options.edit');

    // Gói 7f: quản lý thực đơn (POS/App) — Gói 55 p11ae: ghi cần products.manage
    Route::get('/menus', [MenuAdminController::class, 'index']);
    Route::get('/menus/{id}', [MenuAdminController::class, 'show']);
    Route::get('/menus/{id}/search-products', [MenuAdminController::class, 'searchProducts']);
    Route::post('/menus', [MenuAdminController::class, 'store'])->middleware('permission:products.menus.create');
    Route::post('/menus/reorder', [MenuAdminController::class, 'reorder'])->middleware('permission:products.menus.edit');
    Route::patch('/menus/{id}', [MenuAdminController::class, 'update'])->middleware('permission:products.menus.edit');
    Route::delete('/menus/{id}', [MenuAdminController::class, 'destroy'])->middleware('permission:products.menus.delete');
    Route::post('/menus/{id}/products', [MenuAdminController::class, 'attachProduct'])->middleware('permission:products.menus.edit');
    Route::delete('/menus/{id}/products/{productId}', [MenuAdminController::class, 'detachProduct'])->middleware('permission:products.menus.edit');
    Route::post('/menus/{id}/products/reorder', [MenuAdminController::class, 'reorderProducts'])->middleware('permission:products.menus.edit');

    // Quản trị — Gói 55 p11ae: nhập kho trực tiếp cần inventory.manage
    Route::get('/admin/dashboard/stats', [AdminDashboardController::class, 'stats'])->middleware('permission:dashboard.view');
    Route::middleware('permission:inventory.inbound.create')->post('/admin/inventory/inward', [InboundController::class, 'store']);

    // Gói 26: Nhân sự — PIN nhanh cho POS/KDS (cần token đăng nhập)
    // Gói 38: throttle chống dò PIN + bắt buộc kèm phone/username (xem EmployeeAuthController@pinVerify)
    // Audit 2026-10-23 A3-10: bổ sung employee.active (NV đã tắt không xác thực PIN bằng token cũ)
    Route::post('/employee/pin-verify', [EmployeeAuthController::class, 'pinVerify'])->middleware(['throttle:10,1', 'employee.active']);

    // Gói 26: Nhân sự — đọc (mỗi đường gác đúng khóa lá cây §2; cụm lương
    // chỉ 2 tầng tài khoản — chức vụ không vào được dù có staff.* cũ).
    Route::get('/roles/matrix', [RoleController::class, 'matrix'])->middleware('permission:staff.roles.view');
    Route::apiResource('roles', RoleController::class)->only(['index', 'show'])->parameters(['roles' => 'id'])->middleware('permission:staff.roles.view');
    Route::apiResource('employees', EmployeeController::class)->only(['index', 'show'])->parameters(['employees' => 'id'])->whereNumber('id')->middleware('permission:staff.employees.view');
    Route::get('/salary/{id}', [SalaryController::class, 'show'])->middleware('permission:staff.salary.detail.view');
    Route::get('/salary-summary', [SalaryController::class, 'summary'])->middleware('permission:staff.salary.summary.view'); // Gói 55: tổng hợp lương toàn NV
    Route::get('/salary/{id}/history', [SalaryController::class, 'history'])->middleware('permission:staff.salary.detail.view');
    Route::get('/salary/{id}/days', [SalaryController::class, 'getDays'])->middleware('permission:staff.salary.detail.view');
    Route::get('/employees/{id}/insurance', [SalaryController::class, 'getInsurance'])->whereNumber('id')->middleware('permission:staff.salary.detail.view');
    Route::get('/holidays', [SalaryController::class, 'holidays'])->middleware('permission:staff.salary.config');
    Route::get('/salary-policies', [SalaryController::class, 'getPolicies'])->middleware('permission:staff.salary.config'); // Gói 30
    // §3.7: nhật ký lương — chỉ Chủ Sở Hữu (gác thêm trong controller).
    Route::get('/salary-audit-logs', [SalaryController::class, 'auditLogs'])->middleware('permission:staff.salary.summary.view');

    // Gói 35: Chấm công — đọc
    Route::get('/work-shifts', [WorkShiftController::class, 'index'])->middleware('permission:attendance.shifts.view');
    Route::get('/shift-registrations/week', [ShiftRegistrationController::class, 'adminWeek'])->middleware('permission:attendance.registrations.view');
    Route::get('/work-schedules/week', [WorkScheduleController::class, 'week'])->middleware('permission:attendance.schedules.view');
    Route::get('/attendances/grid', [AttendanceController::class, 'grid'])->middleware('permission:attendance.grid.view');
    Route::get('/attendances/shift-stats', [AttendanceController::class, 'shiftStats'])->middleware('permission:attendance.grid.view'); // Gói 46: cột Tổng số ca
    Route::get('/leave-requests', [LeaveRequestController::class, 'index'])->middleware('permission:attendance.leaves.view');
    Route::get('/shift-leaves', [ShiftLeaveController::class, 'index'])->middleware('permission:attendance.leaves.view'); // Gói 46: xin nghỉ theo ca
    Route::get('/branches/{id}/attendance-qr', [AttendanceQrController::class, 'show'])->middleware('permission:attendance.qr.view');
    Route::get('/schedule-notes', [WorkScheduleController::class, 'getNote'])->middleware('permission:attendance.notes.view'); // Gói 37
    Route::get('/schedule-notes/map', [WorkScheduleController::class, 'notesMap'])->middleware('permission:attendance.notes.view'); // Gói 37b

    // Gói 40: Lỗi 3 Chuyên — đọc (quản lý cửa hàng xem được, không thấy lương)
    Route::get('/violations', [ViolationController::class, 'index'])->middleware('permission:staff.violations.view');
    Route::get('/violations/summary', [ViolationController::class, 'summary'])->middleware('permission:staff.violations.view');
    Route::get('/violation-types', [ViolationController::class, 'typesIndex'])->middleware('permission:staff.config.view');

    // "Mời bạn bè" (đổi tên từ Affiliate Gói 46, 2026-10-20): top người mời + đơn phát sinh
    Route::get('/invite-friends/top', [InviteFriendsController::class, 'top'])->middleware('permission:customers.invite.view');
    Route::get('/invite-friends/orders', [InviteFriendsController::class, 'orders'])->middleware('permission:customers.invite.view');
    // Deprecated: route cũ giữ 1 phiên bản (controller tự log deprecated)
    Route::get('/affiliate/top', [InviteFriendsController::class, 'top'])->middleware('permission:customers.invite.view');
    Route::get('/affiliate/orders', [InviteFriendsController::class, 'orders'])->middleware('permission:customers.invite.view');

    // Gói 26: Nhân sự — ghi (mỗi đường gác đúng khóa lá cây §2).
    Route::apiResource('roles', RoleController::class)->only(['store', 'update', 'destroy'])->parameters(['roles' => 'id'])->middleware('permission:staff.roles.edit');
    Route::apiResource('employees', EmployeeController::class)->only(['store'])->parameters(['employees' => 'id'])->whereNumber('id')->middleware('permission:staff.employees.create');
    Route::apiResource('employees', EmployeeController::class)->only(['update'])->parameters(['employees' => 'id'])->whereNumber('id')->middleware('permission:staff.employees.edit');
    Route::apiResource('employees', EmployeeController::class)->only(['destroy'])->parameters(['employees' => 'id'])->whereNumber('id')->middleware('permission:staff.employees.delete');
    Route::post('/employees/{id}/reset-pin', [EmployeeController::class, 'resetPin'])->whereNumber('id')->middleware('permission:staff.employees.edit');
    Route::post('/employees/{id}/reset-password', [EmployeeController::class, 'resetPassword'])->whereNumber('id')->middleware('permission:staff.employees.edit');
    Route::post('/salary/{id}/record', [SalaryController::class, 'saveRecord'])->middleware('permission:staff.salary.edit');
    Route::post('/salary/{id}/days', [SalaryController::class, 'saveDays'])->middleware('permission:staff.salary.edit');
    Route::post('/salary/import-attendance', [SalaryController::class, 'importAttendance'])->middleware('permission:staff.salary.edit'); // Đổ giờ công từ chấm công
    Route::post('/salary/{id}/wage-levels', [SalaryController::class, 'addWageLevel'])->middleware('permission:staff.salary.config');
    Route::delete('/salary/wage-levels/{id}', [SalaryController::class, 'deleteWageLevel'])->middleware('permission:staff.salary.config');
    Route::post('/salary/{id}/rank-wage-levels', [SalaryController::class, 'addRankWageLevel'])->middleware('permission:staff.salary.config'); // Gói 67: lương cấp bậc
    Route::delete('/salary/rank-wage-levels/{id}', [SalaryController::class, 'deleteRankWageLevel'])->middleware('permission:staff.salary.config');
    Route::post('/salary/{id}/advances', [SalaryController::class, 'addAdvance'])->middleware('permission:staff.salary.money');
    Route::delete('/salary/advances/{id}', [SalaryController::class, 'deleteAdvance'])->middleware('permission:staff.salary.money');
    Route::post('/salary/{id}/bonuses', [SalaryController::class, 'addBonus'])->middleware('permission:staff.salary.money');
    Route::delete('/salary/bonuses/{id}', [SalaryController::class, 'deleteBonus'])->middleware('permission:staff.salary.money');
    Route::post('/employees/{id}/insurance', [SalaryController::class, 'saveInsurance'])->whereNumber('id')->middleware('permission:staff.salary.money');
    Route::delete('/employees/{id}/insurance', [SalaryController::class, 'deleteInsurance'])->whereNumber('id')->middleware('permission:staff.salary.money');
    // Spec P4-B1/B2: chốt + khóa kỳ lương (theo kỳ × CN — §3.8)
    Route::get('/salary-lock/status', [SalaryController::class, 'lockStatus'])->middleware('permission:staff.salary.summary.view');
    Route::post('/salary-lock/lock', [SalaryController::class, 'lock'])->middleware('permission:staff.salary.lock');
    Route::post('/salary-lock/unlock', [SalaryController::class, 'unlock'])->middleware('permission:staff.salary.lock');
    // §3.7: ghi dấu lần xuất ảnh phiếu lương (frontend vẽ xong gọi beacon).
    Route::post('/salary/{id}/export-log', [SalaryController::class, 'exportLog'])->middleware('permission:staff.salary.export');
    // Spec P4-B6: phụ cấp nhiều loại
    Route::get('/allowance-types', [SalaryController::class, 'allowanceTypes'])->middleware('permission:staff.salary.config');
    Route::post('/allowance-types', [SalaryController::class, 'storeAllowanceType'])->middleware('permission:staff.salary.config');
    Route::patch('/allowance-types/{id}', [SalaryController::class, 'updateAllowanceType'])->middleware('permission:staff.salary.config');
    Route::get('/salary/{id}/allowances', [SalaryController::class, 'employeeAllowances'])->middleware('permission:staff.salary.detail.view');
    Route::post('/salary/{id}/allowances', [SalaryController::class, 'storeEmployeeAllowance'])->middleware('permission:staff.salary.money');
    Route::delete('/salary/allowances/{id}', [SalaryController::class, 'destroyEmployeeAllowance'])->middleware('permission:staff.salary.money');
    Route::post('/holidays', [SalaryController::class, 'addHoliday'])->middleware('permission:staff.salary.config');
    Route::patch('/holidays/{id}', [SalaryController::class, 'updateHoliday'])->middleware('permission:staff.salary.config'); // Gói 30
    Route::delete('/holidays/{id}', [SalaryController::class, 'deleteHoliday'])->middleware('permission:staff.salary.config');
    Route::put('/salary-policies', [SalaryController::class, 'savePolicies'])->middleware('permission:staff.salary.config'); // Gói 30
    Route::put('/salary/{id}/violations', [SalaryController::class, 'saveViolations'])->middleware('permission:staff.salary.edit'); // Gói 30
    // Gói 40: Trừ khác đa khoản
    Route::get('/salary/{employee}/deductions', [SalaryController::class, 'listDeductions'])->middleware('permission:staff.salary.detail.view');
    Route::post('/salary/{employee}/deductions', [SalaryController::class, 'storeDeduction'])->middleware('permission:staff.salary.money');
    Route::post('/salary/{employee}/deductions/bulk', [SalaryController::class, 'bulkSaveDeductions'])->middleware('permission:staff.salary.money'); // Audit UX hạng 8: lưu 1 request
    Route::put('/salary/deductions/{id}', [SalaryController::class, 'updateDeduction'])->middleware('permission:staff.salary.money');
    Route::delete('/salary/deductions/{id}', [SalaryController::class, 'destroyDeduction'])->middleware('permission:staff.salary.money');
    // Gói 40: Lỗi 3 Chuyên — ghi
    Route::post('/violations', [ViolationController::class, 'store'])->middleware('permission:staff.violations.create');
    Route::put('/violations/{id}', [ViolationController::class, 'update'])->middleware('permission:staff.violations.edit');
    Route::delete('/violations/{id}', [ViolationController::class, 'destroy'])->middleware('permission:staff.violations.delete');

    // Gói 35: Chấm công — ghi
    Route::post('/work-shifts/reorder', [WorkShiftController::class, 'reorder'])->middleware('permission:attendance.shifts.edit');
    Route::apiResource('work-shifts', WorkShiftController::class)->only(['store', 'update', 'destroy'])->parameters(['work-shifts' => 'id'])->middleware('permission:attendance.shifts.edit');
    Route::post('/work-schedules/assign', [WorkScheduleController::class, 'assign'])->middleware('permission:attendance.schedules.edit');
    Route::post('/work-schedules/batch-save', [WorkScheduleController::class, 'batchSave'])->middleware('permission:attendance.schedules.edit'); // Gói 42: lưu hàng loạt các ô nháp của 1 CN
    Route::delete('/work-schedules/{id}', [WorkScheduleController::class, 'destroy'])->middleware('permission:attendance.schedules.edit');
    Route::post('/work-shift-capacities', [WorkScheduleController::class, 'saveCapacity'])->middleware('permission:attendance.shifts.edit'); // Gói 37
    Route::put('/schedule-notes', [WorkScheduleController::class, 'saveNote'])->middleware('permission:attendance.notes.edit'); // Gói 37
    Route::post('/leave-requests/{id}/approve', [LeaveRequestController::class, 'approve'])->middleware('permission:attendance.leaves.approve');
    Route::post('/leave-requests/{id}/reject', [LeaveRequestController::class, 'reject'])->middleware('permission:attendance.leaves.approve');
    // Gói 46: xin nghỉ theo ca — quản lý tạo trực tiếp / duyệt (tự gỡ ca) / từ chối
    // (người tạo thay cũng là người duyệt — gác bằng khóa approve của lá leaves).
    Route::post('/shift-leaves', [ShiftLeaveController::class, 'managerStore'])->middleware('permission:attendance.leaves.approve');
    Route::post('/shift-leaves/{id}/approve', [ShiftLeaveController::class, 'approve'])->middleware('permission:attendance.leaves.approve');
    // Audit 2026-10-23 A3-7: admin sửa giờ vào/ra kèm bảng vết sửa (attendance_edits)
    Route::patch('/attendances/{id}/times', [AttendanceController::class, 'updateTimes'])->middleware('permission:attendance.grid.edit');
    // Spec nhập giờ từ lưới tuần (2026-10-31): tạo mới giờ cho ô trống trên lưới
    Route::post('/attendances/manual', [AttendanceController::class, 'storeManual'])->middleware('permission:attendance.grid.edit');
    Route::post('/shift-leaves/{id}/reject', [ShiftLeaveController::class, 'reject'])->middleware('permission:attendance.leaves.approve');
    // Spec P4-B5: quản lý duyệt/từ chối đổi ca
    Route::get('/shift-swaps', [ShiftSwapController::class, 'index'])->middleware('permission:attendance.leaves.view');
    Route::post('/shift-swaps/{id}/approve', [ShiftSwapController::class, 'approve'])->middleware('permission:attendance.leaves.approve');
    Route::post('/shift-swaps/{id}/reject', [ShiftSwapController::class, 'reject'])->middleware('permission:attendance.leaves.approve');
    Route::post('/shift-registrations/{id}/approve', [ShiftRegistrationController::class, 'approve'])->middleware('permission:attendance.registrations.approve'); // B2
    Route::post('/shift-registrations/{id}/reject', [ShiftRegistrationController::class, 'reject'])->middleware('permission:attendance.registrations.approve'); // B2
    Route::post('/shift-registrations/{id}/approve-and-assign', [ShiftRegistrationController::class, 'approveAndAssign'])->middleware('permission:attendance.registrations.approve'); // Gói 41: duyệt + tự xếp ca trên bảng Xếp ca
    // Tạo lại mã QR chấm công: spec chỉ liệt kê attendance.qr.view — hành động
    // quản trị thuộc miền chấm công nên gác bằng attendance.shifts.edit.
    Route::post('/branches/{id}/attendance-qr/regenerate', [AttendanceQrController::class, 'regenerate'])->middleware('permission:attendance.shifts.edit');
});

// Gói 6: API public cho Zalo Mini App (không cần đăng nhập, định danh bằng SĐT)
// Gói 55 p11ae: throttle cho group online (chống spam đơn / lạm dụng proxy geocode).
// Audit bổ sung F17 (2026-10-21): BỎ ngân sách chung 60/phút ở mức group — đường ĐỌC
// (poll trạng thái 5s, tải thực đơn/cấu hình) dùng limiter riêng 'online-read'
// (300/phút/IP), đường GHI giữ 60/phút/IP gắn tường minh từng route, geocode + báo
// giá giữ mức gắt 30/phút, hành động trên 1 đơn (báo CK/hủy) khóa theo MÃ ĐƠN qua
// limiter 'order-action'. Trước đây tất cả giành chung 60/phút/IP → khách chung NAT
// bấm "Tôi đã chuyển khoản" là dính 429 "Too Many Attempts.".
Route::prefix('online')->group(function () {
    Route::get('/branches', [OnlineOrderController::class, 'branches'])->middleware('throttle:online-read');
    Route::get('/menu', [OnlineOrderController::class, 'menu'])->middleware('throttle:online-read');
    // Gói 7g: thực đơn hiển thị theo bảng menus (cột T) — Mini App dùng
    Route::get('/display-menus', [DisplayMenuController::class, 'index'])->middleware('throttle:online-read');
    Route::get('/ship-config', [OnlineOrderController::class, 'shipConfig'])->middleware('throttle:online-read');
    Route::get('/geocode', [OnlineOrderController::class, 'geocode'])->middleware('throttle:30,1'); // Gói 50e: geocode qua backend
    Route::get('/geocode/suggest', [OnlineOrderController::class, 'geocodeSuggest'])->middleware('throttle:30,1'); // Gói 50f: gợi ý địa chỉ
    Route::get('/geocode/reverse', [OnlineOrderController::class, 'geocodeReverse'])->middleware('throttle:30,1'); // Gói 55 p3: GPS -> địa chỉ
    // Gói 55 p11ac: proxy tỉnh/thành + xã/phường (Zalo WebView chặn domain lạ)
    Route::get('/provinces', [OnlineOrderController::class, 'provinces'])->middleware('throttle:online-read');
    Route::get('/wards', [OnlineOrderController::class, 'wards'])->middleware('throttle:online-read');
    // Gói 9: trang chủ Mini App kiểu GrabFood
    Route::get('/shop-info', [OnlineOrderController::class, 'shopInfo'])->middleware('throttle:online-read');
    Route::get('/sale-products', [OnlineOrderController::class, 'saleProducts'])->middleware('throttle:online-read');
    Route::get('/top-products', [OnlineOrderController::class, 'topProducts'])->middleware('throttle:online-read'); // Gói 34: top 10 bán chạy
    // Gói 9: đặt đơn nhóm
    Route::post('/group-orders', [GroupOrderController::class, 'store'])->middleware('throttle:60,1');
    Route::get('/group-orders/{code}', [GroupOrderController::class, 'show'])->middleware('throttle:online-read');
    Route::post('/group-orders/{code}/items', [GroupOrderController::class, 'addItem'])->middleware('throttle:60,1');
    Route::patch('/group-orders/{code}/items/{id}', [GroupOrderController::class, 'updateItem'])->middleware('throttle:60,1');
    Route::delete('/group-orders/{code}/items/{id}', [GroupOrderController::class, 'removeItem'])->middleware('throttle:60,1');
    Route::post('/group-orders/{code}/checkout', [GroupOrderController::class, 'checkout'])->middleware('throttle:60,1');
    // Gói 11: khách quét QR tích điểm để gán TV vào đơn POS (public, xác thực bằng token QR)
    Route::post('/orders/{code}/claim', [OnlineOrderController::class, 'claim'])->middleware('throttle:60,1');
    // Gói 7p: màu chủ đạo giao diện (public cho Mini App)
    Route::get('/theme', [SettingsController::class, 'publicTheme'])->middleware('throttle:online-read');
    // Gói chính sách Mini App vào Cài đặt Admin: nội dung chính sách — điều
    // khoản (public; Mini App gọi khi mở popup, lỗi thì dùng bản dự phòng).
    Route::get('/privacy-policy', [SettingsController::class, 'publicPrivacyPolicy'])->middleware('throttle:online-read');
    // Gói 48: banner KM cho carousel Mini App (public)
    Route::get('/promo-banners', [PromotionController::class, 'banners'])->middleware('throttle:online-read');
    // Gói 52: PTTT public theo kênh (POS/Mini App)
    Route::get('/payment-methods/active', [PaymentMethodController::class, 'publicActive'])->middleware('throttle:online-read');
    // SPEC-01: thanh toán Zalo Mini App 2 giai đoạn
    Route::get('/payment/zalo-config', [PaymentController::class, 'zaloConfig'])->middleware('throttle:online-read');
    Route::post('/checkout-orders', [PaymentController::class, 'checkoutOrders'])->middleware('throttle:60,1');
    // SPEC-02: ví coupon + referral + tích tem
    Route::get('/coupons/my', [CouponController::class, 'myCoupons'])->middleware('throttle:online-read');
    Route::get('/coupons/stamps', [CouponController::class, 'myStamps'])->middleware('throttle:online-read');
    Route::get('/coupons/referral', [CouponController::class, 'myReferral'])->middleware('throttle:online-read');
    Route::post('/coupons/validate', [CouponController::class, 'validateCoupon'])->middleware('throttle:online-read')->middleware('throttle:60,1');
    // Gói 49: sổ địa chỉ giao hàng (public, xác thực customer_id)
    Route::get('/addresses', [CustomerAddressController::class, 'index'])->middleware('throttle:online-read');
    Route::post('/addresses', [CustomerAddressController::class, 'store'])->middleware('throttle:60,1');
    Route::patch('/addresses/{id}', [CustomerAddressController::class, 'update'])->middleware('throttle:60,1');
    Route::delete('/addresses/{id}', [CustomerAddressController::class, 'destroy'])->middleware('throttle:60,1');
    Route::post('/shipping-fee', [OnlineOrderController::class, 'shippingFee'])->middleware('throttle:online-read')->middleware('throttle:60,1');
    Route::post('/promotions/eligible', [OnlineOrderController::class, 'eligiblePromotions'])->middleware('throttle:online-read')->middleware('throttle:60,1');
    Route::post('/voucher/validate', [OnlineOrderController::class, 'validateVoucher'])->middleware('throttle:30,1'); // Audit 2026-10-21 🟠8
    // Loyalty 2.0: Cửa hàng điểm + lịch sử điểm (định danh Spec 3 trong controller)
    Route::get('/points/exchange-items', [PointsController::class, 'exchangeItems'])->middleware('throttle:online-read');
    Route::post('/points/exchange', [PointsController::class, 'exchange'])->middleware('throttle:order-action');
    Route::get('/points/history', [PointsController::class, 'history'])->middleware('throttle:online-read');
    // Minigame (2026-11-01): trạng thái/phiên/nộp kết quả/kỷ lục giải trí/chia sẻ thẻ
    Route::get('/minigame/state', [MinigameController::class, 'state'])->middleware('throttle:online-read');
    Route::post('/minigame/session', [MinigameController::class, 'session'])->middleware('throttle:order-action');
    Route::post('/minigame/submit', [MinigameController::class, 'submit'])->middleware('throttle:order-action');
    Route::post('/minigame/best', [MinigameController::class, 'best'])->middleware('throttle:order-action');
    Route::post('/minigame/share-card', [MinigameController::class, 'shareCard'])->middleware('throttle:30,1');
    Route::get('/customer', [OnlineOrderController::class, 'customer'])->middleware('throttle:online-read');
    // Spec đăng nhập SĐT + mật khẩu §4: đường phụ đăng nhập + phiên hợp nhất.
    Route::post('/customer/password/login', [CustomerPasswordController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/customer/password/zalo-set', [CustomerPasswordController::class, 'zaloSet'])->middleware('throttle:10,1');
    // Spec P4-P5: định danh user Zalo phía server (đổi token qua graph.zalo.me + appsecret_proof)
    Route::post('/zalo/auth', [ZaloAuthController::class, 'auth'])
        ->middleware('throttle:60,1');
    Route::post('/customer/password/set', [CustomerPasswordController::class, 'set'])->middleware('throttle:30,1');
    Route::patch('/customer/password/change', [CustomerPasswordController::class, 'change'])->middleware('throttle:30,1');
    Route::post('/customer/password/counter-set', [CustomerPasswordController::class, 'counterSet'])->middleware('throttle:5,1');
    Route::post('/customer/session/code-login', [CustomerSessionController::class, 'codeLogin'])->middleware('throttle:30,1');
    Route::post('/customer/session/logout', [CustomerSessionController::class, 'logout'])->middleware('throttle:30,1');
    Route::patch('/customer/profile/email', [CustomerSessionController::class, 'updateEmail'])->middleware('throttle:30,1');
    Route::post('/orders', [OnlineOrderController::class, 'store'])->middleware('throttle:60,1');
    Route::get('/orders/{code}', [OnlineOrderController::class, 'track'])->middleware('throttle:online-read');
    Route::post('/orders/{code}/transfer-notified', [OnlineOrderController::class, 'transferNotified'])->middleware('throttle:order-action'); // Spec QR 2026-10-21: khách báo đã CK — F17: limiter theo mã đơn
    Route::post('/orders/{code}/cancel', [OnlineOrderController::class, 'cancel'])->middleware('throttle:order-action'); // Gói SEC2: chống brute-force mã đơn — F17: limiter theo mã đơn
    // Gói 60: báo giá giao hàng live cho checkout Mini App
    Route::post('/delivery/quote', [DeliveryController::class, 'quote'])->middleware('throttle:30,1');
    Route::get('/delivery/config', [DeliveryController::class, 'config'])->middleware('throttle:online-read');
});

// Gói 60: webhook giao hàng từ hãng (public, verify chữ ký trong adapter)
Route::post('/webhooks/delivery/{provider}', [DeliveryWebhookController::class, 'handle'])
    ->where('provider', 'ahamove|lalamove')
    ->middleware('throttle:120,1');

// SPEC-01: notify từ Zalo Checkout SDK (Zalo server gọi trực tiếp, không qua Mini App)
// Đặt ngoài group 'online' để URL là /api/payment/notify (khớp MANIFEST)
Route::post('/payment/notify', [PaymentController::class, 'notify'])
    ->middleware('throttle:120,1');
