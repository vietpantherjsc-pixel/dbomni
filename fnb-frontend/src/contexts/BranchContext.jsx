import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

// =====================================================================
// Gói 18 (2026-10-09): Context chi nhánh dùng chung cho admin.
// - branchId: string, '0' = Tất cả chi nhánh
// - Lưu localStorage để F5 không mất
// C6 (2026-10-21): lựa chọn CN gắn THEO TÀI KHOẢN — khóa lưu trữ kèm mã
// người dùng ('dbomni_branch_id:<userId>'); đăng xuất là XÓA lựa chọn của
// tài khoản vừa thoát (máy dùng chung không kế thừa CN của người trước).
// Khóa cũ không hậu tố chỉ còn dùng làm dự phòng đọc 1 lần cho tài khoản
// đang đăng nhập (tương thích bản trước), ghi mới luôn vào khóa theo tài khoản.
// =====================================================================

const BranchContext = createContext();
const BASE_KEY = 'dbomni_branch_id';
// Khóa theo tài khoản: kèm loại tài khoản vì mã số của bảng users và employees có thể trùng nhau.
const keyFor = (user) => (user && user.id !== null && user.id !== undefined && user.id !== ''
    ? `${BASE_KEY}:${user.type || 'user'}:${user.id}`
    : BASE_KEY);

export const BranchProvider = ({ children }) => {
    const auth = useAuth() || {};
    const user = auth.user ?? null;
    const uid = user?.id ?? null;
    const [branchId, setBranchIdState] = useState(
        () => localStorage.getItem(keyFor(user)) || localStorage.getItem(BASE_KEY) || '0'
    );
    const prevUserRef = useRef(user);

    // Đổi tài khoản (đăng nhập người khác / đăng xuất): nạp lựa chọn của
    // tài khoản mới; đăng xuất (user -> null) thì xóa hẳn lựa chọn đã lưu
    // của tài khoản vừa thoát rồi quay về '0'.
    useEffect(() => {
        const prevUser = prevUserRef.current;
        if ((prevUser?.id ?? null) === uid && (prevUser?.type ?? null) === (user?.type ?? null)) return;
        prevUserRef.current = user;
        if (!user) {
            if (prevUser) localStorage.removeItem(keyFor(prevUser));
            setBranchIdState('0');
            return;
        }
        setBranchIdState(localStorage.getItem(keyFor(user)) || localStorage.getItem(BASE_KEY) || '0');
    }, [user, uid]);

    const setBranchId = (v) => {
        const s = String(v);
        localStorage.setItem(keyFor(user), s);
        if (user) localStorage.removeItem(BASE_KEY);
        setBranchIdState(s);
    };

    // Gói 24: đồng bộ khi đổi CN ở tab khác (VD: admin đổi CN, tab POS tự theo)
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === keyFor(user) && e.newValue) setBranchIdState(e.newValue);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [user]);

    return (
        <BranchContext.Provider value={{ branchId, setBranchId }}>
            {children}
        </BranchContext.Provider>
    );
};

export const useBranch = () => useContext(BranchContext);
