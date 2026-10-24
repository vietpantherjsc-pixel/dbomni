import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';
import { useSharedCategories, labelMap } from '../../utils/sharedCategories'; // Spec danh mục dùng chung

// Spec danh mục dùng chung: fallback khi API lỗi/chưa migrate (giữ 'khac' cho dữ liệu cũ)
const TYPE_LABEL_FB = { nghi: 'Nghỉ phép', doica: 'Đổi ca', khac: 'Nghỉ khác', other: 'Khác' };
const ST_TABS = [
    ['', 'Tất cả'],
    ['pending', 'Chờ duyệt'],
    ['approved', 'Đã duyệt'],
    ['rejected', 'Đã từ chối'],
];
const ST_CLS = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-600',
};
const ST_LABEL = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã từ chối' };

// Gói 35: Xử lý yêu cầu nghỉ của nhân viên (duyệt / từ chối).
// Gói 46: thêm tab "Nghỉ theo ca" — NV xin nghỉ ca đã đăng ký qua /xin-nghi;
// quản lý duyệt → tự động gỡ ca khỏi lịch xếp; quản lý tạo trực tiếp (sát giờ).
export default function LeaveRequests() {
    const { can } = useAuth();
    // Spec danh mục dùng chung: nhãn loại nghỉ đọc từ API, fallback cứng
    const TYPE_LABEL = labelMap(useSharedCategories('leave_types', []), TYPE_LABEL_FB);
    const [mainTab, setMainTab] = useState(0);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Yêu cầu nghỉ</h1>
                </div>
                <div className="flex gap-2 mb-4">
                    <button onClick={() => setMainTab(0)} className={`px-4 py-2 rounded-lg text-[13px] font-medium border ${mainTab === 0 ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300'}`}>Nghỉ chung</button>
                    <button onClick={() => setMainTab(1)} className={`px-4 py-2 rounded-lg text-[13px] font-medium border ${mainTab === 1 ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300'}`}>Nghỉ theo ca</button>
                    <button onClick={() => setMainTab(2)} className={`px-4 py-2 rounded-lg text-[13px] font-medium border ${mainTab === 2 ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300'}`}>Đổi ca</button>
                </div>
                {mainTab === 0 ? <GeneralTab can={can} /> : mainTab === 1 ? <ShiftTab can={can} /> : <SwapTab can={can} />}
            </div>
        </AdminLayout>
    );
}

