import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate } from '../../utils/format';

const API = 'http://localhost/api';
const TYPE_LABEL = { annual: 'Nghỉ phép', sick: 'Nghỉ ốm', unpaid: 'Nghỉ không lương', maternity: 'Nghỉ thai sản', other: 'Nghỉ khác' };
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
export default function LeaveRequests() {
    const { can } = useAuth();
    const [list, setList] = useState([]);
    const [status, setStatus] = useState('pending');

    const fetchAll = useCallback(async () => {
        try {
            const r = await axios.get(API + '/leave-requests', { params: { status: status || undefined } });
            setList(r.data?.data || r.data || []);
        } catch (e) { alert(e.response?.data?.message || 'Tải danh sách yêu cầu thất bại'); }
    }, [status]);
    useEffect(() => { fetchAll(); }, [fetchAll]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);
    const editable = can('staff.edit');
    const decide = async (id, ok) => {
        if (!window.confirm(ok ? 'Duyệt yêu cầu nghỉ này?' : 'Từ chối yêu cầu nghỉ này?')) return;
        try { await axios.post(API + '/leave-requests/' + id + (ok ? '/approve' : '/reject')); fetchAll(); }
        catch (e) { alert(e.response?.data?.message || 'Xử lý thất bại'); }
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Yêu cầu nghỉ</h1>
                </div>
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
            </div>
        </AdminLayout>
    );
}
