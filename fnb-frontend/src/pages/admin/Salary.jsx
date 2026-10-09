import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate, fmtTime } from '../../utils/format';
import DateInput from '../../components/DateInput';

const API = 'http://localhost/api';
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n || 0));
const fmtH = (n) => (Math.round((n || 0) * 100) / 100).toString();
const slug = (s) => (s || 'nv').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

// ---------- Xuất ảnh PNG bảng lương bằng canvas thuần (khớp mẫu Excel) ----------
function exportPayslipPNG(payroll) {
    const s = payroll.summary, ins = payroll.insurance;
    const scale = 2, cw = [112, 92, 92, 112, 152], W = cw.reduce((a, b) => a + b, 0), rh = 27;
    const xs = [0]; cw.forEach((w) => xs.push(xs[xs.length - 1] + w));
    const rows = [];
    const R = (cells, bg) => rows.push({ cells, bg });
    const C = (t, cs = 1, o = {}) => ({ t: String(t ?? ''), cs, ...o });

    R([C(payroll.month_label, 2, { bold: true }), C('Nhân viên: ' + (payroll.employee.full_name || '').toUpperCase(), 3, { bold: true })], '#d9d9d9');
    R(['Ngày', 'Giờ vào', 'Giờ ra', 'Tổng số giờ', 'Phụ cấp tiền ăn'].map((t) => C(t, 1, { bold: true, align: 'center' })), '#d9d9d9');
    payroll.days.forEach((d) => {
        R([C(fmtDate(d.date) + (d.is_holiday ? ' (x' + d.multiplier + ')' : ''), 1, { align: 'center' }), C(fmtTime(d.check_in) || '', 1, { align: 'center' }), C(fmtTime(d.check_out) || '', 1, { align: 'center' }),
           C(d.hours ? fmtH(d.hours) : '0.00', 1, { align: 'center' }),
           C(d.meal_count > 1 ? 'X' + d.meal_count : (d.meal_count ? 'X' : ''), 1, { align: 'center' })]);
    });
    const sum = (label, val, bold, bg) => R([C(label, 3, { bold }), C(val, 1, { bold, align: 'center' }), C('', 1)], bg);
    sum('A. TỔNG GIỜ CÔNG', fmtH(s.total_hours), true);
    sum('1. ' + (s.line1_note || 'Các khoản trừ khác'), s.line1_deduction ? fmt(s.line1_deduction) : '');
    if (s.violations > 0) sum('Số lỗi vi phạm' + (s.violation_note ? ' (' + s.violation_note + ')' : ''), s.violations + ' lỗi');
    sum('2. Lương trách nhiệm (' + s.resp_formula + ')', fmt(s.line2_responsibility) + '/h');
    sum('3. Lương cơ bản/h', fmt(s.line3_base_rate));
    sum('4. Mức lương/h (2 + 3)', fmt(s.line4_rate), true);
    sum('B. LƯƠNG', fmt(s.gross), true);
    if (s.meal_total) sum('Phụ cấp tiền ăn (' + fmt(s.meal_price) + 'đ × ' + (s.meal_count_total || 0) + ' suất)', fmt(s.meal_total));
    if (s.holiday_extra) sum('Lương lễ/tết', (s.holiday_days || []).map((h) => ((h.date ? fmtDate(h.date) + ' ' : '') + '(x' + h.multiplier + '): +' + fmt(h.extra) + 'đ')).join('; '));
    if (s.bonus_total) sum('Thưởng', fmt(s.bonus_total));
    if (s.advance_total) sum('Ứng lương (trừ)', fmt(s.advance_total));
    if (s.line1_deduction) { /* đã hiện ở dòng 1 */ }
    sum('C. THỰC NHẬN', fmt(s.net), true, '#c6efce');
    if (ins) {
        R([C('D. BHXH (Mức đóng ' + fmt(ins.base_amount) + ')' + (ins.employer_pays_all ? ' (Công ty chi trả)' : ''), 5, { bold: true })]);
        R([C('', 3), C('NLĐ Đóng (' + ins.employee_rate + '%)', 1, { bold: true, align: 'center' }), C('DN Đóng (' + ins.employer_rate + '%)', 1, { bold: true, align: 'center' })]);
        R([C('', 3), C(fmt(ins.employee_total), 1, { bold: true, align: 'center' }), C(fmt(ins.employer_total), 1, { bold: true, align: 'center' })]);
        ins.details.forEach((dt) => R([C(dt.label, 3), C(fmt(dt.amount), 1, { align: 'center' }), C('', 1)]));
    }

    const H = rows.length * rh + 2;
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.font = '13px Arial, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';

    rows.forEach((row, ri) => {
        const y = 1 + ri * rh;
        if (row.bg) { ctx.fillStyle = row.bg; ctx.fillRect(1, y, W - 2, rh); }
        // Kẻ lưới THEO ĐÚNG biên ô của dòng này (tôn trọng ô gộp cs>1) — trước khi vẽ chữ
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
        let bi = 0;
        const bounds = [];
        row.cells.forEach((cell) => {
            const x = xs[bi], w = xs[bi + cell.cs] - x;
            bounds.push([x, w]);
            const lx = bi === 0 ? 1 : x; // trùng viền ngoài
            ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, y + rh); ctx.stroke();
            bi += cell.cs;
        });
        ctx.beginPath(); ctx.moveTo(W - 1, y); ctx.lineTo(W - 1, y + rh); ctx.stroke(); // biên phải dòng
        ctx.beginPath(); ctx.moveTo(1, y + rh); ctx.lineTo(W - 1, y + rh); ctx.stroke(); // kẻ ngang
        // Vẽ chữ sau cùng + cắt (clip) trong ô để không tràn sang ô bên
        row.cells.forEach((cell, idx) => {
            const [x, w] = bounds[idx];
            ctx.save();
            ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, rh - 4); ctx.clip();
            ctx.font = (cell.bold ? 'bold ' : '') + '13px Arial, "Segoe UI", sans-serif';
            ctx.fillStyle = '#000';
            const tx = cell.align === 'center' ? x + w / 2 : x + 7;
            ctx.textAlign = cell.align === 'center' ? 'center' : 'left';
            ctx.fillText(cell.t, tx, y + rh / 2 + 0.5);
            ctx.restore();
        });
    });
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const a = document.createElement('a');
    a.download = 'bang-luong-' + slug(payroll.employee.full_name) + '-' + payroll.month + '.png';
    a.href = cv.toDataURL('image/png');
    a.click();
}

