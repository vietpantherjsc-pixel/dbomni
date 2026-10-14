import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

const fmtMoney = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';
const TYPE_LABEL = { cash: 'Tiền mặt', bank: 'Ngân hàng', ewallet: 'Ví điện tử', other: 'Khác' };

// Gói 56: quản lý quỹ (tiền mặt tại quầy, két sắt, tài khoản ngân hàng, ví/sàn)
export default function AccountManager() {
    const [items, setItems] = useState([]);
    const [form, setForm] = useState({ name: '', type: 'cash', opening_balance: '0', is_active: true });
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState('');

    const load = async () => {
        try {
            const res = await axios.get(`${API}/accounts`);
            if (res.data?.success) setItems(res.data.data || []);
        } catch { /* bỏ qua */ }
    };
    useEffect(() => { load(); }, []);

    const resetForm = () => {
        setForm({ name: '', type: 'cash', opening_balance: '0', is_active: true });
        setEditingId(null);
    };

    const save = async () => {
        if (!form.name.trim()) { alert('Nhập tên quỹ'); return; }
        setMsg('');
        try {
            const payload = {
                name: form.name.trim(),
                type: form.type,
                opening_balance: Number(form.opening_balance) || 0,
                is_active: !!form.is_active,
            };
            if (editingId) await axios.put(`${API}/accounts/${editingId}`, payload);
            else await axios.post(`${API}/accounts`, payload);
            setMsg('Đã lưu.');
            resetForm(); load();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại.'); }
    };

    const edit = (a) => {
        setEditingId(a.id);
        setForm({ name: a.name, type: a.type || 'cash', opening_balance: String(a.opening_balance ?? 0), is_active: !!a.is_active });
    };

    const remove = async (id) => {
        if (!window.confirm('Xóa quỹ này?')) return;
        try { await axios.delete(`${API}/accounts/${id}`); load(); }
        catch (e) { alert(e.response?.data?.message || 'Xóa thất bại.'); }
    };

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[560px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="py-2 pr-3 font-medium">Tên quỹ</th>
                            <th className="py-2 pr-3 font-medium">Loại</th>
                            <th className="py-2 pr-3 font-medium text-right">Số dư đầu kỳ</th>
                            <th className="py-2 pr-3 font-medium text-right">Số dư hiện tại</th>
                            <th className="py-2 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={5} className="py-4 text-center text-gray-400">Chưa có quỹ nào.</td></tr>
                        ) : items.map((a) => (
                            <tr key={a.id} className="border-b border-gray-50">
                                <td className="py-2.5 pr-3 font-medium">{a.name}
                                    {!a.is_active && <span className="ml-2 text-[11px] text-gray-400">(tắt)</span>}
                                </td>
                                <td className="py-2.5 pr-3">{TYPE_LABEL[a.type] || a.type}</td>
                                <td className="py-2.5 pr-3 text-right">{fmtMoney(a.opening_balance)}</td>
                                <td className="py-2.5 pr-3 text-right font-semibold text-[#24305E]">{fmtMoney(a.current_balance)}</td>
                                <td className="py-2.5 text-right whitespace-nowrap">
                                    <button onClick={() => edit(a)} className="text-blue-600 text-[12px] mr-3">Sửa</button>
                                    <button onClick={() => remove(a.id)} className="text-red-600 text-[12px]">Xóa</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Tên quỹ (VD: Két sắt CN1)" className="m-input col-span-2" />
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input">
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                    placeholder="Số dư đầu kỳ" className="m-input" />
            </div>
            <div className="mt-2 flex items-center gap-3">
                <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
                    Đang dùng
                </label>
                <button onClick={save} className="m-btn m-btn-primary text-[13px]">
                    {editingId ? 'Cập nhật' : '+ Thêm quỹ'}
                </button>
                {editingId && <button onClick={resetForm} className="text-[13px] text-gray-500">Hủy</button>}
                {msg && <span className="text-[13px] text-green-600">{msg}</span>}
            </div>
        </div>
    );
}
