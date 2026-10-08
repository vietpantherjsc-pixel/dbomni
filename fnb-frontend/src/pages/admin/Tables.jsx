import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 3 (2026-10-04): Quản lý bàn (bản gọn) — thêm/xóa/đổi trạng thái bàn.
// AuthContext đã gắn Bearer token vào axios.defaults nên dùng axios trực tiếp.
const API = 'http://localhost/api';
export default function Tables() {
    const [tables, setTables] = useState([]);
    const [newName, setNewName] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchTables = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/tables`, { params: { branch_id: 1 } });
            if (res.data.success) setTables(res.data.data);
        } catch (err) {
            console.error('Lỗi tải bàn:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchTables(); }, []);

    const handleAdd = async () => {
        const name = newName.trim();
        if (!name) return alert('Nhập tên bàn (VD: B01)');
        try {
            const res = await axios.post(`${API}/tables`, { branch_id: 1, name });
            if (res.data.success) {
                setNewName('');
                fetchTables();
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Thêm bàn thất bại');
        }
    };

    const handleToggleStatus = async (t) => {
        try {
            await axios.patch(`${API}/tables/${t.id}`, {
                status: t.status === 'empty' ? 'occupied' : 'empty',
            });
            fetchTables();
        } catch (err) {
            alert('Đổi trạng thái thất bại');
        }
    };

    const handleDelete = async (t) => {
        if (!window.confirm(`Xóa bàn ${t.name}?`)) return;
        try {
            await axios.delete(`${API}/tables/${t.id}`);
            fetchTables();
        } catch (err) {
            alert('Xóa bàn thất bại');
        }
    };

    return (
        <AdminLayout>
            <div className="p-5">
            <h1 className="text-xl font-semibold text-gray-800 mb-1">Quản lý bàn</h1>
            <p className="text-[13px] text-[#6b7280] mb-4">Danh sách bàn phục vụ tại quán (bấm vào thẻ để đổi trạng thái trống/có khách).</p>

            <div className="flex gap-2 mb-4 max-w-md">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder="Tên bàn mới (VD: B01)"
                    className="flex-1 px-3 py-2 text-[13px] border border-[#d1d5db] rounded-md focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                />
                <button
                    onClick={handleAdd}
                    className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-semibold rounded-md hover:bg-[#1d4ed8]"
                >
                    + Thêm bàn
                </button>
            </div>

            {loading ? (
                <p className="text-[13px] text-[#6b7280]">Đang tải...</p>
            ) : tables.length === 0 ? (
                <p className="text-[13px] text-[#6b7280]">Chưa có bàn nào. Thêm bàn đầu tiên ở trên.</p>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {tables.map((t) => (
                        <div
                            key={t.id}
                            onClick={() => handleToggleStatus(t)}
                            className={`relative border rounded-lg p-4 text-center cursor-pointer transition ${
                                t.status === 'occupied'
                                    ? 'bg-[#fef3c7] border-[#f59e0b]'
                                    : 'bg-white border-[#e5e7eb] hover:border-[#2563eb]'
                            }`}
                            title="Bấm để đổi trạng thái"
                        >
                            <div className="text-base font-bold text-[#1f2937]">{t.name}</div>
                            <div className={`text-[11px] mt-1 font-medium ${t.status === 'occupied' ? 'text-[#b45309]' : 'text-[#059669]'}`}>
                                {t.status === 'occupied' ? 'Có khách' : 'Trống'}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                                className="absolute top-1 right-1.5 text-[#9ca3af] hover:text-[#dc2626] text-sm leading-none"
                                title="Xóa bàn"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
            </div>
        </AdminLayout>
    );
}
