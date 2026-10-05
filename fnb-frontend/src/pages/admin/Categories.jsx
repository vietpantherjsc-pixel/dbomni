import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

const Categories = () => {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState(null);
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

    const openAdd = () => {
        setFormData({ name: '', slug: '', sort_order: 0, is_active: true });
        setEditingId(null);
        setIsModalOpen(true);
    };

    // Gói 8a: bấm vào dòng để sửa
    const openEdit = (cat) => {
        setFormData({ name: cat.name, slug: cat.slug, sort_order: cat.sort_order ?? 0, is_active: Boolean(cat.is_active) });
        setEditingId(cat.id);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({ name: '', slug: '', sort_order: 0, is_active: true });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            if (editingId) {
                await axios.put(`http://localhost/api/categories/${editingId}`, formData);
            } else {
                await axios.post('http://localhost/api/categories', formData);
            }
            closeModal();
            fetchCategories();
        } catch (error) {
            alert("Có lỗi xảy ra: " + (error.response?.data?.message || "Vui lòng thử lại"));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AdminLayout>
            <div className="p-6 max-w-[1200px] mx-auto">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
                <div>
                    <h1 className="text-[22px] font-bold text-[var(--m-ink)]">Danh mục</h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--m-ink-soft)' }}>Phân nhóm các mặt hàng để hiển thị trên POS và Menu</p>
                </div>
                <button
                    onClick={openAdd}
                    className="m-btn m-btn-primary"
                >
                    + Thêm danh mục
                </button>
            </div>

            {/* Gói 7o: layout giống trang Mặt hàng */}
            <div className="m-card overflow-hidden">
                <table className="m-table">
                    <thead>
                        <tr>
                            <th className="whitespace-nowrap">Tên danh mục</th>
                            <th className="whitespace-nowrap">Đường dẫn (Slug)</th>
                            <th className="whitespace-nowrap text-center">Thứ tự</th>
                            <th className="whitespace-nowrap">Trạng thái</th>
                            <th className="whitespace-nowrap text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="5" className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Đang tải dữ liệu...</td></tr>
                        ) : categories.length === 0 ? (
                            <tr><td colSpan="5" className="p-8 text-center" style={{ color: 'var(--m-ink-faint)' }}>Chưa có danh mục nào.</td></tr>
                        ) : (
                            categories.map(cat => (
                                <tr key={cat.id} onClick={() => openEdit(cat)} className="cursor-pointer">
                                    <td className="font-medium whitespace-nowrap">{cat.name}</td>
                                    <td className="whitespace-nowrap" style={{ color: 'var(--m-ink-soft)' }}>{cat.slug}</td>
                                    <td className="text-center font-medium m-num">{cat.sort_order}</td>
                                    <td className="whitespace-nowrap">
                                        <span className={`m-badge ${cat.is_active ? 'm-badge-green' : 'm-badge-gray'}`}>
                                            {cat.is_active ? 'Hiển thị' : 'Đang ẩn'}
                                        </span>
                                    </td>
                                    <td className="text-right whitespace-nowrap">
                                        <button className="text-xs font-semibold hover:underline" style={{ color: 'var(--m-primary)' }} onClick={(e) => { e.stopPropagation(); openEdit(cat); }}>Sửa</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="m-modal-backdrop" onClick={closeModal}>
                    <div className="m-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="m-modal-head">{editingId ? "Sửa danh mục" : "Thêm danh mục mới"}</div>
                        <form onSubmit={handleSubmit}>
                        <div className="m-modal-body">
                            <div className="mb-4">
                                <label className="m-label">Tên danh mục *</label>
                                <input
                                    type="text" required value={formData.name} onChange={handleNameChange}
                                    className="m-input"
                                    placeholder="VD: Cà phê, Trà sữa..."
                                />
                            </div>
                            <div className="mb-4">
                                <label className="m-label">Thứ tự hiển thị</label>
                                <input
                                    type="number" value={formData.sort_order} onChange={(e) => setFormData({...formData, sort_order: e.target.value})}
                                    className="m-input"
                                />
                                <span className="text-xs mt-1 block" style={{ color: 'var(--m-ink-faint)' }}>Số nhỏ hơn sẽ xếp lên trước (0, 1, 2...)</span>
                            </div>
                            <div>
                                <label className="flex items-center text-sm" style={{ color: 'var(--m-ink)' }}>
                                    <input
                                        type="checkbox" checked={formData.is_active}
                                        onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                                        className="w-4 h-4 mr-2 accent-[#24305E]"
                                    />
                                    Kích hoạt hiển thị
                                </label>
                            </div>
                        </div>
                        <div className="m-modal-foot">
                                <button type="button" onClick={closeModal} className="m-btn m-btn-ghost">Hủy</button>
                                <button type="submit" disabled={isSubmitting} className="m-btn m-btn-primary" style={isSubmitting ? { opacity: 0.5 } : {}}>
                                    {isSubmitting ? 'Đang lưu...' : (editingId ? 'Cập nhật' : 'Lưu danh mục')}
                                </button>
                        </div>
                        </form>
                    </div>
                </div>
            )}
            </div>
        </AdminLayout>
    );
};

export default Categories;