// Gói 26: Bảng lương theo giờ (đúng mẫu Excel của Đại Vương).
export default function Salary() {
    const { can } = useAuth();
    const [employees, setEmployees] = useState([]);
    const [empId, setEmpId] = useState('');
    const [month, setMonth] = useState(() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); });
    const [payroll, setPayroll] = useState(null);
    const [tab, setTab] = useState('sheet');
    const [loading, setLoading] = useState(false);
    const [hist, setHist] = useState(null);
    const [days, setDays] = useState([]);
    const [mealCfg, setMealCfg] = useState({ meal_min_hours: 14.5, meal_price: 30000 }); // Gói 30d
    const [insForm, setInsForm] = useState({ base_amount: '', employer_pays_all: false });
    const [recForm, setRecForm] = useState({ other_deduction: 0, other_deduction_note: '', note: '' });
    const [violForm, setViolForm] = useState({ violation_count: 0, violation_note: '' });
    const [wlForm, setWlForm] = useState({ hourly_rate: '', start_date: '', note: '' });
    const [advForm, setAdvForm] = useState({ amount: '', date: '', note: '' });
    const [bonusForm, setBonusForm] = useState({ type: 'performance', amount: '', date: '', note: '' });

    const fetchEmployees = useCallback(async () => {
        const res = await axios.get(API + '/employees', { params: { is_active: 1, per_page: 100 } });
        const list = res.data?.data?.data || res.data?.data || [];
        setEmployees(list);
        if (!empId && list.length) setEmpId(String(list[0].id));
    }, [empId]);

    const fetchPayroll = useCallback(async () => {
        if (!empId) return;
        setLoading(true);
        try {
            const res = await axios.get(API + '/salary/' + empId, { params: { month } });
            if (res.data?.success) {
                setPayroll(res.data.data);
                const r = res.data.data.record;
                setRecForm({ other_deduction: r?.other_deduction ?? 0, other_deduction_note: r?.other_deduction_note ?? '', note: r?.note ?? '' });
                setViolForm({ violation_count: r?.violation_count ?? 0, violation_note: r?.violation_note ?? '' });
            }
            const h = await axios.get(API + '/salary/' + empId + '/history');
            if (h.data?.success) setHist(h.data.data);
            const d = await axios.get(API + '/salary/' + empId + '/days', { params: { month } });
            if (d.data?.success) { setDays(d.data.data); if (d.data.meta) setMealCfg(d.data.meta); }
            const ins = await axios.get(API + '/employees/' + empId + '/insurance');
            if (ins.data?.success && ins.data.data) setInsForm({ base_amount: ins.data.data.base_amount, employer_pays_all: !!ins.data.data.employer_pays_all });
            else setInsForm({ base_amount: '', employer_pays_all: false });
        } catch (e) { alert(e.response?.data?.message || 'Tải bảng lương thất bại'); }
        setLoading(false);
    }, [empId, month]);

    useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
    useEffect(() => { fetchPayroll(); }, [fetchPayroll]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Nhân viên.</div></AdminLayout>);
    const editable = can('staff.edit');
    const s = payroll?.summary, ins = payroll?.insurance;
    const inp = 'border border-gray-300 rounded px-2 py-1.5 text-[13px] w-full';
    const btn = 'px-3 py-1.5 rounded text-[13px] font-medium ';

    const saveDays = async () => {
        try {
            await axios.post(API + '/salary/' + empId + '/days', { days: days.map((d) => ({ date: d.date, check_in: d.check_in || null, check_out: d.check_out || null, hours: Number(d.hours) || 0, meal_count: Number(d.meal_count) || 0, meal_manual: !!d.meal_manual })) });
            alert('Đã lưu chi tiết ngày công.'); fetchPayroll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const saveRecordExtra = async () => {
        try {
            await axios.put(API + '/salary/' + empId + '/violations', { month, violation_count: Number(violForm.violation_count) || 0, violation_note: violForm.violation_note || null });
            await axios.post(API + '/salary/' + empId + '/record', { month, hours: s?.total_hours || 0, work_days: 0, other_deduction: Number(recForm.other_deduction) || 0, other_deduction_note: recForm.other_deduction_note || null, note: recForm.note || null });
            alert('Đã lưu.'); fetchPayroll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const addWage = async () => {
        if (!wlForm.hourly_rate || !wlForm.start_date) return alert('Nhập đơn giá giờ và ngày áp dụng');
        try {
            await axios.post(API + '/salary/' + empId + '/wage-levels', { hourly_rate: Number(wlForm.hourly_rate), start_date: wlForm.start_date, note: wlForm.note || null });
            setWlForm({ hourly_rate: '', start_date: '', note: '' }); fetchPayroll();
        } catch (e) { alert(e.response?.data?.message || 'Thêm thất bại'); }
    };
    const addAdv = async () => {
        if (!advForm.amount || !advForm.date) return alert('Nhập số tiền và ngày ứng');
        try { await axios.post(API + '/salary/' + empId + '/advances', { amount: Number(advForm.amount), date: advForm.date, note: advForm.note || null }); setAdvForm({ amount: '', date: '', note: '' }); fetchPayroll(); }
        catch (e) { alert(e.response?.data?.message || 'Thêm thất bại'); }
    };
    const addBonus = async () => {
        if (!bonusForm.amount || !bonusForm.date) return alert('Nhập số tiền và ngày thưởng');
        try { await axios.post(API + '/salary/' + empId + '/bonuses', { type: bonusForm.type, amount: Number(bonusForm.amount), date: bonusForm.date, note: bonusForm.note || null }); setBonusForm({ type: 'performance', amount: '', date: '', note: '' }); fetchPayroll(); }
        catch (e) { alert(e.response?.data?.message || 'Thêm thất bại'); }
    };
    const saveInsurance = async () => {
        if (!insForm.base_amount) return alert('Nhập mức lương đóng BHXH');
        try { await axios.post(API + '/employees/' + empId + '/insurance', { base_amount: Number(insForm.base_amount), employer_pays_all: !!insForm.employer_pays_all }); alert('Đã lưu cấu hình BHXH.'); fetchPayroll(); }
        catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    const del = async (url, msg) => { if (!window.confirm(msg || 'Xóa mục này?')) return; try { await axios.delete(url); fetchPayroll(); } catch (e) { alert('Xóa thất bại'); } };

    const sumRow = (label, val, bold, bg) => (
        <tr style={bg ? { background: bg } : {}}>
            <td colSpan={3} className={'px-3 py-2 border border-gray-300 ' + (bold ? 'font-bold' : '')}>{label}</td>
            <td className={'px-3 py-2 border border-gray-300 text-center ' + (bold ? 'font-bold' : '')}>{val}</td>
            <td className="px-3 py-2 border border-gray-300"></td>
        </tr>
    );

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Bảng lương</h1>
                    <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name} — {e.branch?.name}</option>)}
                    </select>
                    <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]" />
                    {payroll && editable && <button onClick={() => exportPayslipPNG(payroll)} className={btn + 'bg-[#24305E] text-white'}>⬇ Xuất ảnh</button>}
                </div>

                <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-4">
                    {[['sheet', 'Bảng lương'], ['days', 'Chi tiết ngày công'], ['other', 'Mức lương / Ứng / Thưởng / BHXH']].map(([k, l]) => (
                        <button key={k} onClick={() => setTab(k)} className={'px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px ' + (tab === k ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500')}>{l}</button>
                    ))}
                </div>

                {loading && <div className="text-gray-500 text-sm">Đang tính...</div>}

                {payroll && tab === 'sheet' && (
                    <div className="overflow-x-auto border border-gray-300 rounded-lg bg-white">
                        <table className="w-full text-[13px] min-w-[640px] border-collapse">
                            <tbody>
                                <tr className="bg-[#d9d9d9]">
                                    <td colSpan={2} className="px-3 py-2 border border-gray-300 font-bold">{payroll.month_label}</td>
                                    <td colSpan={3} className="px-3 py-2 border border-gray-300 font-bold">Nhân viên: {(payroll.employee.full_name || '').toUpperCase()}</td>
                                </tr>
                                <tr className="bg-[#d9d9d9] font-bold text-center">
                                    <td className="px-3 py-2 border border-gray-300">Ngày</td>
                                    <td className="px-3 py-2 border border-gray-300">Giờ vào</td>
                                    <td className="px-3 py-2 border border-gray-300">Giờ ra</td>
                                    <td className="px-3 py-2 border border-gray-300">Tổng số giờ</td>
                                    <td className="px-3 py-2 border border-gray-300">Phụ cấp tiền ăn</td>
                                </tr>
                                {payroll.days.map((d, i) => (
                                    <tr key={i} className="text-center">
                                        <td className="px-3 py-1.5 border border-gray-300">{fmtDate(d.date)}{d.is_holiday && <span className="inline-block ml-1 bg-red-50 text-red-600 border border-red-200 rounded-full px-1.5 text-[10px] font-bold" title={d.holiday_name}>x{d.multiplier}</span>}</td>
                                        <td className="px-3 py-1.5 border border-gray-300">{fmtTime(d.check_in) || ''}</td>
                                        <td className="px-3 py-1.5 border border-gray-300">{fmtTime(d.check_out) || ''}</td>
                                        <td className="px-3 py-1.5 border border-gray-300">{d.hours ? fmtH(d.hours) : '0.00'}</td>
                                        <td className="px-3 py-1.5 border border-gray-300">{d.meal_count > 1 ? 'X' + d.meal_count : (d.meal_count ? 'X' : '')}</td>
                                    </tr>
                                ))}
                                {sumRow('A. TỔNG GIỜ CÔNG', fmtH(s.total_hours), true)}
                                {sumRow('1. ' + (s.line1_note || 'Các khoản trừ khác'), s.line1_deduction ? fmt(s.line1_deduction) : '')}
                                {s.violations > 0 && sumRow('Số lỗi vi phạm' + (s.violation_note ? ' (' + s.violation_note + ')' : ''), s.violations + ' lỗi')}
                                {sumRow('2. Lương trách nhiệm (' + s.resp_formula + ')', fmt(s.line2_responsibility) + '/h')}
                                {sumRow('3. Lương cơ bản/h', fmt(s.line3_base_rate))}
                                {sumRow('4. Mức lương/h (2 + 3)', fmt(s.line4_rate), true)}
                                {sumRow('B. LƯƠNG', fmt(s.gross), true)}
                                {s.meal_total > 0 && sumRow('Phụ cấp tiền ăn (' + fmt(s.meal_price) + 'đ × ' + (s.meal_count_total || 0) + ' suất)', fmt(s.meal_total))}
                                {s.holiday_extra > 0 && sumRow('Lương lễ/tết', (s.holiday_days || []).map((h) => (h.date ? fmtDate(h.date) + ' ' : '') + '(x' + h.multiplier + '): +' + fmt(h.extra) + 'đ').join('; '))}
                                {s.bonus_total > 0 && sumRow('Thưởng', fmt(s.bonus_total))}
                                {s.advance_total > 0 && sumRow('Ứng lương (trừ)', fmt(s.advance_total))}
                                {sumRow('C. THỰC NHẬN', fmt(s.net), true, '#c6efce')}
                                {ins && (<>
                                    <tr><td colSpan={5} className="px-3 py-2 border border-gray-300 font-bold">D. BHXH (Mức đóng {fmt(ins.base_amount)}){ins.employer_pays_all ? ' (Công ty chi trả)' : ''}</td></tr>
                                    <tr className="text-center font-bold">
                                        <td colSpan={3} className="px-3 py-2 border border-gray-300"></td>
                                        <td className="px-3 py-2 border border-gray-300">NLĐ Đóng ({ins.employee_rate}%)</td>
                                        <td className="px-3 py-2 border border-gray-300">DN Đóng ({ins.employer_rate}%)</td>
                                    </tr>
                                    <tr className="text-center font-bold">
                                        <td colSpan={3} className="px-3 py-2 border border-gray-300"></td>
                                        <td className="px-3 py-2 border border-gray-300">{fmt(ins.employee_total)}</td>
                                        <td className="px-3 py-2 border border-gray-300">{fmt(ins.employer_total)}</td>
                                    </tr>
                                    {ins.details.map((dt, i) => (
                                        <tr key={i} className="text-center">
                                            <td colSpan={3} className="px-3 py-1.5 border border-gray-300 text-left">{dt.label}</td>
                                            <td className="px-3 py-1.5 border border-gray-300">{fmt(dt.amount)}</td>
                                            <td className="px-3 py-1.5 border border-gray-300"></td>
                                        </tr>
                                    ))}
                                </>)}
                            </tbody>
                        </table>
                    </div>
                )}

                {payroll && tab === 'days' && (
                    <div className="m-card p-4">
                        <p className="text-[13px] text-gray-500 mb-3">Nhập giờ vào/ra (HH:MM) — hệ thống tự tính tổng giờ. Cột ăn: số suất (1 = X, 2 = X2...). Ngày trắng sẽ không lưu.</p>
                        <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-[480px] overflow-y-auto">
                            <table className="w-full text-[13px] min-w-[560px]">
                                <thead className="sticky top-0 bg-gray-50">
                                    <tr className="text-left text-gray-500">
                                        <th className="px-3 py-2 font-medium">Ngày</th><th className="px-3 py-2 font-medium">Giờ vào</th>
                                        <th className="px-3 py-2 font-medium">Giờ ra</th><th className="px-3 py-2 font-medium">Tổng giờ</th>
                                        <th className="px-3 py-2 font-medium">Suất ăn</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {days.map((d, i) => (
                                        <tr key={d.date} className="border-t border-gray-100">
                                            <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(d.date)}</td>
                                            {['check_in', 'check_out'].map((k) => (
                                                <td key={k} className="px-2 py-1"><input disabled={!editable} value={d[k] || ''} placeholder="HH:MM"
                                                    onChange={(e) => { const nd = [...days]; nd[i][k] = e.target.value; setDays(nd); }} className={inp + ' !w-24'} /></td>
                                            ))}
                                            <td className="px-2 py-1"><input disabled={!editable} type="number" step="0.01" min="0" value={d.hours || ''}
                                                onChange={(e) => { const nd = [...days]; nd[i].hours = e.target.value; if (!nd[i].meal_manual) nd[i].meal_count = (Number(e.target.value) || 0) >= Number(mealCfg.meal_min_hours || 14.5) ? 1 : 0; setDays(nd); }} className={inp + ' !w-24'} placeholder="tự tính" /></td>
                                            <td className="px-2 py-1"><div className="flex items-center gap-1">
                                                <input disabled={!editable} type="number" min="0" max="10" value={d.meal_count || ''}
                                                    onChange={(e) => { const nd = [...days]; nd[i].meal_count = e.target.value; nd[i].meal_manual = true; setDays(nd); }} className={inp + ' !w-20'} />
                                                {!d.meal_manual && Number(d.meal_count) > 0 && <span title={'Tự tính (≥ ' + mealCfg.meal_min_hours + 'h/ngày)'} className="text-[11px] text-emerald-600">⚡</span>}
                                            </div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {editable && <button onClick={saveDays} className={btn + 'bg-[#24305E] text-white mt-3'}>Lưu chi tiết ngày công</button>}
                    </div>
                )}

                {payroll && tab === 'other' && (
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="m-card p-4">
                            <h3 className="font-bold mb-2">Mức lương theo giờ</h3>
                            {hist?.wage_levels?.map((w) => (
                                <div key={w.id} className="flex items-center justify-between text-[13px] border-b border-gray-100 py-2">
                                    <span>{fmt(w.hourly_rate)}đ/h <span className="text-gray-400">({fmtDate(w.start_date)} → {fmtDate(w.end_date) || 'nay'})</span></span>
                                    {editable && <button onClick={() => del(API + '/salary/wage-levels/' + w.id)} className="text-red-500 text-[12px]">Xóa</button>}
                                </div>
                            ))}
                            {editable && <div className="grid grid-cols-2 gap-2 mt-3">
                                <input type="number" placeholder="Lương cơ bản/h *" value={wlForm.hourly_rate} onChange={(e) => setWlForm({ ...wlForm, hourly_rate: e.target.value })} className={inp} />
                                <DateInput value={wlForm.start_date} onChange={(v) => setWlForm({ ...wlForm, start_date: v })} className={inp} />
                                <input placeholder="Ghi chú" value={wlForm.note} onChange={(e) => setWlForm({ ...wlForm, note: e.target.value })} className={inp} />
                                <button onClick={addWage} className={btn + 'bg-[#24305E] text-white col-span-2'}>+ Thêm mức lương (tự đóng mức cũ)</button>
                            </div>}
                        </div>

                        <div className="m-card p-4">
                            <h3 className="font-bold mb-2">BHXH nhân viên</h3>
                            {editable ? (<>
                                <div className="grid grid-cols-2 gap-2">
                                    <input type="number" placeholder="Mức lương đóng *" value={insForm.base_amount} onChange={(e) => setInsForm({ ...insForm, base_amount: e.target.value })} className={inp} />
                                    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={insForm.employer_pays_all} onChange={(e) => setInsForm({ ...insForm, employer_pays_all: e.target.checked })} /> DN đóng thay cả phần NLĐ</label>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <button onClick={saveInsurance} className={btn + 'bg-[#24305E] text-white'}>Lưu BHXH</button>
                                    <button onClick={() => del(API + '/employees/' + empId + '/insurance', 'Xóa cấu hình BHXH của nhân viên này?')} className={btn + 'border border-red-300 text-red-500'}>Xóa</button>
                                </div>
                                <p className="text-[12px] text-gray-400 mt-2">Tỷ lệ cấu hình trong Thiết lập (mặc định NLĐ 10.5% = 8/1.5/1, DN 21.5%).</p>
                            </>) : <p className="text-[13px] text-gray-500">Chưa cấu hình / không có quyền sửa.</p>}
                        </div>

                        <div className="m-card p-4">
                            <h3 className="font-bold mb-2">Ứng lương (trừ vào kỳ lương)</h3>
                            {hist?.advances?.filter((a) => a.date?.startsWith(month)).map((a) => (
                                <div key={a.id} className="flex items-center justify-between text-[13px] border-b border-gray-100 py-2">
                                    <span>{fmt(a.amount)}đ <span className="text-gray-400">({fmtDate(a.date)}{a.note ? ' — ' + a.note : ''})</span></span>
                                    {editable && <button onClick={() => del(API + '/salary/advances/' + a.id)} className="text-red-500 text-[12px]">Xóa</button>}
                                </div>
                            ))}
                            {editable && <div className="grid grid-cols-3 gap-2 mt-3">
                                <input type="number" placeholder="Số tiền *" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })} className={inp} />
                                <DateInput value={advForm.date} onChange={(v) => setAdvForm({ ...advForm, date: v })} className={inp} />
                                <input placeholder="Ghi chú" value={advForm.note} onChange={(e) => setAdvForm({ ...advForm, note: e.target.value })} className={inp} />
                                <button onClick={addAdv} className={btn + 'bg-[#24305E] text-white col-span-3'}>+ Thêm khoản ứng</button>
                            </div>}
                        </div>

                        <div className="m-card p-4">
                            <h3 className="font-bold mb-2">Thưởng</h3>
                            {hist?.bonuses?.filter((b) => b.date?.startsWith(month)).map((b) => (
                                <div key={b.id} className="flex items-center justify-between text-[13px] border-b border-gray-100 py-2">
                                    <span>{b.type === 'performance' ? 'Hiệu suất' : b.type === 'birthday' ? 'Sinh nhật' : 'Khác'}: {fmt(b.amount)}đ <span className="text-gray-400">({fmtDate(b.date)}{b.note ? ' — ' + b.note : ''})</span></span>
                                    {editable && <button onClick={() => del(API + '/salary/bonuses/' + b.id)} className="text-red-500 text-[12px]">Xóa</button>}
                                </div>
                            ))}
                            {editable && <div className="grid grid-cols-2 gap-2 mt-3">
                                <select value={bonusForm.type} onChange={(e) => setBonusForm({ ...bonusForm, type: e.target.value })} className={inp}>
                                    <option value="performance">Thưởng hiệu suất</option><option value="birthday">Thưởng sinh nhật</option><option value="other">Thưởng khác</option>
                                </select>
                                <input type="number" placeholder="Số tiền *" value={bonusForm.amount} onChange={(e) => setBonusForm({ ...bonusForm, amount: e.target.value })} className={inp} />
                                <DateInput value={bonusForm.date} onChange={(v) => setBonusForm({ ...bonusForm, date: v })} className={inp} />
                                <input placeholder="Ghi chú" value={bonusForm.note} onChange={(e) => setBonusForm({ ...bonusForm, note: e.target.value })} className={inp} />
                                <button onClick={addBonus} className={btn + 'bg-[#24305E] text-white col-span-2'}>+ Thêm thưởng</button>
                            </div>}
                        </div>

                        <div className="m-card p-4 md:col-span-2">
                            <h3 className="font-bold mb-2">Vi phạm & khoản trừ khác (tháng {month})</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <input type="number" min="0" max="100" placeholder="Số lỗi vi phạm" value={violForm.violation_count} onChange={(e) => setViolForm({ ...violForm, violation_count: e.target.value })} className={inp} disabled={!editable} />
                                <input placeholder="Lý do vi phạm (vd Lỗi 3 chuyên)" value={violForm.violation_note} onChange={(e) => setViolForm({ ...violForm, violation_note: e.target.value })} className={inp} disabled={!editable} />
                                <input type="number" placeholder="Khoản trừ khác (1.)" value={recForm.other_deduction} onChange={(e) => setRecForm({ ...recForm, other_deduction: e.target.value })} className={inp} disabled={!editable} />
                                <input placeholder="Ghi chú tháng" value={recForm.note} onChange={(e) => setRecForm({ ...recForm, note: e.target.value })} className={inp} disabled={!editable} />
                            </div>
                            {editable && <button onClick={saveRecordExtra} className={btn + 'bg-[#24305E] text-white mt-3'}>Lưu</button>}
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
