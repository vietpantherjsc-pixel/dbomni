import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { API } from '../../utils/api';

// Loyalty 2.0 (2026-10-21): Cửa hàng đổi điểm — Admin tự cài đặt danh sách
// món đổi theo mùa (spec mục 6.3). Mỗi món gắn 1 mẫu coupon (promotion);
// khách đổi bằng điểm trên Mini App, coupon phát vào ví qua mẫu này.
const EMPTY = { name: '', icon: '🎁', promotion_id: '', points_cost: 100, min_tier_id: '', daily_limit: '', per_customer_limit: '', sort_order: 0, is_active: true };

export default function PointExchange() {
    const [items, setItems] = useState([]);
    const [promotions, setPromotions] = useState([]);
    const [tiers, setTiers] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);

    const fetchData = async () => {
        try {
            const [ri, rp, rt] = await Promise.all([
                axios.get(`${API}/point-exchange-items`),
                axios.get(`${API}/promotions`, { params: { per_page: 200 } }),
                axios.get(`${API}/membership-tiers`),
            ]);
            if (ri.data?.success) setItems(ri.data.data);
            if (rp.data?.success) setPromotions(rp.data.data.data || rp.data.data || []);
            if (rt.data?.success) setTiers(rt.data.data);
        } catch (err) { console.error('Lỗi tải Cửa hàng điểm:', err); }
    };
    useEffect(() => { fetchData(); }, []);

    const resetForm = () => { setEditing(null); setForm(EMPTY); setShowForm(false); };
    const startEdit = (it) => {
        setEditing(it.id);
        setForm({
            name: it.name, icon: it.icon || '🎁', promotion_id: it.promotion_id,
            points_cost: it.points_cost, min_tier_id: it.min_tier_id || '',
            daily_limit: it.daily_limit ?? '', per_customer_limit: it.per_customer_limit ?? '',
            sort_order: it.sort_order, is_active: !!it.is_active,
        });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên món đổi');
        if (!form.promotion_id) return alert('Chọn mẫu coupon');
        try {
            const payload = {
                ...form,
                promotion_id: Number(form.promotion_id),
                points_cost: Number(form.points_cost) || 0,
                min_tier_id: form.min_tier_id ? Number(form.min_tier_id) : null,
                daily_limit: form.daily_limit === '' ? null : Number(form.daily_limit),
                per_customer_limit: form.per_customer_limit === '' ? null : Number(form.per_customer_limit),
                sort_order: Number(form.sort_order) || 0,
            };
            const res = editing
                ? await axios.patch(`${API}/point-exchange-items/${editing}`, payload)
                : await axios.post(`${API}/point-exchange-items`, payload);
            if (res.data?.success) { resetForm(); fetchData(); }
        } catch (err) { alert(err.response?.data?.message || 'Lưu thất bại'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Xóa món đổi này?')) return;
        try {
            const res = await axios.delete(`${API}/point-exchange-items/${id}`);
            if (res.data?.success) fetchData();
        } catch (err) { alert(err.response?.data?.message || 'Xóa thất bại'); }
    };

    const inp = 'w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]';

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-1">
                    <h1 className="text-xl font-semibold text-gray-800">Cửa hàng đổi điểm</h1>
                    <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                        + Món đổi mới
                    </button>
                </div>
                <p className="text-[13px] text-[#6b7280] mb-4">Khách dùng điểm đổi các món này trên Mini App (Tài khoản › Cửa hàng điểm); coupon được phát vào ví theo mẫu đã chọn. Nên tạo mẫu coupon riêng cho đổi điểm để tách báo cáo.</p>

                {showForm && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
                        <h3 className="font-semibold text-[14px] mb-3">{editing ? 'Sửa món đổi' : 'Thêm món đổi mới'}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div><label className="text-xs text-gray-500">Tên món đổi *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Coupon giảm 20.000đ" className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Icon hiển thị</label>
                                <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="🎁" className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Thứ tự</label>
                                <input type="number" min="0" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Mẫu coupon phát khi đổi *</label>
                                <select value={form.promotion_id} onChange={(e) => setForm({ ...form, promotion_id: e.target.value })} className={inp}>
                                    <option value="">— Chọn mẫu coupon —</option>
                                    {promotions.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                                </select></div>
                            <div><label className="text-xs text-gray-500">Giá điểm chuẩn *</label>
                                <input type="number" min="1" value={form.points_cost} onChange={(e) => setForm({ ...form, points_cost: e.target.value })} className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Hạng tối thiểu được đổi</label>
                                <select value={form.min_tier_id} onChange={(e) => setForm({ ...form, min_tier_id: e.target.value })} className={inp}>
                                    <option value="">— Mọi hạng —</option>
                                    {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select></div>
                            <div><label className="text-xs text-gray-500">Trần lượt đổi/ngày (toàn hệ thống)</label>
                                <input type="number" min="1" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: e.target.value })} placeholder="Trống = không giới hạn" className={inp} /></div>
                            <div><label className="text-xs text-gray-500">Trần lượt đổi/khách (toàn thời gian)</label>
                                <input type="number" min="1" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value })} placeholder="Trống = không giới hạn" className={inp} /></div>
                            <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-[#0d6efd]" />
                                Đang bật (hiện trên Mini App)</label></div>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button onClick={handleSave} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">{editing ? 'Cập nhật' : 'Lưu'}</button>
                            <button onClick={resetForm} className="px-4 py-2 text-[13px] text-gray-500">Hủy</button>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded shadow-sm overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[800px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-4 py-3 font-medium">Món đổi</th>
                                <th className="px-3 py-3 font-medium">Mẫu coupon</th>
                                <th className="px-3 py-3 font-medium text-right">Giá điểm</th>
                                <th className="px-3 py-3 font-medium">Hạng tối thiểu</th>
                                <th className="px-3 py-3 font-medium text-right">Trần ngày/khách</th>
                                <th className="px-3 py-3 font-medium">Trạng thái</th>
                                <th className="px-4 py-3 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((it) => (
                                <tr key={it.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                    <td className="px-4 py-3"><span className="mr-1">{it.icon || '🎁'}</span> <span className="font-medium">{it.name}</span></td>
                                    <td className="px-3 py-3">{it.promotion ? `${it.promotion.code} · ${it.promotion.name}` : '—'}</td>
                                    <td className="px-3 py-3 text-right">{Number(it.points_cost).toLocaleString('vi-VN')} điểm</td>
                                    <td className="px-3 py-3">{it.min_tier?.name || 'Mọi hạng'}</td>
                                    <td className="px-3 py-3 text-right">{it.daily_limit ?? '∞'} / {it.per_customer_limit ?? '∞'}</td>
                                    <td className="px-3 py-3">{it.is_active
                                        ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-green-50 text-green-700">Đang bật</span>
                                        : <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500">Đã tắt</span>}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => startEdit(it)} className="text-[#0d6efd] hover:underline mr-3">Sửa</button>
                                        <button onClick={() => handleDelete(it.id)} className="text-red-500 hover:underline">Xóa</button>
                                    </td>
                                </tr>
                            ))}
                            {items.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Chưa có món đổi nào. Bấm "+ Món đổi mới" để cài đặt theo mùa.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </AdminLayout>
    );
}
