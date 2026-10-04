import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

const Products = () => {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState(null); // Lưu ID nếu đang sửa
    
    const initialFormState = {
        category_id: '',
        name: '',
        slug: '',
        base_price: '',
        is_active: true,
        sell_on_pos: true,
        sell_on_zalo: false
    };
    
    const [formData, setFormData] = useState(initialFormState);

    useEffect(() => {
        fetchProducts();
        fetchCategories();
    }, []);

    const fetchProducts = async () => {
        try {
            const response = await axios.get('http://localhost/api/products');
            setProducts(response.data);
        } catch (error) {
            console.error("Lỗi khi tải danh sách mặt hàng:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const response = await axios.get('http://localhost/api/categories');
            setCategories(response.data);
        } catch (error) {
            console.error("Lỗi khi tải danh mục:", error);
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

    // Hàm mở form để Sửa
    const handleEdit = (product) => {
        setFormData({
            category_id: product.category_id || '',
            name: product.name,
            slug: product.slug,
            base_price: product.base_price,
            is_active: Boolean(product.is_active),
            sell_on_pos: Boolean(product.sell_on_pos),
            sell_on_zalo: Boolean(product.sell_on_zalo)
        });
        setEditingId(product.id);
        setIsModalOpen(true);
    };

    // Hàm Xóa
    const handleDelete = async (id) => {
        if (window.confirm("Bạn có chắc chắn muốn xóa mặt hàng này?")) {
            try {
                await axios.delete(`http://localhost/api/products/${id}`);
                fetchProducts();
            } catch (error) {
                alert("Lỗi khi xóa: " + (error.response?.data?.message || "Vui lòng thử lại"));
            }
        }
    };

    // Xử lý gửi Form (Thêm mới HOẶC Cập nhật)
    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            if (editingId) {
                // Gọi API PUT để cập nhật
                await axios.put(`http://localhost/api/products/${editingId}`, formData);
            } else {
                // Gọi API POST để thêm mới
                await axios.post('http://localhost/api/products', formData);
            }
            setIsModalOpen(false);
            setFormData(initialFormState);
            setEditingId(null);
            fetchProducts();
        } catch (error) {
            alert("Có lỗi xảy ra: " + (error.response?.data?.message || "Vui lòng kiểm tra lại dữ liệu"));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Hàm đóng Modal và reset Form
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData(initialFormState);
        setEditingId(null);
    };

    return (
        <AdminLayout>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Quản lý Mặt hàng</h1>
                    <p className="text-gray-500 text-sm mt-1">Quản lý danh sách sản phẩm, giá bán và trạng thái</p>
                </div>
                <button 
                    onClick={() => setIsModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
                >
                    + Thêm mặt hàng
                </button>
            </div>
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 text-sm uppercase tracking-wider">
                            <th className="p-4 font-semibold">Tên mặt hàng</th>
                            <th className="p-4 font-semibold">Danh mục</th>
                            <th className="p-4 font-semibold">Giá bán</th>
                            <th className="p-4 font-semibold">Trạng thái</th>
                            <th className="p-4 font-semibold">Kênh bán</th>
                            <th className="p-4 font-semibold text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {loading ? (
                            <tr><td colSpan="6" className="p-8 text-center text-gray-500">Đang tải dữ liệu...</td></tr>
                        ) : products.length === 0 ? (
                            <tr><td colSpan="6" className="p-8 text-center text-gray-500">Chưa có mặt hàng nào.</td></tr>
                        ) : (
                            products.map(product => (
                                <tr key={product.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-medium text-gray-800">{product.name}</td>
                                    <td className="p-4 text-gray-600">{product.category?.name || 'Chưa phân loại'}</td>
                                    <td className="p-4 text-gray-800 font-medium">{Number(product.base_price).toLocaleString('vi-VN')} ₫</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${product.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {product.is_active ? 'Đang bán' : 'Ngừng bán'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-xs font-medium text-gray-500 space-y-1">
                                        {product.sell_on_pos === 1 && <span className="block text-blue-600">POS</span>}
                                        {product.sell_on_zalo === 1 && <span className="block text-purple-600">Zalo</span>}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button onClick={() => handleEdit(product)} className="text-blue-500 hover:text-blue-700 mr-3">Sửa</button>
                                        <button onClick={() => handleDelete(product.id)} className="text-red-500 hover:text-red-700">Xóa</button>
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
                        <h2 className="text-xl font-bold text-gray-800 mb-4">{editingId ? 'Cập nhật mặt hàng' : 'Thêm mặt hàng mới'}</h2>
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tên mặt hàng *</label>
                                <input 
                                    type="text" required value={formData.name} onChange={handleNameChange}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" 
                                />
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Danh mục</label>
                                <select 
                                    value={formData.category_id}
                                    onChange={(e) => setFormData({...formData, category_id: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                >
                                    <option value="">-- Chưa phân loại --</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Giá bán cơ bản (VNĐ) *</label>
                                <input 
                                    type="number" required min="0" value={formData.base_price}
                                    onChange={(e) => setFormData({...formData, base_price: e.target.value})}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" 
                                />
                            </div>
                            <div className="mb-6 space-y-3">
                                <label className="flex items-center">
                                    <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({...formData, is_active: e.target.checked})} className="rounded text-blue-600 w-4 h-4 mr-2" />
                                    <span className="text-sm text-gray-700">Kích hoạt bán</span>
                                </label>
                                <label className="flex items-center">
                                    <input type="checkbox" checked={formData.sell_on_pos} onChange={(e) => setFormData({...formData, sell_on_pos: e.target.checked})} className="rounded text-blue-600 w-4 h-4 mr-2" />
                                    <span className="text-sm text-gray-700">Hiển thị trên máy POS (Thu ngân)</span>
                                </label>
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button type="button" onClick={handleCloseModal} className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">Hủy</button>
                                <button type="submit" disabled={isSubmitting} className={`px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {isSubmitting ? 'Đang lưu...' : 'Lưu mặt hàng'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default Products;