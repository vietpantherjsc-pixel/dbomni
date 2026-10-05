import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

const API = 'http://localhost/api';

// =====================================================================
// Gói 5 (2026-10-05): Thẻ thành viên — hạng + tỉ lệ tích điểm từng hạng,
// cấu hình quy đổi điểm (X điểm = Yđ), theo mẫu Sapo.
// =====================================================================
export default function MemberTiers() {
    const [tiers, setTiers] = useState([]);
    const [redeem, setRedeem] = useState({ points: 10, amount: 1000 });
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: '', min_total_spent: 0, earn_per_amount: 10000, earn_points: 1, is_default: false, sort_order: 0 });

    const fetchData = async () => {
        try {
            const res = await axios.get(`${API}/membership-tiers`);
            if (res.data?.success) {
                setTiers(res.data.data);
                if (res.data.redeem_config) setRedeem(res.data.redeem_config);
            }
        } catch (err) { console.error('Lỗi tải hạng:', err); }
    };
    useEffect(() => { fetchData(); }, []);

    const resetForm = () => {
        setEditing(null);
        setForm({ name: '', min_total_spent: 0, earn_per_amount: 10000, earn_points: 1, is_default: false, sort_order: 0 });
        setShowForm(false);
    };

    const startEdit = (t) => {
        setEditing(t.id);
        setForm({ name: t.name, min_total_spent: t.min_total_spent, earn_per_amount: t.earn_per_amount, earn_points: t.earn_points, is_default: !!t.is_default, sort_order: t.sort_order });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên hạng');
        try {
            const payload = { ...form, min_total_spent: Number(form.min_total_spent) || 0, earn_per_amount: Number(form.earn_per_amount) || 10000, earn_points: Number(form.earn_points) || 1 };
            const res = editing
                ? await axios.patch(`${API}/membership-tiers/${editing}`, payload)
                : await axios.post(`${API}/membership-tiers`, payload);
            if (res.data?.success) { resetForm(); fetchData(); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Xóa hạng này?')) return;
        try {
            const res = await axios.delete(`${API}/membership-tiers/${id}`);
            if (res.data?.success) fetchData();
            else alert(res.data?.message || 'Xóa thất bại');
        } catch (err) { alert(err.response?.data?.message || 'Xóa thất bại'); }
    };

    const handleSaveRedeem = async () => {
        try {
            const res = await axios.post(`${API}/membership-tiers/redeem-config`, {
                points: Number(redeem.points), amount: Number(redeem.amount),
            });
            if (res.data?.success) alert(res.data.message);
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    return (
        <AdminLayout>
            <div>
                <div className="flex items-center justify-between mb-1">
                    <h1 className="text-lg font-bold text-[#1f2937]">Thẻ thành viên</h1>
                    <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                        + Hạng mới
                    </button>
                </div>
                <p className="text-[13px] text-[#6b7280] mb-4">Hạng tự nâng theo tổng tiền tích lũy của khách.</p>

                {/* Cấu hình quy đổi điểm */}
                <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-[13px] text-gray-600">
                        <input type="checkbox" checked readOnly className="accent-[#0d6efd]" />
                        Áp dụng quy đổi điểm (
                    </label>
                    <input type="number" min="1" value={redeem.points} onChange={(e) => setRedeem({ ...redeem, points: e.target.value })}
                        className="w-20 px-2 py-1.5 text-[13px] border rounded text-center focus:outline-none focus:border-[#0d6efd]" />
                    <span className="text-[13px] text-gray-600">điểm =</span>
                    <input type="number" min="1" value={redeem.amount} onChange={(e) => setRedeem({ ...redeem, amount: e.target.value })}
                        className="w-28 px-2 py-1.5 text-[13px] border rounded text-center focus:outline-none focus:border-[#0d6efd]" />
                    <span className="text-[13px] text-gray-600">đ )</span>
                    <button onClick={handleSaveRedeem} className="ml-2 px-4 py-2 bg-gray-800 text-white text-[13px] rounded hover:bg-gray-700">Lưu</button>
                </div>

                {showForm && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                        <h3 className="font-semibold text-[14px] mb-3">{editing ? 'Sửa hạng' : 'Thêm hạng mới'}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div><label className="text-xs text-gray-500">Tên hạng *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Hạng Vàng"
                                    className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                            <div><label className="text-xs text-gray-500">Tiền tích lũy tối thiểu (đ)</label>
                                <input type="number" min="0" value={form.min_total_spent} onChange={(e) => setForm({ ...form, min_total_spent: e.target.value })}
                                    className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                            <div><label className="text-xs text-gray-500">Thứ tự</label>
                                <input type="number" min="0" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                                    className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                            <div><label className="text-xs text-gray-500">Cứ bao nhiêu đồng...</label>
                                <input type="number" min="1" value={form.earn_per_amount} onChange={(e) => setForm({ ...form, earn_per_amount: e.target.value })}
                                    className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                            <div><label className="text-xs text-gray-500">...được bao nhiêu điểm</label>
                                <input type="number" min="1" value={form.earn_points} onChange={(e) => setForm({ ...form, earn_points: e.target.value })}
                                    className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-[#0d6efd]" />
                                Hạng mặc định (khách mới)</label></div>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button onClick={handleSave} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">{editing ? 'Cập nhật' : 'Lưu'}</button>
                            <button onClick={resetForm} className="px-4 py-2 text-[13px] text-gray-500">Hủy</button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded shadow-sm overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[700px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-4 py-3 font-medium">Thẻ thành viên</th>
                                <th className="px-3 py-3 font-medium text-right">Tiền tích lũy tối thiểu</th>
                                <th className="px-3 py-3 font-medium text-right">Tỷ lệ tích điểm</th>
                                <th className="px-3 py-3 font-medium text-right">Số thành viên</th>
                                <th className="px-4 py-3 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tiers.map((t) => (
                                <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                    <td className="px-4 py-3">
                                        <span className="text-[#0d6efd] font-medium">{t.name}</span>
                                        {t.is_default && <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600">Mặc định</span>}
                                    </td>
                                    <td className="px-3 py-3 text-right">{Number(t.min_total_spent).toLocaleString('vi-VN')}đ</td>
                                    <td className="px-3 py-3 text-right">{Number(t.earn_per_amount).toLocaleString('vi-VN')}đ = {t.earn_points} điểm</td>
                                    <td className="px-3 py-3 text-right">{t.customers_count ?? 0}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => startEdit(t)} className="text-[#0d6efd] hover:underline mr-3">Sửa</button>
                                        <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:underline">Xóa</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </AdminLayout>
    );
}
