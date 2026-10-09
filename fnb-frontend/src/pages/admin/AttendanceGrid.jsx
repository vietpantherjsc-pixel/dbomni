import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate, startOfWeek } from '../../utils/format';
import DateInput from '../../components/DateInput';

const API = 'http://localhost/api';
const WD = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
const STATUS = {
    present: { label: 'Có mặt', cls: 'bg-green-100 text-green-800' },
    partial: { label: 'Thiếu giờ', cls: 'bg-yellow-100 text-yellow-800' },
    absent: { label: 'Vắng mặt', cls: 'bg-gray-200 text-gray-500' },
    leave: { label: 'Nghỉ phép', cls: 'bg-gray-200 text-gray-500' },
};
const mondayOf = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; };
const fmtD = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ddMM = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';

// Gói 35: Bảng chấm công theo tuần — lưới NV × ngày, ô tô màu theo trạng thái, bấm xem chi tiết giờ.
export default function AttendanceGrid() {
    const { can } = useAuth();
    const [week, setWeek] = useState(() => fmtD(mondayOf(new Date())));
    const [branchId, setBranchId] = useState('');
    const [branches, setBranches] = useState([]);
    const [data, setData] = useState({ days: [], rows: [] });
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState(null); // {name, date, info}

    const fetchBranches = useCallback(async () => {
        const b = await axios.get(API + '/branches');
        setBranches(b.data?.data || b.data || []);
    }, []);
    useEffect(() => { fetchBranches(); }, [fetchBranches]);

    const fetchGrid = useCallback(async () => {
        setLoading(true);
        try {
            const r = await axios.get(API + '/attendances/grid', { params: { week, branch_id: branchId || undefined } });
            setData(r.data?.data || { days: [], rows: [] });
        } catch (e) { alert(e.response?.data?.message || 'Tải bảng chấm công thất bại'); }
        setLoading(false);
    }, [week, branchId]);
    useEffect(() => { fetchGrid(); }, [fetchGrid]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);

    const days = data.days?.length ? data.days : [];
    const shiftWeek = (delta) => { const m = mondayOf(week); m.setDate(m.getDate() + delta * 7); setWeek(fmtD(m)); };
    const tip = (info) => [info.check_in ? 'Vào: ' + info.check_in : '', info.check_out ? 'Ra: ' + info.check_out : '',
        info.hours != null ? 'Số giờ: ' + info.hours : '', info.scheduled_hours != null ? 'Giờ theo lịch: ' + info.scheduled_hours : '']
        .filter(Boolean).join('\n');

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Bảng chấm công</h1>
                    <button onClick={() => shiftWeek(-1)} className="px-3 py-2 rounded border border-gray-300 text-[13px]">‹ Tuần trước</button>
                    <DateInput value={week} onChange={(v) => v && setWeek(startOfWeek(v))} className="border border-gray-300 rounded px-3 py-2 text-[13px]" title="Chọn ngày bất kỳ — tự lấy về Thứ 2 tuần đó" />
                    <button onClick={() => shiftWeek(1)} className="px-3 py-2 rounded border border-gray-300 text-[13px]">Tuần sau ›</button>
                    <button onClick={() => setWeek(fmtD(mondayOf(new Date())))} className="px-3 py-2 rounded border border-gray-300 text-[13px]">Tuần này</button>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                </div>

                <div className="flex flex-wrap gap-2 mb-3 text-[12px]">
                    {Object.entries(STATUS).map(([k, v]) => (
                        <span key={k} className={'px-2.5 py-1 rounded-full font-medium ' + v.cls}>{v.label}{k === 'leave' ? ' (ghi N)' : ''}</span>
                    ))}
                </div>

                {loading ? <div className="text-gray-500 text-sm py-10 text-center">Đang tải...</div> : (
                    <div className="m-card overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[820px] border-collapse">
                            <thead><tr className="text-left bg-gray-50">
                                <th className="px-3 py-3 font-medium text-gray-500 border-b border-gray-200 min-w-[160px] sticky left-0 bg-gray-50">Nhân viên</th>
                                {days.map((d, i) => (
                                    <th key={d} className="px-2 py-3 font-medium text-gray-500 border-b border-gray-200 text-center min-w-[92px]">
                                        <div>{WD[i]}</div><div className="font-normal text-[11px]">{ddMM(d)}</div>
                                    </th>
                                ))}
                            </tr></thead>
                            <tbody>
                                {(data.rows || []).map((r) => (
                                    <tr key={r.id} className="border-b border-gray-50">
                                        <td className="px-3 py-2 font-medium sticky left-0 bg-white">{r.full_name}</td>
                                        {days.map((d) => {
                                            const info = r.days?.[d];
                                            const st = STATUS[info?.status] || STATUS.absent;
                                            return (
                                                <td key={d} className="px-1.5 py-1 text-center">
                                                    <button title={info ? tip(info) : 'Chưa có dữ liệu chấm công'}
                                                        onClick={() => info && setDetail({ name: r.full_name, date: d, info })}
                                                        className={'w-full rounded px-1 py-1.5 text-[11px] font-medium leading-tight ' + (info ? st.cls : 'bg-gray-50 text-gray-300')}>
                                                        {info ? (info.status === 'leave' ? 'N' : st.label) : '—'}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                                {(data.rows || []).length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Chưa có dữ liệu tuần này.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="text-[12px] text-gray-400 mt-2">Bấm vào ô đã chấm để xem chi tiết giờ vào – ra và số giờ.</p>

                {detail && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
                        <div className="bg-white rounded-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
                            <h2 className="font-bold text-[16px] mb-1">{detail.name}</h2>
                            <p className="text-[12px] text-gray-500 mb-4">{WD[days.indexOf(detail.date)] || ''} · {fmtDate(detail.date)}</p>
                            <div className="text-[13px] space-y-2">
                                <div className="flex justify-between"><span className="text-gray-500">Trạng thái</span><span className={'px-2 py-0.5 rounded-full font-medium ' + (STATUS[detail.info.status]?.cls || '')}>{STATUS[detail.info.status]?.label}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Giờ vào</span><span className="font-mono">{detail.info.check_in || '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Giờ ra</span><span className="font-mono">{detail.info.check_out || '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Số giờ thực tế</span><span className="font-medium">{detail.info.hours ?? '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Giờ theo lịch</span><span>{detail.info.scheduled_hours ?? '—'}</span></div>
                            </div>
                            <div className="flex justify-end mt-5">
                                <button onClick={() => setDetail(null)} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium">Đóng</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
