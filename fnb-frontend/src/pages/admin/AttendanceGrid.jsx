import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { fmtDate, fmtTime, startOfWeek } from '../../utils/format';
import DateInput from '../../components/DateInput';
import TimeInput, { valid24 } from '../../components/TimeInput';
import { API } from '../../utils/api';

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
// Gói 40: so sánh HH:MM theo phút — đi trễ = check_in > scheduled_start + 5 phút
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const isLate = (info) => {
    const ci = toMin(fmtTime(info.check_in));
    const ss = toMin(info.scheduled_start);
    return ci != null && ss != null && ci > ss + 5;
};

// Gói 35: Bảng chấm công theo tuần — lưới NV × ngày, ô tô màu theo trạng thái, bấm xem chi tiết giờ.
export default function AttendanceGrid() {
    const { can } = useAuth();
    const [week, setWeek] = useState(() => fmtD(mondayOf(new Date())));
    // C3 (2026-10-21): bộ lọc CN = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều với
    // dropdown sidebar (đổi trong trang = đổi trạng thái chung). '' tại trang này = '0' (Tất cả) ở context.
    const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
    const branchId = ctxBranchId === '0' ? '' : ctxBranchId;
    const setBranchId = (v) => setCtxBranchId(v === '' || v === null || v === undefined ? '0' : String(v));
    const [branches, setBranches] = useState([]);
    const [data, setData] = useState({ days: [], rows: [] });
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState(null); // {name, date, info}
    // Bổ sung Mảng 4 (A3-7): sửa giờ chấm công có ghi vết lý do (PATCH /attendances/{id}/times)
    const [editT, setEditT] = useState(null); // {id, name, date, checkIn, checkOut, reason, pairCount}
    const [savingT, setSavingT] = useState(false);
    const saveTimes = async () => {
        if (!editT) return;
        if (editT.checkIn && !valid24(editT.checkIn)) return alert('Giờ vào chưa đúng định dạng HH:MM (24h)');
        if (editT.checkOut && !valid24(editT.checkOut)) return alert('Giờ ra chưa đúng định dạng HH:MM (24h)');
        if (!editT.checkIn && !editT.checkOut) return alert('Nhập ít nhất giờ vào hoặc giờ ra mới');
        if (!editT.reason.trim()) return alert('Bắt buộc nhập lý do sửa giờ');
        setSavingT(true);
        try {
            await axios.patch(API + '/attendances/' + editT.id + '/times', {
                check_in: editT.checkIn ? editT.date + ' ' + editT.checkIn + ':00' : null,
                check_out: editT.checkOut ? editT.date + ' ' + editT.checkOut + ':00' : null,
                reason: editT.reason.trim(),
            });
            setEditT(null); setDetail(null); fetchGrid();
        } catch (e) { alert(e.response?.data?.message || 'Sửa giờ thất bại'); }
        setSavingT(false);
    };
    // Gói 46: thống kê ca theo tháng cho cột "Tổng số ca"
    const [shiftStats, setShiftStats] = useState({});

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

    // Gói 46: tải thống kê ca tháng (theo tháng của tuần đang xem)
    useEffect(() => {
        const month = week.slice(0, 7);
        axios.get(API + '/attendances/shift-stats', { params: { month, branch_id: branchId || undefined } })
            .then((r) => {
                const m = {};
                (r.data?.data || []).forEach((s) => { m[s.employee_id] = s; });
                setShiftStats(m);
            })
            .catch(() => {});
    }, [week, branchId]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);

    const days = data.days?.length ? data.days : [];
    const shiftWeek = (delta) => { const m = mondayOf(week); m.setDate(m.getDate() + delta * 7); setWeek(fmtD(m)); };
    const tip = (info) => [info.check_in ? 'Vào: ' + fmtTime(info.check_in) : '', info.check_out ? 'Ra: ' + fmtTime(info.check_out) : '',
        info.hours != null ? 'Số giờ: ' + info.hours : '', info.scheduled_hours != null ? 'Giờ theo lịch: ' + info.scheduled_hours : '',
        info.is_late ? '⚠ Đi muộn' : '', info.is_early_leave ? '⏰ Về sớm' : '', info.outside_shift ? '❓ Chấm ngoài ca' : '']
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

                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[12px] items-center">
                    <span><span className="font-bold font-mono text-red-600">07:21 ⚠</span> <span className="text-gray-500">= đi trễ quá 5 phút so với giờ ca</span></span>
                    <span><span className="italic text-gray-400">Nghỉ phép</span> <span className="text-gray-500">= nghỉ đã duyệt</span></span>
                    <span><span className="text-gray-300">—</span> <span className="text-gray-500">= chưa có dữ liệu</span></span>
                </div>

                {loading ? <div className="text-gray-500 text-sm py-10 text-center">Đang tải...</div> : (
                    <div className="m-card overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[820px] border-collapse">
                            <thead><tr className="text-left bg-gray-50">
                                <th className="px-3 py-3 font-medium text-gray-500 border-b border-gray-200 min-w-[160px] sticky left-0 bg-gray-50">Nhân viên</th>
                                <th className="px-3 py-3 font-medium text-gray-500 border-b border-gray-200 text-center min-w-[90px]" title="Số ca đã duyệt + đã xếp / tổng ca đã đăng ký trong tháng">Tổng số ca</th>
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
                                        <td className="px-3 py-2 text-center">
                                            {(() => {
                                                const s = shiftStats[r.id];
                                                if (!s || !s.registered) return <span className="text-gray-300">—</span>;
                                                const ratio = s.done / s.registered;
                                                const cls = ratio >= 1 ? 'bg-green-100 text-green-800' : ratio >= 0.7 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700';
                                                return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${cls}`}>{s.done}/{s.registered}</span>;
                                            })()}
                                        </td>
                                        {days.map((d) => {
                                            const info = r.days?.[d];
                                            // Spec P4-B4: ưu tiên cờ backend (đã tính grace period cấu hình được)
                                            const late = !!(info && (info.is_late ?? isLate(info)));
                                            const early = !!(info && info.is_early_leave);
                                            const outside = !!(info && info.outside_shift);
                                            const hasTime = !!(info && (info.check_in || info.check_out));
                                            return (
                                                <td key={d} className="px-1.5 py-1 text-center">
                                                    <button title={info ? tip(info) : 'Chưa có dữ liệu chấm công'}
                                                        onClick={() => info && setDetail({ name: r.full_name, date: d, info })}
                                                        className={'w-full rounded px-1 py-1.5 text-[11px] leading-tight ' + (info ? 'hover:bg-gray-100' : '')}>
                                                        {info && info.status === 'leave' ? (
                                                            <span className="italic text-gray-400">Nghỉ phép</span>
                                                        ) : hasTime ? (
                                                            <span className="block">
                                                                <span className={'block font-bold font-mono ' + (late ? 'text-red-600' : 'text-gray-800')}>{fmtTime(info.check_in) || '—'}{late ? ' ⚠' : ''}{outside ? ' ❓' : ''}</span>
                                                                <span className={'block font-mono ' + (early ? 'text-orange-500 font-bold' : 'text-gray-400')}>{fmtTime(info.check_out) || '—'}{early ? ' ⏰' : ''}</span>
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-300">—</span>
                                                        )}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                                {(data.rows || []).length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Chưa có dữ liệu tuần này.</td></tr>}
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
                                <div className="flex justify-between"><span className="text-gray-500">Giờ vào</span><span className="font-mono">{fmtTime(detail.info.check_in) || '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Giờ ra</span><span className="font-mono">{fmtTime(detail.info.check_out) || '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Số giờ thực tế</span><span className="font-medium">{detail.info.hours ?? '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Giờ theo lịch</span><span>{detail.info.scheduled_hours ?? '—'}</span></div>
                            </div>
                            <div className="flex justify-end gap-2 mt-5">
                                {can('staff.edit') && detail.info.attendance_id ? (
                                    <button onClick={() => setEditT({ id: detail.info.attendance_id, name: detail.name, date: detail.date, checkIn: fmtTime(detail.info.check_in) || '', checkOut: fmtTime(detail.info.check_out) || '', reason: '', pairCount: detail.info.pair_count || 1 })} className="px-4 py-2 rounded border border-[#24305E] text-[#24305E] text-[13px] font-medium">Sửa giờ</button>
                                ) : null}
                                <button onClick={() => setDetail(null)} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium">Đóng</button>
                            </div>
                        </div>
                    </div>
                )}
                {editT && (
                    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !savingT && setEditT(null)}>
                        <div className="bg-white rounded-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
                            <h2 className="font-bold text-[16px] mb-1">Sửa giờ chấm công</h2>
                            <p className="text-[12px] text-gray-500 mb-4">{editT.name} · {fmtDate(editT.date)}</p>
                            {editT.pairCount > 1 && <p className="text-[12px] text-amber-600 mb-3">Ngày này có {editT.pairCount} cặp chấm công — đang sửa cặp chấm đầu tiên.</p>}
                            <div className="space-y-3 text-[13px]">
                                <div className="flex items-center justify-between gap-3">
                                    <label className="text-gray-500">Giờ vào mới</label>
                                    <TimeInput value={editT.checkIn} onChange={(v) => setEditT({ ...editT, checkIn: v })} className="border border-gray-300 rounded px-3 py-2 w-28 text-center font-mono" />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <label className="text-gray-500">Giờ ra mới</label>
                                    <TimeInput value={editT.checkOut} onChange={(v) => setEditT({ ...editT, checkOut: v })} className="border border-gray-300 rounded px-3 py-2 w-28 text-center font-mono" />
                                </div>
                                <div>
                                    <label className="text-gray-500 block mb-1">Lý do sửa <span className="text-red-500">*</span></label>
                                    <textarea value={editT.reason} onChange={(e) => setEditT({ ...editT, reason: e.target.value })} rows={2} className="border border-gray-300 rounded px-3 py-2 w-full" placeholder="VD: NV quên chấm ra, xác nhận qua camera" />
                                </div>
                                <p className="text-[11px] text-gray-400">Mọi lần sửa đều được ghi vết (người sửa, giờ cũ/mới, lý do). Để trống cả 2 ô giờ = không đổi.</p>
                            </div>
                            <div className="flex justify-end gap-2 mt-5">
                                <button onClick={() => setEditT(null)} disabled={savingT} className="px-4 py-2 rounded border border-gray-300 text-[13px]">Hủy</button>
                                <button onClick={saveTimes} disabled={savingT} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-medium disabled:opacity-50">{savingT ? 'Đang lưu...' : 'Lưu giờ mới'}</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
