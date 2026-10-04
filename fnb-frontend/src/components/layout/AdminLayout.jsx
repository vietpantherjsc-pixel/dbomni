import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const AdminLayout = ({ children }) => {
    const { user, logout } = useAuth();
    const location = useLocation();

    const menuItems = [
        { path: '/admin', label: 'Tổng quan', icon: '📊' },
        { path: '/admin/categories', label: 'Danh mục', icon: '📁' },
        { path: '/admin/products', label: 'Mặt hàng', icon: '☕' },
        { path: '/admin/inventory', label: 'Kho vận', icon: '📦' },
        { path: '/pos', label: 'Thu ngân (POS)', icon: '💻' },
        { path: '/kds', label: 'Bếp (KDS)', icon: '🍳' },
    ];

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <div className="w-64 bg-gray-800 text-white flex flex-col shadow-lg z-10">
                <div className="p-5 bg-gray-900 flex items-center justify-center border-b border-gray-700">
                    <h1 className="text-2xl font-bold tracking-widest text-blue-400">VIBE OMNI</h1>
                </div>
                <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
                    {menuItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${
                                    isActive 
                                        ? 'bg-blue-600 text-white shadow-md' 
                                        : 'text-gray-400 hover:bg-gray-700 hover:text-gray-100'
                                }`}
                            >
                                <span className="mr-3 text-lg">{item.icon}</span>
                                <span className="font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
                <div className="p-4 bg-gray-900 text-xs text-gray-500 text-center border-t border-gray-700">
                    Phiên bản 1.0.0
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {/* Header */}
                <header className="bg-white shadow-sm border-b border-gray-200 px-8 py-4 flex items-center justify-between z-10">
                    <h2 className="text-xl font-bold text-gray-800">
                        {menuItems.find(i => i.path === location.pathname)?.label || 'Bảng điều khiển'}
                    </h2>
                    <div className="flex items-center space-x-6">
                        <div className="flex flex-col items-end">
                            <span className="text-sm font-bold text-gray-800">{user?.name}</span>
                            <span className="text-xs text-blue-600 capitalize">{user?.roles?.join(', ')}</span>
                        </div>
                        <button 
                            onClick={logout}
                            className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-100 transition-colors border border-red-200 shadow-sm"
                        >
                            Đăng xuất
                        </button>
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-8">
                    {children}
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;