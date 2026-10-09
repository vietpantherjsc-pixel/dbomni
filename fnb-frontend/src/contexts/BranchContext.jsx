import React, { createContext, useContext, useState, useEffect } from 'react';

// =====================================================================
// Gói 18 (2026-10-09): Context chi nhánh dùng chung cho admin.
// - branchId: string, '0' = Tất cả chi nhánh
// - Lưu localStorage key 'dbomni_branch_id' để F5 không mất
// =====================================================================

const BranchContext = createContext();
const KEY = 'dbomni_branch_id';

export const BranchProvider = ({ children }) => {
    const [branchId, setBranchIdState] = useState(() => localStorage.getItem(KEY) || '0');

    const setBranchId = (v) => {
        const s = String(v);
        localStorage.setItem(KEY, s);
        setBranchIdState(s);
    };

    // Gói 24: đồng bộ khi đổi CN ở tab khác (VD: admin đổi CN, tab POS tự theo)
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === KEY && e.newValue) setBranchIdState(e.newValue);
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    return (
        <BranchContext.Provider value={{ branchId, setBranchId }}>
            {children}
        </BranchContext.Provider>
    );
};

export const useBranch = () => useContext(BranchContext);
