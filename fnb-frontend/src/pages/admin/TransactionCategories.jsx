import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

// =====================================================================
// Gói 29 (2026-10-09): Trang Danh mục thu chi.
// - Bảng: tên, loại thu/chi, số phiếu đã dùng, badge Hệ thống.
// - Thêm/sửa/xóa; khóa xóa với danh mục hệ thống hoặc đang có phiếu.
// =====================================================================

const API = 'http://localhost/api';
const TYPE_LABEL = { income: 'Thu', expense: 'Chi' };

const emptyForm = () => ({ name: '', type: 'expense' });

const TransactionCategories = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/transaction-categories`);
            setRows(res.data?.data || []);
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
    const openEdit = (row) => {
        setEditing(row);
        setForm({ name: row.name, type: row.type });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên danh mục.');
        setSaving(true);
        try {
            if (editing) {
                await axios.put(`${API}/transaction-categories/${editing.id}`, {
                    name: form.name.trim(), type: form.type,
                });
            } else {
                await axios.post(`${API}/transaction-categories`, {
                    name: form.name.trim(), type: form.type,
                });
            }
            setShowForm(false);
            fetchData();
        } catch (e) {
            alert(e.response?.data?.message || 'Lưu thất bại.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (row) => {
        if (row.is_system) return;
        if (!window.confirm(`Xóa danh mục "${row.name}"?`)) return;
        try {
            await axios.delete(`${API}/transaction-categories/${row.id}`);
            fetchData();
        } catch (e) {
            alert(e.response?.data?.message || 'Xóa thất bại.');
        }
    };

    const filtered = rows.filter((r) =>
        !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase())
    );

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <h1 className="text-xl font-semibold">Danh mục thu chi</h1>
                    <button onClick={openAdd}
                        className="px-4 py-2.5 bg-[#24305E] text-white rounded-lg text-[13px] font-medium min-h-[44px]">
                        + Danh mục
                    </button>
                </div>
                <p className="text-[12.5px] text-gray-500 mb-4">Danh mục hệ thống (Nhập hàng, Bán hàng...) không được xóa.</p>

                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100">
                        <input value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm danh mục..."
                            className="w-full sm:max-w-xs text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[560px]">
                            <thead>
                                <tr className="text-left text-gray-500">
                                    <th className="px-4 py-3 font-medium">Tên danh mục</th>
                                    <th className="px-4 py-3 font-medium">Loại</th>
                                    <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Đang tải...</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Chưa có danh mục.</td></tr>
                                ) : filtered.map((r) => (
                                    <tr key={r.id} className="border-t border-gray-100">
                                        <td className="px-4 py-3 font-medium">
                                            {r.name}
                                            {r.is_system && (
                                                <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Hệ thống</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                                r.type === 'income'
                                                    ? 'bg-green-50 text-green-700 border-green-200'
                                                    : 'bg-red-50 text-red-700 border-red-200'
                                            }`}>{TYPE_LABEL[r.type]}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            <button onClick={() => openEdit(r)}
                                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] mr-2 min-h-[36px]">Sửa</button>
                                            {!r.is_system && (
                                                <button onClick={() => handleDelete(r)}
                                                    className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-[12.5px] min-h-[36px]">Xóa</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
                    <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl p-5" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[16px] font-semibold mb-4">{editing ? 'Sửa danh mục' : 'Thêm danh mục'}</h3>
                        <div className="space-y-3">
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Tên danh mục *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                            </div>
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Loại</label>
                                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]">
                                    <option value="expense">Chi</option>
                                    <option value="income">Thu</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowForm(false)}
                                className="flex-1 py-3 border border-gray-300 rounded-lg text-[14px] min-h-[48px]">Hủy</button>
                            <button onClick={handleSave} disabled={saving}
                                className="flex-1 py-3 bg-[#24305E] text-white rounded-lg text-[14px] font-medium min-h-[48px] disabled:opacity-50">
                                {saving ? 'Đang lưu...' : 'Lưu'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default TransactionCategories;
