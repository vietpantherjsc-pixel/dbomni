import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

// Khởi tạo Context
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    // Đọc dữ liệu từ localStorage nếu người dùng đã đăng nhập trước đó (F5 không bị mất)
    const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user')) || null);
    const [token, setToken] = useState(() => localStorage.getItem('access_token') || null);

    // Cấu hình axios mặc định để luôn đính kèm Token vào Header nếu có
    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } else {
            delete axios.defaults.headers.common['Authorization'];
        }
    }, [token]);

    // Hàm xử lý khi đăng nhập thành công
    const login = (userData, authToken) => {
        setUser(userData);
        setToken(authToken);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('access_token', authToken);
    };

    // Hàm xử lý đăng xuất
    const logout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('user');
        localStorage.removeItem('access_token');
    };

    // Hàm kiểm tra quyền hạn (Role/Permission)
    const hasRole = (role) => {
        return user?.roles?.includes(role);
    };

    const hasPermission = (permission) => {
        return user?.permissions?.includes(permission);
    };

    // Gói 26: kiểm tra quyền cho cả 2 loại tài khoản.
    // - Tài khoản admin cũ (type 'user'): full quyền (tương thích ngược).
    // - Nhân viên (type 'employee'): theo ma trận roles.permissions, hỗ trợ "*".
    const can = (permission) => {
        if (!user) return false;
        if (user.type === 'user' || !user.type) return true;
        const perms = user.permissions || [];
        return perms.includes('*') || perms.includes(permission);
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, hasRole, hasPermission, can }}>
            {children}
        </AuthContext.Provider>
    );
};

// Custom hook để sử dụng Context nhanh gọn ở các Component khác
export const useAuth = () => {
    return useContext(AuthContext);
};