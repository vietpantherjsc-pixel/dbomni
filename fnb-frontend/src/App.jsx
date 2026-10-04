import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/admin/Dashboard';
import Products from './pages/admin/Products';
import Categories from './pages/admin/Categories';

// =====================================================================
// Các Component màn hình hiển thị phụ (Sẽ tách dần ở các bước sau)
// =====================================================================
const PosScreen = () => <div className="p-8"><h1 className="text-2xl font-bold">Màn hình Thu ngân (POS)</h1></div>;
const KdsScreen = () => <div className="p-8"><h1 className="text-2xl font-bold">Màn hình Bếp/Pha chế (KDS)</h1></div>;

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
                        path="/pos" 
                        element={
                            <PrivateRoute>
                                <PosScreen />
                            </PrivateRoute>
                        } 
                    />
                    
                    <Route 
                        path="/kds" 
                        element={
                            <PrivateRoute>
                                <KdsScreen />
                            </PrivateRoute>
                        } 
                    />

                    {/* Bắt lỗi đường dẫn không tồn tại: Mặc định đẩy về admin */}
                    <Route path="*" element={<Navigate to="/admin" replace />} />
                </Routes>
            </Router>
        </AuthProvider>
    );
};

export default App;