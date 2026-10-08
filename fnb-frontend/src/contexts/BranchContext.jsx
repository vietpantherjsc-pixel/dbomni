import React, { createContext, useContext, useState } from 'react';

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

    return (
        <BranchContext.Provider value={{ branchId, setBranchId }}>
            {children}
        </BranchContext.Provider>
    );
};

export const useBranch = () => useContext(BranchContext);