function GeneralTab({ can }) {
    const [list, setList] = useState([]);
    const [status, setStatus] = useState('pending');

    const fetchAll = useCallback(async () => {
        try {
            const r = await axios.get(API + '/leave-requests', { params: { status: status || undefined } });
            setList(r.data?.data || r.data || []);
        } catch (e) { alert(e.response?.data?.message || 'Tải danh sách yêu cầu thất bại'); }
    }, [status]);
    useEffect(() => { fetchAll(); }, [fetchAll]);

    const editable = can('staff.edit');
    const decide = async (id, ok) => {
        // Audit UX 2026-10-21 (hạng 9): DUYỆT thì làm ngay, bỏ confirm thừa; từ chối giữ confirm
        if (!ok && !window.confirm('Từ chối yêu cầu nghỉ này?')) return;
        try { await axios.post(API + '/leave-requests/' + id + (ok ? '/approve' : '/reject')); fetchAll(); }
        catch (e) { alert(e.response?.data?.message || 'Xử lý thất bại'); }
    };
    // Audit UX 2026-10-21 (hạng 9): duyệt hàng loạt các yêu cầu đang chờ đã tick chọn
    const [sel, setSel] = useState({});
    const pendingIds = list.filter((r) => r.status === 'pending').map((r) => r.id);
    const selIds = pendingIds.filter((id) => sel[id]);
    const toggleSel = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
    const toggleAll = () => {
        if (selIds.length === pendingIds.length) setSel({});
        else setSel(Object.fromEntries(pendingIds.map((id) => [id, true])));
    };
    const [bulkBusy, setBulkBusy] = useState(false);
    const approveSelected = async () => {
        if (!selIds.length || bulkBusy) return;
        if (!window.confirm(`Duyệt ${selIds.length} yêu cầu nghỉ đã chọn?`)) return;
        setBulkBusy(true);
        let fail = 0;
        for (const id of selIds) {
            try { await axios.post(API + '/leave-requests/' + id + '/approve'); } catch (e) { fail++; }
        }
        setBulkBusy(false);
        setSel({});
        fetchAll();
        if (fail) alert(`Có ${fail} yêu cầu duyệt lỗi — kiểm tra lại danh sách.`);
    };

    return (
        <>
            <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-4">
                {ST_TABS.map(([k, l]) => (
                    <button key={k} onClick={() => setStatus(k)} className={'px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px ' + (status === k ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500')}>{l}</button>
                ))}
            </div>
            {editable && pendingIds.length > 0 && (
                <div className="flex items-center gap-3 mb-3">
                    <button onClick={approveSelected} disabled={!selIds.length || bulkBusy}
                        className="px-4 py-2 rounded bg-green-600 text-white text-[13px] font-semibold disabled:opacity-40">
                        {bulkBusy ? 'Đang duyệt...' : `✓ Duyệt đã chọn (${selIds.length})`}
                    </button>
                    <span className="text-[12px] text-gray-500">Đang chờ: {pendingIds.length} yêu cầu — tick chọn ở đầu mỗi dòng.</span>
                </div>
            )}
            <div className="m-card overflow-x-auto">
                <table className="w-full text-[13px] min-w-[760px]">
                    <thead><tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                        {editable && <th className="pl-4 pr-1 py-3 font-medium w-10">
                            <input type="checkbox" className="w-4 h-4 accent-[#24305E]" title="Chọn tất cả đang chờ"
                                checked={pendingIds.length > 0 && selIds.length === pendingIds.length}
                                onChange={toggleAll} />
                        </th>}
                        <th className="px-4 py-3 font-medium">Nhân viên</th>
                        <th className="px-3 py-3 font-medium">Loại nghỉ</th>
                        <th className="px-3 py-3 font-medium">Từ – đến</th>
                        <th className="px-3 py-3 font-medium">Lý do</th>
                        <th className="px-3 py-3 font-medium text-center">Trạng thái</th>
                        {editable && <th className="px-4 py-3 font-medium text-right">Thao tác</th>}
                    </tr></thead>
                    <tbody>
                        {list.map((r) => (
                            <tr key={r.id} className="border-b border-gray-50">
                                {editable && <td className="pl-4 pr-1 py-3 w-10">
                                    {r.status === 'pending' && (
                                        <input type="checkbox" className="w-4 h-4 accent-[#24305E]"
                                            checked={!!sel[r.id]} onChange={() => toggleSel(r.id)} />
                                    )}
                                </td>}
                                <td className="px-4 py-3 font-medium">{r.employee?.full_name || '—'}</td>
                                <td className="px-3 py-3">{TYPE_LABEL[r.type] || r.type}</td>
                                <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.date_from)} → {fmtDate(r.date_to)}</td>
                                <td className="px-3 py-3 text-gray-600 max-w-[280px]">{r.reason || '—'}</td>
                                <td className="px-3 py-3 text-center">
                                    <span className={'text-[11px] px-2.5 py-1 rounded-full font-medium ' + (ST_CLS[r.status] || 'bg-gray-100 text-gray-500')}>{ST_LABEL[r.status] || r.status}</span>
                                </td>
                                {editable && <td className="px-4 py-3 text-right whitespace-nowrap">
                                    {r.status === 'pending' ? (<>
                                        <button onClick={() => decide(r.id, true)} className="px-3 py-1.5 rounded bg-green-600 text-white text-[12px] font-medium mr-2">Duyệt</button>
                                        <button onClick={() => decide(r.id, false)} className="px-3 py-1.5 rounded bg-red-500 text-white text-[12px] font-medium">Từ chối</button>
                                    </>) : <span className="text-gray-300 text-[12px]">—</span>}
                                </td>}
                            </tr>
                        ))}
                        {list.length === 0 && <tr><td colSpan={editable ? 7 : 6} className="px-4 py-8 text-center text-gray-400">Không có yêu cầu nào.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}

function ShiftTab({ can }) {
    const [list, setList] = useState([]);
    const [status, setStatus] = useState('pending');
    const [showCreate, setShowCreate] = useState(false);
    const [employees, setEmployees] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [cf, setCf] = useState({ employee_id: '', date: '', work_shift_id: '', reason: '' });

    const fetchAll = useCallback(async () => {
        try {
            const r = await axios.get(API + '/shift-leaves', { params: { status: status || undefined } });
            setList(r.data?.data || []);
        } catch (e) { alert(e.response?.data?.message || 'Tải danh sách thất bại'); }
    }, [status]);
    useEffect(() => { fetchAll(); }, [fetchAll]);
    useEffect(() => {
        axios.get(API + '/employees', { params: { per_page: 200 } }).then((r) => setEmployees(r.data?.data?.data || r.data?.data || [])).catch(() => {});
        axios.get(API + '/work-shifts').then((r) => setShifts(r.data?.data || [])).catch(() => {});
    }, []);

    const editable = can('staff.edit');
    const decide = async (id, ok) => {
        // Audit UX 2026-10-21 (hạng 9): duyệt thì làm ngay; từ chối giữ confirm
        if (!ok && !window.confirm('Từ chối yêu cầu này?')) return;
        try {
            const r = await axios.post(API + '/shift-leaves/' + id + (ok ? '/approve' : '/reject'));
            alert(r.data?.message || 'Xong');
            fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Xử lý thất bại'); }
    };
    // Audit UX 2026-10-21 (hạng 9): duyệt hàng loạt (duyệt = gỡ ca khỏi lịch xếp)
    const [sel, setSel] = useState({});
    const pendingIds = list.filter((r) => r.status === 'pending').map((r) => r.id);
    const selIds = pendingIds.filter((id) => sel[id]);
    const toggleSel = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
    const toggleAll = () => {
        if (selIds.length === pendingIds.length) setSel({});
        else setSel(Object.fromEntries(pendingIds.map((id) => [id, true])));
    };
    const [bulkBusy, setBulkBusy] = useState(false);
    const approveSelected = async () => {
        if (!selIds.length || bulkBusy) return;
        if (!window.confirm(`Duyệt ${selIds.length} yêu cầu đã chọn? Các ca tương ứng sẽ bị gỡ khỏi lịch xếp.`)) return;
        setBulkBusy(true);
        let fail = 0;
        for (const id of selIds) {
            try { await axios.post(API + '/shift-leaves/' + id + '/approve'); } catch (e) { fail++; }
        }
        setBulkBusy(false);
        setSel({});
        fetchAll();
        if (fail) alert(`Có ${fail} yêu cầu duyệt lỗi — kiểm tra lại danh sách.`);
    };
    const managerCreate = async () => {
        if (!cf.employee_id || !cf.date || !cf.work_shift_id) return alert('Chọn nhân viên, ngày và ca.');
        if (!window.confirm('Tạo yêu cầu nghỉ (duyệt luôn + gỡ ca khỏi lịch xếp)?')) return;
        try {
            const r = await axios.post(API + '/shift-leaves', { ...cf, employee_id: Number(cf.employee_id), work_shift_id: Number(cf.work_shift_id) });
            alert(r.data?.message || 'Đã tạo.');
            setShowCreate(false); setCf({ employee_id: '', date: '', work_shift_id: '', reason: '' });
            fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Tạo thất bại'); }
    };

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200">
                    {ST_TABS.map(([k, l]) => (
                        <button key={k} onClick={() => setStatus(k)} className={'px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px ' + (status === k ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500')}>{l}</button>
                    ))}
                </div>
                {editable && <button onClick={() => setShowCreate(!showCreate)} className="m-btn m-btn-primary">+ Tạo yêu cầu (quản lý)</button>}
            </div>
            <div className="text-[12px] text-gray-500 mb-3">NV tạo qua link <b>/xin-nghi</b> (chỉ trước giờ ca 48h). Quản lý duyệt → ca <b>tự động gỡ khỏi lịch xếp</b>.</div>

            {editable && pendingIds.length > 0 && (
                <div className="flex items-center gap-3 mb-3">
                    <button onClick={approveSelected} disabled={!selIds.length || bulkBusy}
                        className="px-4 py-2 rounded bg-green-600 text-white text-[13px] font-semibold disabled:opacity-40">
                        {bulkBusy ? 'Đang duyệt...' : `✓ Duyệt & gỡ ca đã chọn (${selIds.length})`}
                    </button>
                    <span className="text-[12px] text-gray-500">Đang chờ: {pendingIds.length} yêu cầu — tick chọn ở đầu mỗi dòng.</span>
                </div>
            )}

            {showCreate && (
                <div className="m-card p-4 mb-4">
                    <h3 className="font-bold text-[14px] mb-3">Tạo yêu cầu nghỉ cho NV (sát giờ — duyệt luôn)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div><label className="m-label">Nhân viên *</label>
                            <select value={cf.employee_id} onChange={(e) => setCf({ ...cf, employee_id: e.target.value })} className="m-input w-full">
                                <option value="">— Chọn —</option>
                                {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                            </select></div>
                        <div><label className="m-label">Ngày *</label>
                            <DateInput value={cf.date} onChange={(v) => setCf({ ...cf, date: v })} className="m-input w-full" /></div>
                        <div><label className="m-label">Ca *</label>
                            <select value={cf.work_shift_id} onChange={(e) => setCf({ ...cf, work_shift_id: e.target.value })} className="m-input w-full">
                                <option value="">— Chọn —</option>
                                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({(s.start_time || '').slice(0, 5)}–{(s.end_time || '').slice(0, 5)})</option>)}
                            </select></div>
                        <div><label className="m-label">Lý do</label>
                            <input value={cf.reason} onChange={(e) => setCf({ ...cf, reason: e.target.value })} className="m-input w-full" placeholder="VD: ốm đột xuất" /></div>
                    </div>
                    <div className="mt-3 flex gap-2">
                        <button onClick={managerCreate} className="m-btn m-btn-primary">Tạo & duyệt</button>
                        <button onClick={() => setShowCreate(false)} className="m-btn">Hủy</button>
                    </div>
                </div>
            )}

            <div className="m-card overflow-x-auto">
                <table className="w-full text-[13px] min-w-[820px]">
                    <thead><tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                        {editable && <th className="pl-4 pr-1 py-3 font-medium w-10">
                            <input type="checkbox" className="w-4 h-4 accent-[#24305E]" title="Chọn tất cả đang chờ"
                                checked={pendingIds.length > 0 && selIds.length === pendingIds.length}
                                onChange={toggleAll} />
                        </th>}
                        <th className="px-4 py-3 font-medium">Nhân viên</th>
                        <th className="px-3 py-3 font-medium">Ca xin nghỉ</th>
                        <th className="px-3 py-3 font-medium">Lý do</th>
                        <th className="px-3 py-3 font-medium text-center">Nguồn</th>
                        <th className="px-3 py-3 font-medium text-center">Trạng thái</th>
                        {editable && <th className="px-4 py-3 font-medium text-right">Thao tác</th>}
                    </tr></thead>
                    <tbody>
                        {list.map((r) => (
                            <tr key={r.id} className="border-b border-gray-50">
                                {editable && <td className="pl-4 pr-1 py-3 w-10">
                                    {r.status === 'pending' && (
                                        <input type="checkbox" className="w-4 h-4 accent-[#24305E]"
                                            checked={!!sel[r.id]} onChange={() => toggleSel(r.id)} />
                                    )}
                                </td>}
                                <td className="px-4 py-3 font-medium">{r.employee?.full_name || '—'}</td>
                                <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.date)} — {r.work_shift?.name} <span className="text-gray-400 text-[11px]">({(r.work_shift?.start_time || '').slice(0, 5)}–{(r.work_shift?.end_time || '').slice(0, 5)})</span></td>
                                <td className="px-3 py-3 text-gray-600 max-w-[260px]">{r.reason || '—'}</td>
                                <td className="px-3 py-3 text-center text-[11px]">{r.is_manager_created ? <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Quản lý tạo</span> : <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">NV tự tạo</span>}</td>
                                <td className="px-3 py-3 text-center">
                                    <span className={'text-[11px] px-2.5 py-1 rounded-full font-medium ' + (ST_CLS[r.status] || 'bg-gray-100 text-gray-500')}>{ST_LABEL[r.status] || r.status}</span>
                                </td>
                                {editable && <td className="px-4 py-3 text-right whitespace-nowrap">
                                    {r.status === 'pending' ? (<>
                                        <button onClick={() => decide(r.id, true)} className="px-3 py-1.5 rounded bg-green-600 text-white text-[12px] font-medium mr-2">Duyệt & gỡ ca</button>
                                        <button onClick={() => decide(r.id, false)} className="px-3 py-1.5 rounded bg-red-500 text-white text-[12px] font-medium">Từ chối</button>
                                    </>) : <span className="text-gray-300 text-[12px]">—</span>}
                                </td>}
                            </tr>
                        ))}
                        {list.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Không có yêu cầu nào.</td></tr>}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// Spec P4-B5: quản lý duyệt/từ chối yêu cầu đổi ca (đã qua B xác nhận → duyệt là hoán đổi)
function SwapTab({ can }) {
    const [list, setList] = useState([]);
    const editable = can('staff.edit');
    const fetchAll = useCallback(async () => {
        try {
            const r = await axios.get(API + '/shift-swaps');
            setList(r.data?.data || []);
        } catch (e) { alert(e.response?.data?.message || 'Tải danh sách thất bại'); }
    }, []);
    useEffect(() => { fetchAll(); }, [fetchAll]);
    const decide = async (id, ok) => {
        // Audit UX 2026-10-21 (hạng 9): duyệt thì làm ngay; từ chối giữ confirm
        if (!ok && !window.confirm('Từ chối yêu cầu đổi ca này?')) return;
        try {
            const r = await axios.post(API + '/shift-swaps/' + id + (ok ? '/approve' : '/reject'));
            alert(r.data?.message || 'Xong');
            fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Xử lý thất bại'); }
    };
    // Audit UX 2026-10-21 (hạng 9): duyệt hàng loạt yêu cầu đổi ca đã tick chọn
    const [sel, setSel] = useState({});
    const selIds = list.map((r) => r.id).filter((id) => sel[id]);
    const toggleSel = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
    const toggleAll = () => {
        if (selIds.length === list.length) setSel({});
        else setSel(Object.fromEntries(list.map((r) => [r.id, true])));
    };
    const [bulkBusy, setBulkBusy] = useState(false);
    const approveSelected = async () => {
        if (!selIds.length || bulkBusy) return;
        if (!window.confirm(`Duyệt & hoán đổi ca cho ${selIds.length} yêu cầu đã chọn?`)) return;
        setBulkBusy(true);
        let fail = 0;
        for (const id of selIds) {
            try { await axios.post(API + '/shift-swaps/' + id + '/approve'); } catch (e) { fail++; }
        }
        setBulkBusy(false);
        setSel({});
        fetchAll();
        if (fail) alert(`Có ${fail} yêu cầu duyệt lỗi — kiểm tra lại danh sách.`);
    };
    const fmtT = (t) => t ? String(t).slice(0, 5) : '';
    return (
        <>
            {editable && list.length > 0 && (
                <div className="flex items-center gap-3 mb-3">
                    <button onClick={approveSelected} disabled={!selIds.length || bulkBusy}
                        className="px-4 py-2 rounded bg-green-600 text-white text-[13px] font-semibold disabled:opacity-40">
                        {bulkBusy ? 'Đang duyệt...' : `✓ Duyệt & hoán đổi đã chọn (${selIds.length})`}
                    </button>
                    <span className="text-[12px] text-gray-500">Tick chọn ở đầu mỗi dòng để duyệt nhiều yêu cầu cùng lúc.</span>
                </div>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
                <table className="w-full text-[13px] min-w-[760px]">
                    <thead><tr className="bg-gray-50 text-left text-gray-500">
                        {editable && <th className="pl-4 pr-1 py-2 font-medium w-10">
                            <input type="checkbox" className="w-4 h-4 accent-[#24305E]" title="Chọn tất cả"
                                checked={list.length > 0 && selIds.length === list.length}
                                onChange={toggleAll} />
                        </th>}
                        <th className="px-4 py-2 font-medium">NV A</th>
                        <th className="px-4 py-2 font-medium">Ca của A</th>
                        <th className="px-4 py-2 font-medium">NV B</th>
                        <th className="px-4 py-2 font-medium">Ca của B</th>
                        <th className="px-4 py-2 font-medium">B xác nhận</th>
                        {editable && <th className="px-4 py-2 font-medium text-right">Duyệt</th>}
                    </tr></thead>
                    <tbody>
                        {list.map((r) => (
                            <tr key={r.id} className="border-t border-gray-100">
                                {editable && <td className="pl-4 pr-1 py-3 w-10">
                                    <input type="checkbox" className="w-4 h-4 accent-[#24305E]"
                                        checked={!!sel[r.id]} onChange={() => toggleSel(r.id)} />
                                </td>}
                                <td className="px-4 py-3 font-medium">{r.requester?.full_name}</td>
                                <td className="px-4 py-3">{r.requester_schedule?.work_shift?.name} ({fmtT(r.requester_schedule?.work_shift?.start_time)}–{fmtT(r.requester_schedule?.work_shift?.end_time)})</td>
                                <td className="px-4 py-3 font-medium">{r.target?.full_name}</td>
                                <td className="px-4 py-3">{r.target_schedule?.work_shift?.name} ({fmtT(r.target_schedule?.work_shift?.start_time)}–{fmtT(r.target_schedule?.work_shift?.end_time)})</td>
                                <td className="px-4 py-3 text-green-600">✓ {r.target_confirmed_at?.slice(0, 16).replace('T', ' ')}</td>
                                {editable && <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button onClick={() => decide(r.id, true)} className="px-3 py-1.5 rounded bg-green-600 text-white text-[12px] font-medium mr-2">Duyệt & hoán đổi</button>
                                    <button onClick={() => decide(r.id, false)} className="px-3 py-1.5 rounded bg-red-500 text-white text-[12px] font-medium">Từ chối</button>
                                </td>}
                            </tr>
                        ))}
                        {list.length === 0 && <tr><td colSpan={editable ? 7 : 6} className="px-4 py-8 text-center text-gray-400">Không có yêu cầu nào chờ duyệt.</td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="text-[12px] text-gray-400 mt-2">Luồng: NV A tạo yêu cầu → NV B xác nhận (qua trang Xin nghỉ) → quản lý duyệt tại đây → hệ thống hoán đổi ca của 2 NV.</p>
        </>
    );
}
