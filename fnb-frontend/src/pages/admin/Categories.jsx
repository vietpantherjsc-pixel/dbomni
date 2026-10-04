import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

const Categories = () => {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        sort_order: 0,
        is_active: true
    });

    useEffect(() => {
        fetchCategories();
    }, []);

    const fetchCategories = async () => {
        try {
            const response = await axios.get('http://localhost/api/categories');
            setCategories(response.data);
        } catch (error) {
            console.error("Lỗi khi tải danh mục:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleNameChange = (e) => {
        const name = e.target.value;
        const slug = name.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-').replace(/^-|-$/g, '');
        setFormData({ ...formData, name, slug });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await axios.post('http://localhost/api/categories', formData);
            setIsModalOpen(false);
            setFormData({ name: '', slug: '', sort_order: 0, is_active: true });
            fetchCategories();
        } catch (error) {
            alert("Có lỗi xảy ra: " + (error.response?.data?.message || "Vui lòng thử lại"));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AdminLayout>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Quản lý Danh mục</h1>
                    <p className="text-gray-500 text-sm mt-1">Phân nhóm các mặt hàng để hiển thị trên POS và Menu</p>
                </div>
                <button 
                    onClick={() => setIsModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
                >
                    + Thêm danh mục
                </button>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-sm uppercase tracking-wider">
                            <th className="p-4 font-semibold">Tên danh mục</th>
                            <th className="p-4 font-semibold">Đường dẫn (Slug)</th>
                            <th className="p-4 font-semibold text-center">Thứ tự</th>
                            <th className="p-4 font-semibold">Trạng thái</th>
                            <th className="p-4 font-semibold text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {loading ? (
                            <tr><td colSpan="5" className="p-8 text-center text-gray-500">Đang tải dữ liệu...</td></tr>
                        ) : categories.length === 0 ? (
                            <tr><td colSpan="5" className="p-8 text-center text-gray-500">Chưa có danh mục nào.</td></tr>
                        ) : (
                            categories.map(cat => (
                                <tr key={cat.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-medium text-gray-800">{cat.name}</td>
                                    <td className="p-4 text-gray-500">{cat.slug}</td>
                                    <td className="p-4 text-center font-medium">{cat.sort_order}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${cat.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {cat.is_active ? 'Hiển thị' : 'Đang ẩn'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button className="text-blue-500 hover:text-blue-700 mr-3">Sửa</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">Thêm danh mục mới</h2>
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tên danh mục *</label>
                                <input 
                                    type="text" required value={formData.name} onChange={handleNameChange}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" 
                                    placeholder="VD: Cà phê, Trà sữa..."
                                />
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Thứ tự hiển thị</label>
                                <input 
                                    type="number" value={formData.sort_order} onChange={(e) => setFormData({...formData, sort_order: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" 
                                />
                                <span className="text-xs text-gray-500 mt-1">Số nhỏ hơn sẽ xếp lên trước (0, 1, 2...)</span>
                            </div>
                            <div className="mb-6">
                                <label className="flex items-center">
                                    <input 
                                        type="checkbox" checked={formData.is_active} 
                                        onChange={(e) => setFormData({...formData, is_active: e.target.checked})} 
                                        className="rounded text-blue-600 w-4 h-4 mr-2" 
                                    />
                                    <span className="text-sm text-gray-700">Kích hoạt hiển thị</span>
                                </label>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Hủy</button>
                                <button type="submit" disabled={isSubmitting} className={`px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {isSubmitting ? 'Đang lưu...' : 'Lưu danh mục'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default Categories;