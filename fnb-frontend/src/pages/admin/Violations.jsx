import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';

const API = 'http://localhost/api';
const CAT_META = {
    chuyen_can: { name: 'Chuyên Cần', badge: 'bg-blue-100 text-blue-700' },
    chuyen_mon: { name: 'Chuyên Môn', badge: 'bg-amber-100 text-amber-700' },
    chuyen_nghiep: { name: 'Chuyên Nghiệp', badge: 'bg-purple-100 text-purple-700' },
};
const catOf = (v) => CAT_META[v.category] || { name: v.category_name || v.category, badge: 'bg-gray-100 text-gray-600' };

// Gói 40: Tab "Lỗi 3 Chuyên" trong Chấm công — quản lý cửa hàng ghi nhận lỗi
// (không cần vào bảng lương). NV cũng có link riêng để tự báo lỗi của mình.
export default function Violations() {
    const { can } = useAuth();
    const [month, setMonth] = useState(() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); });
    const [empFilter, setEmpFilter] = useState('');
    const [branchId, setBranchId] = useState('');
    const [rows, setRows] = useState([]);
    const [types, setTypes] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(false);
    const [modal, setModal] = useState(null); // {id?, employee_id, violation_type_id, points, date, note}

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [v, t, e, b] = await Promise.all([
                axios.get(API + '/violations', { params: { month, employee_id: empFilter || undefined, branch_id: branchId || undefined } }),
                axios.get(API + '/violation-types'),
                axios.get(API + '/employees', { params: { is_active: 1, per_page: 100 } }),
                axios.get(API + '/branches'),
            ]);
            setRows(v.data?.data?.items || []);
            setTypes((t.data?.data || []).filter((x) => x.is_active !== false));
            setEmployees(e.data?.data?.data || e.data?.data || []);
            setBranches(b.data?.data || b.data || []);
        } catch (err) { alert(err.response?.data?.message || 'Tải dữ liệu thất bại'); }
        setLoading(false);
    }, [month, empFilter, branchId]);
    useEffect(() => { fetchAll(); }, [fetchAll]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);
    const editable = can('staff.edit');
    const inp = 'border border-gray-300 rounded px-2 py-1.5 text-[13px] w-full';
    const btn = 'px-3 py-1.5 rounded text-[13px] font-medium ';

    const openAdd = () => setModal({ employee_id: '', violation_type_id: '', points: '', date: '', note: '' });
    const openEdit = (r) => setModal({ id: r.id, employee_id: String(r.employee_id), violation_type_id: String(r.violation_type_id || ''), points: r.points, date: r.date?.slice(0, 10) || '', note: r.note || '' });

    const pickType = (id) => {
        const t = types.find((x) => String(x.id) === String(id));
        setModal((m) => ({ ...m, violation_type_id: id, points: t ? t.default_points : m.points }));
    };

    const save = async () => {
        if (!modal.employee_id) return alert('Chọn nhân viên');
        if (!modal.violation_type_id) return alert('Chọn lỗi vi phạm');
        if (!modal.date) return alert('Chọn ngày vi phạm');
        const body = { employee_id: Number(modal.employee_id), violation_type_id: Number(modal.violation_type_id), date: modal.date, note: modal.note || null };
        if (modal.points !== '' && modal.points != null) body.points = Number(modal.points);
        try {
            if (modal.id) await axios.put(API + '/violations/' + modal.id, body);
            else await axios.post(API + '/violations', body);
            setModal(null); fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const del = async (id) => {
        if (!window.confirm('Xóa lỗi vi phạm này? Số lỗi trong bảng lương sẽ tự cập nhật lại.')) return;
        try { await axios.delete(API + '/violations/' + id); fetchAll(); }
        catch (e) { alert(e.response?.data?.message || 'Xóa thất bại'); }
    };

    const cats = ['chuyen_can', 'chuyen_mon', 'chuyen_nghiep'];

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Lỗi 3 Chuyên</h1>
                    <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]" title="Tháng" />
                    <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        <option value="">Tất cả nhân viên</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                    </select>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {editable && <button onClick={openAdd} className={btn + 'bg-[#24305E] text-white'}>＋ Ghi nhận lỗi</button>}
                </div>
                <p className="text-[12px] text-gray-500 mb-3">Số lỗi tự cộng vào bảng lương tháng {month}. NV tự báo qua link riêng chỉ thấy lỗi của mình.</p>

                {loading ? <div className="text-gray-500 text-sm py-10 text-center">Đang tải...</div> : (
                    <div className="m-card overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[760px]">
                            <thead><tr className="text-left text-gray-500 border-b border-gray-200">
                                <th className="px-3 py-2.5 font-medium">Tên nhân viên</th>
                                <th className="px-3 py-2.5 font-medium">Lỗi vi phạm</th>
                                <th className="px-3 py-2.5 font-medium text-center">Số lỗi</th>
                                <th className="px-3 py-2.5 font-medium">Ngày vi phạm</th>
                                <th className="px-3 py-2.5 font-medium">Nguồn</th>
                                {editable && <th className="px-3 py-2.5"></th>}
                            </tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-b border-gray-50">
                                        <td className="px-3 py-2.5 font-medium">{r.employee_name}</td>
                                        <td className="px-3 py-2.5">
                                            {r.violation_name}
                                            <span className={'inline-block ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold ' + catOf(r).badge}>{catOf(r).name}</span>
                                            {r.note && <div className="text-[12px] text-gray-400 mt-0.5">{r.note}</div>}
                                        </td>
                                        <td className="px-3 py-2.5 text-center font-bold text-[#24305E]">{r.points}</td>
                                        <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(r.date)}</td>
                                        <td className="px-3 py-2.5">
                                            <span className={'inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ' + (r.source === 'self' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                                                {r.source_label || (r.source === 'self' ? 'NV tự báo' : 'Quản lý ghi')}
                                            </span>
                                        </td>
                                        {editable && <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                            <button onClick={() => openEdit(r)} className="text-[#0d6efd] text-[12px] mr-3">Sửa</button>
                                            <button onClick={() => del(r.id)} className="text-red-500 text-[12px]">Xóa</button>
                                        </td>}
                                    </tr>
                                ))}
                                {rows.length === 0 && <tr><td colSpan={editable ? 6 : 5} className="px-4 py-8 text-center text-gray-400">Chưa có lỗi vi phạm nào trong tháng.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}

                {modal && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setModal(null)}>
                        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[480px] max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                            <h2 className="font-bold text-[16px] text-[#24305E] mb-3">{modal.id ? 'Sửa lỗi vi phạm' : 'Ghi nhận lỗi vi phạm'}</h2>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <label className="text-[12px] text-gray-500">Nhân viên *</label>
                                    <select value={modal.employee_id} onChange={(e) => setModal({ ...modal, employee_id: e.target.value })} className={inp + ' mt-1'}>
                                        <option value="">— Chọn —</option>
                                        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                                    </select>
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[12px] text-gray-500">Lỗi vi phạm *</label>
                                    <select value={modal.violation_type_id} onChange={(e) => pickType(e.target.value)} className={inp + ' mt-1'}>
                                        <option value="">— Chọn —</option>
                                        {cats.map((c) => (
                                            <optgroup key={c} label={CAT_META[c].name}>
                                                {types.filter((t) => t.category === c).map((t) => (
                                                    <option key={t.id} value={t.id}>{t.name} ({t.default_points} lỗi)</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[12px] text-gray-500">Số lỗi vi phạm</label>
                                    <input type="number" min="1" value={modal.points} onChange={(e) => setModal({ ...modal, points: e.target.value })} className={inp + ' mt-1'} title="Tự điền theo danh mục — sửa tay được" />
                                </div>
                                <div>
                                    <label className="text-[12px] text-gray-500">Ngày vi phạm *</label>
                                    <DateInput value={modal.date} onChange={(v) => setModal({ ...modal, date: v })} className={inp + ' mt-1'} />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[12px] text-gray-500">Ghi chú</label>
                                    <input value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} className={inp + ' mt-1'} placeholder="VD: trễ 20 phút ca sáng" />
                                </div>
                            </div>
                            <div className="flex gap-2 mt-4">
                                <button onClick={() => setModal(null)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                                <button onClick={save} className="flex-1 h-11 rounded-xl bg-[#24305E] text-white text-[14px] font-semibold">Lưu</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
