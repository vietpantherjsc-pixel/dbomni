import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BranchProvider } from './contexts/BranchContext';
import Login from './pages/Login';
import Dashboard from './pages/admin/Dashboard';
import Products from './pages/admin/Products';
import ProductVisibility from './pages/admin/ProductVisibility'; // Gói 25
import MenuVisibility from './pages/admin/MenuVisibility'; // Gói 25
import OptionGroups from './pages/admin/OptionGroups';
import Menus from './pages/admin/Menus';
import Categories from './pages/admin/Categories';
import ComingSoon from './pages/admin/ComingSoon';
import OnlineConfig from './pages/admin/OnlineConfig';
import Orders from './pages/admin/Orders';
import Inventory from './pages/admin/Inventory';
import Customers from './pages/admin/Customers';
import MemberTiers from './pages/admin/MemberTiers';
import Promotions from './pages/admin/Promotions';
import Tables from './pages/admin/Tables';
import Transactions from './pages/admin/Transactions'; // Gói 27: thu chi
import TransactionCategories from './pages/admin/TransactionCategories'; // Gói 29: danh mục thu chi
import Partners from './pages/admin/Partners'; // Gói 29: đối tác công nợ
import PosScreen from './components/PosScreen';
import KdsScreen from './KdsScreen';
import Settings from './pages/admin/Settings';
import PriceLists from './pages/admin/PriceLists';
import Reports from './pages/admin/Reports'; // Gói 15: Báo cáo Giám đốc
import ReportsInventory from './pages/admin/ReportsInventory'; // Gói 17: Báo cáo kho
import ReportsPnl from './pages/admin/ReportsPnl'; // Gói 17: Báo cáo thu chi/PNL
import QrOrder from './pages/admin/QrOrder'; // Gói 28: QR Order theo chi nhánh
import Staff from './pages/admin/Staff'; // Gói 26: nhân viên
import Roles from './pages/admin/Roles'; // Gói 26: chức vụ & phân quyền
import Salary from './pages/admin/Salary'; // Gói 26: bảng lương theo giờ
import HolidayPolicy from './pages/admin/HolidayPolicy'; // Gói 30: lương lễ/tết & phạt
import ChamCong from './pages/ChamCong'; // Gói 35: trang chấm công NV (public)
import DangKyCa from './pages/DangKyCa'; // Gói 35: trang đăng ký ca NV (public)
import WorkShifts from './pages/admin/WorkShifts'; // Gói 35: ca làm việc
import AttendanceGrid from './pages/admin/AttendanceGrid'; // Gói 35: bảng chấm công tuần
import LeaveRequests from './pages/admin/LeaveRequests'; // Gói 35: yêu cầu nghỉ
import Scheduling from './pages/admin/Scheduling'; // Gói 35: đăng ký & xếp ca
import AttendanceQr from './pages/admin/AttendanceQr'; // Gói 35: QR chấm công

// Gói 1 (2026-10-04): bọc 2 màn hình để nút "Về App" điều hướng được
// (component thật cần prop onBackToApp / onBackToClient).
const PosScreenRoute = () => {
    const navigate = useNavigate();
    return <PosScreen onBackToApp={() => navigate('/admin')} />;
};

const KdsScreenRoute = () => {
    const navigate = useNavigate();
    return <KdsScreen onBackToClient={() => navigate('/admin')} />;
};

// =====================================================================
// Component Bảo vệ Tuyến đường (Private Route)
// =====================================================================
const PrivateRoute = ({ children }) => {
    const { token } = useAuth();
    
    if (!token) {
        return <Navigate to="/login" replace />;
    }
    
    return children;
};

