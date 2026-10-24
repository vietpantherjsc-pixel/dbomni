import React from 'react';
import AdminLayout from '../../components/layout/AdminLayout';
import PrepaidExpenseManager from './PrepaidExpenseManager';

// Spec cài đặt danh sách (2026-10-21): Chi phí trả trước chuyển từ card trong Cài đặt
// thành trang riêng thuộc submenu Thu chi (layout L1).
export default function PrepaidExpenses() {
    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-semibold mb-1">Chi phí trả trước</h1>
                <p className="text-[12.5px] text-gray-500 mb-4">
                    Tiền thuê trả nhiều tháng, CAPEX... được phân bổ đều vào P&amp;L theo số tháng.
                </p>
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <PrepaidExpenseManager />
                </div>
            </div>
        </AdminLayout>
    );
}
