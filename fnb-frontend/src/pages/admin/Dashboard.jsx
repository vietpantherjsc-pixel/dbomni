import React from 'react';
import AdminLayout from '../../components/layout/AdminLayout';

const Dashboard = () => {
    return (
        <AdminLayout>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-semibold uppercase tracking-wider">Doanh thu hôm nay</h3>
                    <p className="text-3xl font-bold text-gray-800 mt-3">0 ₫</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-semibold uppercase tracking-wider">Đơn hàng mới</h3>
                    <p className="text-3xl font-bold text-gray-800 mt-3">0</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-semibold uppercase tracking-wider">Lợi nhuận gộp</h3>
                    <p className="text-3xl font-bold text-emerald-600 mt-3">0 ₫</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                <h2 className="text-lg font-bold text-gray-800 mb-6">Hoạt động gần đây</h2>
                <div className="text-gray-400 text-sm flex flex-col h-40 items-center justify-center border-2 border-dashed border-gray-200 rounded-lg bg-gray-50">
                    <span className="text-2xl mb-2">📭</span>
                    <span>Chưa có dữ liệu hoạt động trong ngày.</span>
                </div>
            </div>
        </AdminLayout>
    );
};

export default Dashboard;