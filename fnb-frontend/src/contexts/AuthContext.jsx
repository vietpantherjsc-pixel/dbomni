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

    // Cây phân quyền chi tiết §1.4/§2.0A: khớp wildcard tiền tố đa tầng
    // ('inventory.*' khớp mọi lá dưới inventory.; 'inventory.inbound.*'
    // khớp mọi lá dưới inventory.inbound.) + '*' toàn phần (chỉ còn trong
    // dữ kiện cũ — role mới không được lưu '*').
    const matchesPerm = (perms, permission) => {
        if (perms.includes('*') || perms.includes(permission)) return true;
        return perms.some((p) => p.endsWith('.*') && permission.startsWith(p.slice(0, -1)));
    };

    // 7 lá lương duy nhất tầng Chủ Chi Nhánh được đi qua (CheckPermission
    // ở server là cổng chốt — frontend chỉ ẩn UI).
    const SALARY_LEAVES = ['staff.salary.summary.view', 'staff.salary.detail.view', 'staff.salary.edit', 'staff.salary.money', 'staff.salary.config', 'staff.salary.lock', 'staff.salary.export'];

    // Gói 26 + cây phân quyền 3 tầng (2026-11-10): kiểm tra quyền cho 3 loại tài khoản.
    // - Tài khoản quản trị tầng Chủ Sở Hữu (type 'user', account_tier 'owner'
    //   hoặc chưa có tier — mặc định sau migration): full quyền.
    // - Tài khoản quản trị tầng Chủ Chi Nhánh (account_tier 'branch_owner'):
    //   CHỈ 7 lá lương trong CN mình, mọi route khác -> 403 ở server.
    // - Nhân viên (type 'employee'): theo ma trận roles.permissions, hỗ trợ
    //   wildcard tiền tố đa tầng ('*', 'module.*', 'module.muccon.*').
    const can = (permission) => {
        if (!user) return false;
        if (user.type === 'user' || !user.type) {
            if (user.account_tier === 'branch_owner') return SALARY_LEAVES.includes(permission);
            return true;
        }
        return matchesPerm(user.permissions || [], permission);
    };

    const hasPermission = (permission) => can(permission);

    // Tầng tài khoản quản trị (đọc từ payload /login — AuthController trả
    // account_tier/owner_branch_id/must_change_password).
    const isBranchOwner = user?.type === 'user' && user?.account_tier === 'branch_owner';
    const isOwner = user?.type === 'user' && user?.account_tier !== 'branch_owner';

    return (
        <AuthContext.Provider value={{ user, token, login, logout, hasRole, hasPermission, can, isBranchOwner, isOwner }}>
            {children}
        </AuthContext.Provider>
    );
};

// Custom hook để sử dụng Context nhanh gọn ở các Component khác
export const useAuth = () => {
    return useContext(AuthContext);
};