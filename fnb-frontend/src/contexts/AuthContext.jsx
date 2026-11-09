import React, { createContext, useState, useContext } from 'react';
import axios from 'axios';
import { API } from '../utils/api';

// Khởi tạo Context
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    // Đọc dữ liệu từ localStorage nếu người dùng đã đăng nhập trước đó (F5 không bị mất)
    const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user')) || null);
    const [token, setToken] = useState(() => localStorage.getItem('access_token') || null);

    // Audit toàn diện 2026-10-21 🟠6: token KHÔNG còn gắn qua axios.defaults ở đây —
    // request interceptor trong utils/api.js đọc localStorage tại thời điểm request
    // (hết race "Unauthenticated." khi F5/deep-link; phủ mọi file dùng axios).

    // Hàm xử lý khi đăng nhập thành công
    const login = (userData, authToken) => {
        setUser(userData);
        setToken(authToken);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('access_token', authToken);
    };

    // Hàm xử lý đăng xuất — 2026-11-08: gọi server thu hồi ĐÚNG token hiện
    // tại (POST /logout) theo kiểu best-effort TRƯỚC khi dọn localStorage:
    // token còn trong localStorage lúc gọi để interceptor của utils/api.js
    // gắn header; lỗi mạng thì bỏ qua, vẫn đăng xuất ở client như trước.
    // (Hub/trang NV có logout riêng với kho token khác — không đi qua đây.)
    const logout = async () => {
        try {
            await axios.post(`${API}/logout`);
        } catch { /* best-effort: bỏ qua lỗi mạng */ }
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