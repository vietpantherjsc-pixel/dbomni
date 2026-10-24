import React from 'react';
import AdminLayout from '../../components/layout/AdminLayout';
import AccountManager from './AccountManager';

// Spec cài đặt danh sách (2026-10-21): Quản lý quỹ chuyển từ card trong Cài đặt
// thành trang riêng thuộc submenu Thu chi (layout L1).
export default function Accounts() {
    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-semibold mb-1">Quản lý quỹ</h1>
                <p className="text-[12.5px] text-gray-500 mb-4">
                    Tiền mặt tại quầy, két sắt, tài khoản ngân hàng, ví/sàn. Chọn quỹ khi tạo phiếu thu/chi.
                </p>
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <AccountManager />
                </div>
            </div>
        </AdminLayout>
    );
}
