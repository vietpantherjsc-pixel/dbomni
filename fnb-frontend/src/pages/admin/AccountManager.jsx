import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { useSharedCategories, labelMap } from '../../utils/sharedCategories'; // Spec danh mục dùng chung

const fmtMoney = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';
// Spec danh mục dùng chung: fallback khi API lỗi/chưa migrate
const TYPE_LABEL_FB = { cash: 'Tiền mặt', safe: 'Két sắt', bank: 'Ngân hàng', ewallet: 'Ví điện tử' };

// Gói 56: quản lý quỹ (tiền mặt tại quầy, két sắt, tài khoản ngân hàng, ví/sàn)
// Spec cài đặt danh sách (2026-10-21): thêm cột + lọc Chi nhánh và chọn chi nhánh trong form;
// loại quỹ lấy từ Danh mục dùng chung account_types (cash/safe/bank/ewallet — đồng bộ backend).
export default function AccountManager() {
    // Spec danh mục dùng chung: loại quỹ đọc từ API, fallback cứng
    const TYPE_LABEL = labelMap(useSharedCategories('account_types', []), TYPE_LABEL_FB);
    const typeItems = useSharedCategories('account_types', Object.entries(TYPE_LABEL_FB).map(([code, name]) => ({ code, name })));
    const [items, setItems] = useState([]);
    const [branches, setBranches] = useState([]);
    // C3 (2026-10-21): bộ lọc CN = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều với
    // dropdown sidebar ('' tại trang này = '0' — Tất cả — ở context).
    const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
    const branchFilter = ctxBranchId === '0' ? '' : ctxBranchId;
    const setBranchFilter = (v) => setCtxBranchId(v === '' || v === null || v === undefined ? '0' : String(v));
    const [form, setForm] = useState({ name: '', type: 'cash', opening_balance: '0', is_active: true, branch_id: '' });
    const [editingId, setEditingId] = useState(null);
    const [msg, setMsg] = useState('');

    const load = async () => {
        try {
            const res = await axios.get(`${API}/accounts`, { params: branchFilter ? { branch_id: branchFilter } : {} });
            if (res.data?.success) setItems(res.data.data || []);
        } catch { /* bỏ qua */ }
    };
    useEffect(() => { load(); }, [branchFilter]);
    useEffect(() => {
        axios.get(`${API}/branches`).then((r) => setBranches(r.data?.data || [])).catch(() => {});
    }, []);

    const resetForm = () => {
        setForm({ name: '', type: 'cash', opening_balance: '0', is_active: true, branch_id: '' });
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
                branch_id: form.branch_id ? Number(form.branch_id) : null,
            };
            if (editingId) await axios.put(`${API}/accounts/${editingId}`, payload);
            else await axios.post(`${API}/accounts`, payload);
            setMsg('Đã lưu.');
            resetForm(); load();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại.'); }
    };

    const edit = (a) => {
        setEditingId(a.id);
        setForm({ name: a.name, type: a.type || 'cash', opening_balance: String(a.opening_balance ?? 0), is_active: !!a.is_active, branch_id: a.branch_id ? String(a.branch_id) : '' });
    };

    const remove = async (id) => {
        if (!window.confirm('Xóa quỹ này?')) return;
        try { await axios.delete(`${API}/accounts/${id}`); load(); }
        catch (e) { alert(e.response?.data?.message || 'Xóa thất bại.'); }
    };

    return (
        <div>
            <div className="flex items-center gap-2 mb-3">
                <label className="text-[13px] text-gray-500">Chi nhánh:</label>
                <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                    <option value="">Tất cả chi nhánh</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[640px]">
                    <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                            <th className="py-2 pr-3 font-medium">Tên quỹ</th>
                            <th className="py-2 pr-3 font-medium">Loại</th>
                            <th className="py-2 pr-3 font-medium">Chi nhánh</th>
                            <th className="py-2 pr-3 font-medium text-right">Số dư đầu kỳ</th>
                            <th className="py-2 pr-3 font-medium text-right">Số dư hiện tại</th>
                            <th className="py-2 font-medium text-right">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr><td colSpan={6} className="py-4 text-center text-gray-400">Chưa có quỹ nào.</td></tr>
                        ) : items.map((a) => (
                            <tr key={a.id} className="border-b border-gray-50">
                                <td className="py-2.5 pr-3 font-medium">{a.name}
                                    {!a.is_active && <span className="ml-2 text-[11px] text-gray-400">(tắt)</span>}
                                </td>
                                <td className="py-2.5 pr-3">{TYPE_LABEL[a.type] || a.type}</td>
                                <td className="py-2.5 pr-3">{a.branch?.name || <span className="text-gray-400">Tất cả chi nhánh</span>}</td>
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
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Tên quỹ (VD: Két sắt CN1)" className="m-input col-span-2" />
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="m-input">
                    {typeItems.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </select>
                <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="m-input">
                    <option value="">Tất cả chi nhánh</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
