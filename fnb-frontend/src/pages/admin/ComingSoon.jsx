import React from 'react';
import AdminLayout, { Icon } from '../../components/layout/AdminLayout';

// =====================================================================
// Gói 2 (2026-10-04): Trang giữ chỗ cho các mục menu chưa phát triển.
// =====================================================================

const ComingSoon = ({ title }) => {
    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-semibold text-gray-800">
                    {title}
                </h1>
                <div className="mt-3 bg-white rounded shadow-sm p-12 flex flex-col items-center text-center">
                    <span className="w-16 h-16 rounded-full bg-[#eef4ff] text-[#0d6efd] flex items-center justify-center">
                        <Icon name="clock" className="w-8 h-8" />
                    </span>
                    <h2 className="mt-4 text-lg font-semibold text-gray-800">
                        Tính năng đang phát triển
                    </h2>
                    <p className="mt-2 text-sm text-gray-500 max-w-md">
                        Mục <strong>{title}</strong> sẽ được bổ sung trong các giai đoạn tiếp theo
                        của dự án. Hiện tại dữ liệu nền đã sẵn sàng ở backend.
                    </p>
                </div>
            </div>
        </AdminLayout>
    );
};

export default ComingSoon;
