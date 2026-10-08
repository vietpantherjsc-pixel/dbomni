import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BranchProvider } from './contexts/BranchContext';
import Login from './pages/Login';
import Dashboard from './pages/admin/Dashboard';
import Products from './pages/admin/Products';
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
import PosScreen from './components/PosScreen';
import KdsScreen from './KdsScreen';
import Settings from './pages/admin/Settings';
import PriceLists from './pages/admin/PriceLists';
import Reports from './pages/admin/Reports'; // Gói 15: Báo cáo Giám đốc
import ReportsInventory from './pages/admin/ReportsInventory'; // Gói 17: Báo cáo kho
import ReportsPnl from './pages/admin/ReportsPnl'; // Gói 17: Báo cáo thu chi/PNL

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
                    {/* Gói 2 (2026-10-04): các mục menu Sapo chưa phát triển -> trang ComingSoon */}
                    {[
                        ['/admin/bookings', 'Đặt lịch'],
                        ['/admin/staff', 'Nhân viên'],
                        ['/admin/transactions', 'Thu chi'],
                        ['/admin/attendance', 'Chấm công'],
                        ['/admin/integrations', 'Đối tác tích hợp'],
                        ['/admin/qr-order', 'QR Order'],
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