// =====================================================================
// Cấu trúc Routing Chính của Ứng dụng
// =====================================================================
const App = () => {
    return (
        <AuthProvider>
            <BranchProvider>
            <Router>
                <Routes>
                    {/* Route Công khai */}
                    <Route path="/login" element={<Login />} />
                    {/* Gói 35: trang nhân viên (public, không cần đăng nhập admin) */}
                    <Route path="/cham-cong" element={<ChamCong />} />
                    <Route path="/dang-ky-ca" element={<DangKyCa />} />

                    {/* Các Route Bảo mật */}
                    <Route 
                        path="/admin" 
                        element={
                            <PrivateRoute>
                                <Dashboard />
                            </PrivateRoute>
                        } 
                    />

                    {/* Route cho màn hình Mặt hàng */}
                    <Route 
                        path="/admin/products" 
                        element={
                            <PrivateRoute>
                                <Products />
                            </PrivateRoute>
                        } 
                    />

                    {/* Gói 25: Quản lý hiển thị mặt hàng theo chi nhánh */}
                    <Route
                        path="/admin/products/visibility"
                        element={
                            <PrivateRoute>
                                <ProductVisibility />
                            </PrivateRoute>
                        }
                    />

                    <Route 
                        path="/admin/categories" 
                        element={
                            <PrivateRoute>
                                <Categories />
                            </PrivateRoute>
                        } 
                    />

                    <Route
                        path="/admin/option-groups"
                        element={
                            <PrivateRoute>
                                <OptionGroups />
                            </PrivateRoute>
                        }
                    />

                    <Route
                        path="/admin/menus"
                        element={
                            <PrivateRoute>
                                <Menus />
                            </PrivateRoute>
                        }
                    />

                    {/* Gói 25: Quản lý hiển thị thực đơn theo chi nhánh */}
                    <Route
                        path="/admin/menus/visibility"
                        element={
                            <PrivateRoute>
                                <MenuVisibility />
                            </PrivateRoute>
                        }
                    />

                    <Route
                        path="/admin/orders"
                        element={
                            <PrivateRoute>
                                <Orders />
                            </PrivateRoute>
                        }
                    />

                    {/* Gói 3 (2026-10-04): trang quản lý bàn */}
                    <Route
                        path="/admin/tables"
                        element={
                            <PrivateRoute>
                                <Tables />
                            </PrivateRoute>
                        }
                    />

                    {/* Gói 5 (2026-10-05): CRM + Khuyến mại */}
                    <Route path="/admin/customers" element={<PrivateRoute><Customers /></PrivateRoute>} />
                    <Route path="/admin/member-tiers" element={<PrivateRoute><MemberTiers /></PrivateRoute>} />
                    <Route path="/admin/promotions" element={<PrivateRoute><Promotions /></PrivateRoute>} />

                    {/* Gói 4 (2026-10-04): trang Kho hàng thật */}
                    <Route
                        path="/admin/inventory"
                        element={
                            <PrivateRoute>
                                <Inventory />
                            </PrivateRoute>
                        }
                    />

                    {/* Gói 7p: trang Thiết lập thật (màu chủ đạo) */}
                    <Route
                        path="/admin/settings"
                        element={
                            <PrivateRoute>
                                <Settings />
                            </PrivateRoute>
                        }
                    />
                    {/* Gói 8a: trang Kênh bán hàng */}
                    <Route
                        path="/admin/price-lists"
                        element={
                            <PrivateRoute>
                                <PriceLists />
                            </PrivateRoute>
                        }
                    />

                    {/* Gói 15 (2026-10-08): Báo cáo Giám đốc (code từ demo v3 đã chốt) */}
                    <Route
                        path="/admin/reports"
                        element={
                            <PrivateRoute>
                                <Reports />
                            </PrivateRoute>
                        }
                    />
                    {/* Gói 17 (2026-10-09): Báo cáo kho + Báo cáo thu chi/PNL */}
                    <Route
                        path="/admin/reports/inventory"
                        element={
                            <PrivateRoute>
                                <ReportsInventory />
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/admin/reports/pnl"
                        element={
                            <PrivateRoute>
                                <ReportsPnl />
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/admin/qr-order"
                        element={
                            <PrivateRoute>
                                <QrOrder />
                            </PrivateRoute>
                        }
                    />
                    {/* Gói 26: Nhân sự */}
                    <Route path="/admin/staff" element={<PrivateRoute><Staff /></PrivateRoute>} />
                    <Route path="/admin/staff/roles" element={<PrivateRoute><Roles /></PrivateRoute>} />
                    <Route path="/admin/staff/salary" element={<PrivateRoute><Salary /></PrivateRoute>} />
                    <Route path="/admin/staff/holiday-policy" element={<PrivateRoute><HolidayPolicy /></PrivateRoute>} />
                    {/* Gói 35: Chấm công */}
                    <Route path="/admin/attendance" element={<PrivateRoute><AttendanceGrid /></PrivateRoute>} />
                    <Route path="/admin/attendance/shifts" element={<PrivateRoute><WorkShifts /></PrivateRoute>} />
                    <Route path="/admin/attendance/scheduling" element={<PrivateRoute><Scheduling /></PrivateRoute>} />
                    <Route path="/admin/attendance/requests" element={<PrivateRoute><LeaveRequests /></PrivateRoute>} />
                    <Route path="/admin/attendance/qr" element={<PrivateRoute><AttendanceQr /></PrivateRoute>} />
                    {/* Gói 2 (2026-10-04): các mục menu Sapo chưa phát triển -> trang ComingSoon */}
                    {[
                        ['/admin/bookings', 'Đặt lịch'],
                        ['/admin/integrations', 'Đối tác tích hợp'],
                    ].map(([path, title]) => (
                        <Route
                            key={path}
                            path={path}
                            element={
                                <PrivateRoute>
                                    <ComingSoon title={title} />
                                </PrivateRoute>
                            }
                        />
                    ))}
                    <Route
                        path="/admin/transactions"
                        element={
                            <PrivateRoute>
                                <Transactions />
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/admin/transaction-categories"
                        element={
                            <PrivateRoute>
                                <TransactionCategories />
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/admin/partners"
                        element={
                            <PrivateRoute>
                                <Partners />
                            </PrivateRoute>
                        }
                    />
                    <Route
                        path="/admin/online"
                        element={
                            <PrivateRoute>
                                <OnlineConfig />
                            </PrivateRoute>
                        }
                    />
                    
                    <Route 
                        path="/pos" 
                        element={
                            <PrivateRoute>
                                <PosScreenRoute />
                            </PrivateRoute>
                        } 
                    />
                    
                    <Route 
                        path="/kds" 
                        element={
                            <PrivateRoute>
                                <KdsScreenRoute />
                            </PrivateRoute>
                        } 
                    />

                    {/* Bắt lỗi đường dẫn không tồn tại: Mặc định đẩy về admin */}
                    <Route path="*" element={<Navigate to="/admin" replace />} />
                </Routes>
            </Router>
            </BranchProvider>
        </AuthProvider>
    );
};

export default App;