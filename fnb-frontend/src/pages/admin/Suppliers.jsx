import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { API } from '../../utils/api';

// =====================================================================
// Gói 55 p11ab (2026-10-14): Trang Nhà cung cấp — submenu dưới Kho hàng.
// Tái dùng bảng/API partners với type=supplier (đã có sẵn từ Gói 29).
// Liên kết với dropdown NCC trong phiếu nhập kho (ReceiptForm).
// =====================================================================

const emptyForm = () => ({
    code: '', name: '', type: 'supplier', phone: '', email: '',
    address: '', tax_code: '', note: '', is_active: true,
});

const Suppliers = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);

    const fetchList = useCallback(async () => {
        setLoading(true);
        try {
            const params = { type: 'supplier' };
            if (search.trim()) params.search = search.trim();
            const r = await axios.get(`${API}/partners`, { params });
            setRows(r.data?.data || []);
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [search]);

    useEffect(() => { fetchList(); }, [fetchList]);

    const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
    const openEdit = (row) => {
        setEditing(row);
        setForm({
            code: row.code || '', name: row.name || '', type: 'supplier',
            phone: row.phone || '', email: row.email || '', address: row.address || '',
            tax_code: row.tax_code || '', note: row.note || '', is_active: !!row.is_active,
        });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên nhà cung cấp.');
        setSaving(true);
        try {
            const body = { ...form, type: 'supplier', name: form.name.trim(), code: form.code.trim() || undefined };
            if (editing) await axios.put(`${API}/partners/${editing.id}`, body);
            else await axios.post(`${API}/partners`, body);
            setShowForm(false);
            fetchList();
        } catch (e) {
            alert(e.response?.data?.message || 'Lưu thất bại.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Xóa nhà cung cấp "${row.name}"?`)) return;
        try {
            await axios.delete(`${API}/partners/${row.id}`);
            fetchList();
        } catch (e) {
            alert(e.response?.data?.message || 'Xóa thất bại.');
        }
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <h1 className="text-xl font-semibold">Nhà cung cấp</h1>
                    <button onClick={openAdd}
                        className="px-4 py-2.5 bg-[#24305E] text-white rounded-lg text-[13px] font-medium min-h-[44px]">
                        + Nhà cung cấp
                    </button>
                </div>
                <p className="text-[12.5px] text-gray-500 mb-4">Dùng trong phiếu nhập kho (chọn nhà cung cấp).</p>

                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100">
                        <input value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm tên/mã/SĐT/MST..."
                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[820px]">
                            <thead>
                                <tr className="text-left text-gray-500">
                                    <th className="px-4 py-3 font-medium">Mã</th>
                                    <th className="px-4 py-3 font-medium">Tên nhà cung cấp</th>
                                    <th className="px-4 py-3 font-medium">SĐT</th>
                                    <th className="px-4 py-3 font-medium">MST</th>
                                    <th className="px-4 py-3 font-medium">Địa chỉ / Thông tin công ty</th>
                                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                                    <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Đang tải...</td></tr>
                                ) : rows.length === 0 ? (
                                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Chưa có nhà cung cấp.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.id} className="border-t border-gray-100">
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.code || '—'}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium">{r.name}</div>
                                            {r.email && <div className="text-[11.5px] text-gray-400">{r.email}</div>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">{r.phone || '—'}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">{r.tax_code || '—'}</td>
                                        <td className="px-4 py-3 text-[12.5px] text-gray-600 max-w-[220px] truncate" title={r.address || ''}>
                                            {r.address || '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            {r.is_active
                                                ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Đang hợp tác</span>
                                                : <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Ngừng hợp tác</span>}
                                        </td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            <button onClick={() => openEdit(r)}
                                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] mr-2 min-h-[36px]">Sửa</button>
                                            <button onClick={() => handleDelete(r)}
                                                className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-[12.5px] min-h-[36px]">Xóa</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal thêm/sửa */}
            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
                    <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[16px] font-semibold mb-4">{editing ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}</h3>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Mã (để trống = tự sinh)</label>
                                    <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Mã số thuế (MST)</label>
                                    <input value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Tên nhà cung cấp *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">SĐT</label>
                                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Email</label>
                                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Địa chỉ / Thông tin công ty</label>
                                <textarea value={form.address} rows={2} onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Ghi chú</label>
                                    <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div className="flex items-end pb-3">
                                    <label className="text-[13px] flex items-center gap-2">
                                        <input type="checkbox" checked={form.is_active}
                                            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                                            className="w-4 h-4" /> Đang hợp tác
                                    </label>
                                </div>
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

export default Suppliers;
