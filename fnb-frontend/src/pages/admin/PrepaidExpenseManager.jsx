import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';
import DateInput from '../../components/DateInput';

const fmtMoney = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';
const TYPE_LABEL = { rent: 'Tiền thuê', capex: 'CAPEX', software: 'Phần mềm', other: 'Khác' };
const fmtMonth = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

// Gói 56: quản lý chi phí trả trước / CAPEX — phân bổ đều vào P&L theo tháng
export default function PrepaidExpenseManager() {
    const [items, setItems] = useState([]);
    const [form, setForm] = useState({ name: '', type: 'rent', total_amount: '', start_month: '', months: '12', note: '' });
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState('');

    const load = async () => {
        try {
            const res = await axios.get(`${API}/prepaid-expenses`);
            if (res.data?.success) setItems(res.data.data || []);
        } catch { /* bỏ qua */ }
    };
    useEffect(() => { load(); }, []);

    const resetForm = () => {
        setForm({ name: '', type: 'rent', total_amount: '', start_month: '', months: '12', note: '' });
        setEditingId(null);
    };

    const monthlyOf = (it) => {
        const m = Number(it.months) || 1;
        return (Number(it.total_amount) || 0) / m;
    };

    const save = async () => {
        if (!form.name.trim()) { alert('Nhập tên khoản chi'); return; }
        if (!form.total_amount || Number(form.total_amount) < 1) { alert('Nhập tổng tiền hợp lệ'); return; }
        if (!form.start_month) { alert('Chọn tháng bắt đầu'); return; }
        setMsg('');
        try {
            const payload = {
                name: form.name.trim(),
                type: form.type,
                total_amount: Number(form.total_amount),
                start_month: form.start_month,
                months: Number(form.months) || 12,
                note: form.note || null,
            };
            if (editingId) await axios.put(`${API}/prepaid-expenses/${editingId}`, payload);
            else await axios.post(`${API}/prepaid-expenses`, payload);
            setMsg('Đã lưu.');
            resetForm(); load();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại.'); }
    };

    const edit = (p) => {
        setEditingId(p.id);
        setForm({
            name: p.name, type: p.type || 'rent',
            total_amount: String(p.total_amount ?? ''),
            start_month: (p.start_month || '').slice(0, 10),
            months: String(p.months ?? 12), note: p.note || '',
        });
    };

    const remove = async (id) => {
        if (!window.confirm('Xóa khoản chi này?')) return;
        try { await axios.delete(`${API}/prepaid-expenses/${id}`); load(); }
        catch (e) { alert(e.response?.data?.message || 'Xóa thất bại.'); }
    };

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="py-2 pr-3 font-medium">Tên khoản chi</th>
                            <th className="py-2 pr-3 font-medium">Loại</th>
                            <th className="py-2 pr-3 font-medium text-right">Tổng tiền</th>
                            <th className="py-2 pr-3 font-medium">Từ tháng</th>
                            <th className="py-2 pr-3 font-medium text-right">Số tháng</th>
                            <th className="py-2 pr-3 font-medium text-right">Phân bổ/tháng</th>
                            <th className="py-2 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={7} className="py-4 text-center text-gray-400">Chưa có khoản chi trả trước nào.</td></tr>
                        ) : items.map((p) => (
                            <tr key={p.id} className="border-b border-gray-50">
                                <td className="py-2.5 pr-3 font-medium">{p.name}</td>
                                <td className="py-2.5 pr-3">{TYPE_LABEL[p.type] || p.type}</td>
                                <td className="py-2.5 pr-3 text-right">{fmtMoney(p.total_amount)}</td>
                                <td className="py-2.5 pr-3 whitespace-nowrap">{fmtMonth(p.start_month)}</td>
                                <td className="py-2.5 pr-3 text-right">{p.months}</td>
                                <td className="py-2.5 pr-3 text-right font-semibold text-[#F5A623]">{fmtMoney(monthlyOf(p))}</td>
                                <td className="py-2.5 text-right whitespace-nowrap">
                                    <button onClick={() => edit(p)} className="text-blue-600 text-[12px] mr-3">Sửa</button>
                                    <button onClick={() => remove(p.id)} className="text-red-600 text-[12px]">Xóa</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Tên khoản chi (VD: Thuê mặt bằng 6 tháng)" className="m-input col-span-2 sm:col-span-1" />
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input">
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                    placeholder="Tổng tiền" className="m-input" />
                <div>
                    <DateInput value={form.start_month} onChange={(v) => setForm({ ...form, start_month: v })}
                        className="m-input w-full" />
                    <div className="text-[11px] text-gray-400 mt-0.5">Tháng bắt đầu phân bổ</div>
                </div>
                <input type="number" min="1" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })}
                    placeholder="Số tháng" className="m-input" />
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                    placeholder="Ghi chú" className="m-input" />
            </div>
            {form.total_amount && form.months && (
                <div className="mt-2 text-[13px] text-gray-600">
                    Phân bổ mỗi tháng: <strong className="text-[#F5A623]">{fmtMoney((Number(form.total_amount) || 0) / (Number(form.months) || 1))}</strong>
                </div>
            )}
            <div className="mt-2 flex items-center gap-3">
                <button onClick={save} className="m-btn m-btn-primary text-[13px]">
                    {editingId ? 'Cập nhật' : '+ Thêm khoản chi'}
                </button>
                {editingId && <button onClick={resetForm} className="text-[13px] text-gray-500">Hủy</button>}
                {msg && <span className="text-[13px] text-green-600">{msg}</span>}
            </div>
        </div>
    );
}
