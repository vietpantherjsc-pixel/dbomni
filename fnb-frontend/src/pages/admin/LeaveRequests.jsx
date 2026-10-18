import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';

// NV-R1: thống nhất code loại nghỉ với backend (nghi/doica/khac)
const TYPE_LABEL = { nghi: 'Nghỉ phép', doica: 'Đổi ca', khac: 'Nghỉ khác' };
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
                </div>
                {mainTab === 0 ? <GeneralTab can={can} /> : <ShiftTab can={can} />}
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
        if (!window.confirm(ok ? 'Duyệt yêu cầu nghỉ này?' : 'Từ chối yêu cầu nghỉ này?')) return;
        try { await axios.post(API + '/leave-requests/' + id + (ok ? '/approve' : '/reject')); fetchAll(); }
        catch (e) { alert(e.response?.data?.message || 'Xử lý thất bại'); }
    };

    return (
        <>
            <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-4">
                {ST_TABS.map(([k, l]) => (
                    <button key={k} onClick={() => setStatus(k)} className={'px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px ' + (status === k ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500')}>{l}</button>
                ))}
            </div>
            <div className="m-card overflow-x-auto">
                <table className="w-full text-[13px] min-w-[760px]">
                    <thead><tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
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
                        {list.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Không có yêu cầu nào.</td></tr>}
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
        if (!window.confirm(ok ? 'Duyệt & gỡ ca này khỏi lịch xếp?' : 'Từ chối yêu cầu này?')) return;
        try {
            const r = await axios.post(API + '/shift-leaves/' + id + (ok ? '/approve' : '/reject'));
            alert(r.data?.message || 'Xong');
            fetchAll();
        } catch (e) { alert(e.response?.data?.message || 'Xử lý thất bại'); }
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
