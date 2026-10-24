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
// Spec cài đặt danh sách (2026-10-21): sửa LỆCH TÊN TRƯỜNG — frontend dùng đúng tên backend
// (category / start_date / notes thay cho type / start_month / note), phân bổ/tháng lấy
// monthly_amount backend trả; thêm cột + chọn Chi nhánh (branch_id null = toàn hệ thống).
export default function PrepaidExpenseManager() {
    const [items, setItems] = useState([]);
    const [branches, setBranches] = useState([]);
    const [form, setForm] = useState({ name: '', category: 'rent', total_amount: '', start_date: '', months: '12', notes: '', branch_id: '' });
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState('');

    const load = async () => {
        try {
            const res = await axios.get(`${API}/prepaid-expenses`);
            if (res.data?.success) setItems(res.data.data || []);
        } catch { /* bỏ qua */ }
    };
    useEffect(() => { load(); }, []);
    useEffect(() => {
        axios.get(`${API}/branches`).then((r) => setBranches(r.data?.data || [])).catch(() => {});
    }, []);

    const resetForm = () => {
        setForm({ name: '', category: 'rent', total_amount: '', start_date: '', months: '12', notes: '', branch_id: '' });
        setEditingId(null);
    };

    const monthlyOf = (it) => {
        if (it.monthly_amount != null) return Number(it.monthly_amount) || 0;
        const m = Number(it.months) || 1;
        return (Number(it.total_amount) || 0) / m;
    };

    const save = async () => {
        if (!form.name.trim()) { alert('Nhập tên khoản chi'); return; }
        if (!form.total_amount || Number(form.total_amount) < 1) { alert('Nhập tổng tiền hợp lệ'); return; }
        if (!form.start_date) { alert('Chọn ngày bắt đầu'); return; }
        setMsg('');
        try {
            const payload = {
                name: form.name.trim(),
                category: form.category,
                total_amount: Number(form.total_amount),
                start_date: form.start_date,
                months: Number(form.months) || 12,
                notes: form.notes || null,
                branch_id: form.branch_id ? Number(form.branch_id) : null,
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
            name: p.name, category: p.category || 'rent',
            total_amount: String(p.total_amount ?? ''),
            start_date: (p.start_date || '').slice(0, 10),
            months: String(p.months ?? 12), notes: p.notes || '',
            branch_id: p.branch_id ? String(p.branch_id) : '',
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
                <table className="w-full text-[13px] min-w-[720px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="py-2 pr-3 font-medium">Tên khoản chi</th>
                            <th className="py-2 pr-3 font-medium">Loại</th>
                            <th className="py-2 pr-3 font-medium">Chi nhánh</th>
                            <th className="py-2 pr-3 font-medium text-right">Tổng tiền</th>
                            <th className="py-2 pr-3 font-medium">Từ tháng</th>
                            <th className="py-2 pr-3 font-medium text-right">Số tháng</th>
                            <th className="py-2 pr-3 font-medium text-right">Phân bổ/tháng</th>
                            <th className="py-2 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={8} className="py-4 text-center text-gray-400">Chưa có khoản chi trả trước nào.</td></tr>
                        ) : items.map((p) => (
                            <tr key={p.id} className="border-b border-gray-50">
                                <td className="py-2.5 pr-3 font-medium">{p.name}</td>
                                <td className="py-2.5 pr-3">{TYPE_LABEL[p.category] || p.category}</td>
                                <td className="py-2.5 pr-3">{p.branch?.name || <span className="text-gray-400">Toàn hệ thống</span>}</td>
                                <td className="py-2.5 pr-3 text-right">{fmtMoney(p.total_amount)}</td>
                                <td className="py-2.5 pr-3 whitespace-nowrap">{fmtMonth(p.start_date)}</td>
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
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="m-input">
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="m-input">
                    <option value="">Toàn hệ thống</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
                    placeholder="Tổng tiền" className="m-input" />
                <div>
                    <DateInput value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })}
                        className="m-input w-full" />
                    <div className="text-[11px] text-gray-400 mt-0.5">Ngày bắt đầu phân bổ</div>
                </div>
                <input type="number" min="1" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })}
                    placeholder="Số tháng" className="m-input" />
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
