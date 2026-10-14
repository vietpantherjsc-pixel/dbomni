import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtDate, fmtTime } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';

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
           C(d.hours == null ? '' : fmtH(d.hours), 1, { align: 'center' }),
           C(d.meal_count > 1 ? 'X' + d.meal_count : (d.meal_count ? 'X' : ''), 1, { align: 'center' })]);
    });
    const sum = (label, val, bold, bg) => R([C(label, 3, { bold }), C(val, 1, { bold, align: 'center' }), C('', 1)], bg);
    sum('A. TỔNG GIỜ CÔNG', fmtH(s.total_hours), true);
    const dedRows = Array.isArray(s.deductions) ? s.deductions : (s.line1_deduction ? [{ name: s.line1_note || 'Các khoản trừ khác', amount: s.line1_deduction, note: '' }] : []);
    dedRows.forEach((d) => sum('Trừ khác: ' + d.name + (d.note ? ' (' + d.note + ')' : ''), d.amount ? fmt(d.amount) : ''));
    if (s.violations > 0 || s.violations_override) sum('Số lỗi 3 Chuyên' + (s.violations_override ? ' (điều chỉnh tay)' : ' (tự động)') + (s.violation_note ? ' — ' + s.violation_note : ''), s.violations + ' lỗi');
    sum('2. Lương trách nhiệm (' + s.resp_formula + ')', fmt(s.line2_responsibility) + '/h');
    sum('3. Lương cơ bản/h', fmt(s.line3_base_rate));
    sum('4. Mức lương/h (2 + 3)', fmt(s.line4_rate), true);
    sum('B. LƯƠNG', fmt(s.gross), true);
    if (s.meal_total) sum('Phụ cấp tiền ăn (' + fmt(s.meal_price) + 'đ × ' + (s.meal_count_total || 0) + ' suất)', fmt(s.meal_total));
    if (s.holiday_extra) sum('Lương lễ/tết', (s.holiday_days || []).map((h) => ((h.date ? fmtDate(h.date) + ' ' : '') + '(x' + h.multiplier + '): +' + fmt(h.extra) + 'đ')).join('; '));
    if (s.bonus_total) sum('Thưởng', fmt(s.bonus_total));
    if (s.advance_total) sum('Ứng lương (trừ)', fmt(s.advance_total));
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

// Gói 55: Tab Tổng lương — tổng hợp lương toàn NV dạng list, 2 chế độ xem (tất cả CN / từng CN)
function TotalSalaryTab({ month }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState('all'); // 'all' | branch_id
    const [branches, setBranches] = useState([]);

    const loadBranches = () => {
        axios.get(API + '/branches').then((r) => setBranches(r.data?.data || r.data || [])).catch(() => {});
    };

    const load = async (branchId) => {
        setLoading(true);
        try {
            const params = { month };
            if (branchId && branchId !== 'all') params.branch_id = branchId;
            const r = await axios.get(API + '/salary-summary', { params });
            setData(r.data?.data || null);
        } catch (e) { alert(e.response?.data?.message || 'Lỗi tải tổng lương'); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadBranches(); }, []);
    useEffect(() => { load(viewMode); }, [month, viewMode]);

    const fmtVnd = (n) => Number(n || 0).toLocaleString('vi-VN');

    return (
        <div>
            <div className="flex gap-2 mb-4 flex-wrap items-center">
                <button onClick={() => setViewMode('all')}
                    className={'px-4 py-2 rounded-full text-[13px] font-medium border ' + (viewMode === 'all' ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300')}>
                    Tất cả chi nhánh
                </button>
                {branches.map((b) => (
                    <button key={b.id} onClick={() => setViewMode(String(b.id))}
                        className={'px-4 py-2 rounded-full text-[13px] font-medium border ' + (viewMode === String(b.id) ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300')}>
                        {b.name}
                    </button>
                ))}
            </div>

            {loading && <div className="text-gray-500 text-sm">Đang tính...</div>}

            {data && (
                <>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-white border rounded-lg p-4">
                            <div className="text-[12px] text-gray-500">Nhân viên</div>
                            <div className="text-[22px] font-bold text-[#24305E]">{data.employee_count}</div>
                        </div>
                        <div className="bg-white border rounded-lg p-4">
                            <div className="text-[12px] text-gray-500">Tổng giờ công</div>
                            <div className="text-[22px] font-bold text-[#24305E]">{data.grand_hours}h</div>
                        </div>
                        <div className="bg-white border rounded-lg p-4">
                            <div className="text-[12px] text-gray-500">Tổng lương</div>
                            <div className="text-[22px] font-bold text-[#0d6efd]">{fmtVnd(data.grand_total)}đ</div>
                        </div>
                    </div>

                    <div className="overflow-x-auto border border-gray-300 rounded-lg bg-white">
                        <table className="w-full text-[13px] min-w-[640px] border-collapse">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="px-3 py-2 border text-left">Nhân viên</th>
                                    <th className="px-3 py-2 border text-left">Chi nhánh</th>
                                    <th className="px-3 py-2 border text-left">Chức vụ</th>
                                    <th className="px-3 py-2 border text-right">Tổng giờ</th>
                                    <th className="px-3 py-2 border text-right">Đơn giá/giờ</th>
                                    <th className="px-3 py-2 border text-right">Tổng lương</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((r) => (
                                    <tr key={r.employee_id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 border font-medium">{r.full_name}</td>
                                        <td className="px-3 py-2 border">{r.branch_name}</td>
                                        <td className="px-3 py-2 border text-gray-500">{r.role_name}</td>
                                        <td className="px-3 py-2 border text-right">{r.total_hours}h</td>
                                        <td className="px-3 py-2 border text-right">{fmtVnd(r.hourly_rate)}đ</td>
                                        <td className="px-3 py-2 border text-right font-bold text-[#0d6efd]">{fmtVnd(r.gross)}đ</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-[#24305E] text-white font-bold">
                                    <td className="px-3 py-2 border" colSpan={3}>TỔNG CỘNG ({data.employee_count} NV)</td>
                                    <td className="px-3 py-2 border text-right">{data.grand_hours}h</td>
                                    <td className="px-3 py-2 border"></td>
                                    <td className="px-3 py-2 border text-right">{fmtVnd(data.grand_total)}đ</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div className="text-[12px] text-gray-400 mt-2">
                        * Tổng lương = tổng giờ × đơn giá giờ (chưa gồm phụ cấp, thưởng, BHXH chi tiết — xem từng NV ở tab Bảng lương)
                    </div>
                </>
            )}
        </div>
    );
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
    // Gói 40: Trừ khác = danh sách (thay 4 ô input cũ); Lỗi 3 Chuyên tự cộng + điều chỉnh tay
    const [deductions, setDeductions] = useState([]);
    const [deductionsOrig, setDeductionsOrig] = useState([]);
    const [monthNote, setMonthNote] = useState('');
    const [violAuto, setViolAuto] = useState(0);
    const [violOverride, setViolOverride] = useState('');
    const [violNote, setViolNote] = useState('');
    const [wlForm, setWlForm] = useState({ hourly_rate: '', start_date: '', note: '' });
    const [advForm, setAdvForm] = useState({ amount: '', date: '', note: '' });
    const [bonusForm, setBonusForm] = useState({ type: 'performance', amount: '', date: '', note: '' });
    // Đổ giờ công từ chấm công
    const [branches, setBranches] = useState([]);
    const [impOpen, setImpOpen] = useState(false);
    const [impMonth, setImpMonth] = useState(month);
    const [impBranch, setImpBranch] = useState('');
    const [impLoading, setImpLoading] = useState(false);
    const [impResult, setImpResult] = useState(null);

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
                const sum = res.data.data.summary || {};
                // Trừ khác: ưu tiên mảng deductions từ contract; fallback gọi endpoint riêng
                const dl = Array.isArray(sum.deductions) ? sum.deductions : null;
                if (dl) {
                    setDeductions(dl.map((d) => ({ ...d })));
                    setDeductionsOrig(dl.map((d) => ({ ...d })));
                } else {
                    try {
                        const dd = await axios.get(API + '/salary/' + empId + '/deductions', { params: { month } });
                        const list = dd.data?.data || [];
                        setDeductions(list.map((d) => ({ ...d })));
                        setDeductionsOrig(list.map((d) => ({ ...d })));
                    } catch { setDeductions([]); setDeductionsOrig([]); }
                }
                setViolAuto(sum.violations_auto ?? sum.violations ?? 0);
                setViolOverride(sum.violations_override ? String(sum.violations ?? '') : '');
                setViolNote(sum.violation_note || '');
                setMonthNote(res.data.data.record?.note || '');
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
    useEffect(() => {
        axios.get(API + '/branches').then((r) => setBranches(r.data?.data || r.data || [])).catch(() => {});
    }, []);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Nhân viên.</div></AdminLayout>);
    const editable = can('staff.edit');
    const s = payroll?.summary, ins = payroll?.insurance;
    const inp = 'border border-gray-300 rounded px-2 py-1.5 text-[13px] w-full';
    const btn = 'px-3 py-1.5 rounded text-[13px] font-medium ';

    const saveDays = async () => {
        try {
            await axios.post(API + '/salary/' + empId + '/days', { days: days.map((d) => ({ date: d.date, check_in: d.check_in || null, check_out: d.check_out || null, hours: (d.hours === '' || d.hours == null) ? null : Number(d.hours), meal_count: Number(d.meal_count) || 0, meal_manual: !!d.meal_manual })) });
            alert('Đã lưu chi tiết ngày công.'); fetchPayroll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    // Đổ giờ công từ chấm công (theo giờ check-in/out thực tế)
    const openImport = () => { setImpMonth(month); setImpBranch(''); setImpResult(null); setImpOpen(true); };
    const doImport = async () => {
        if (!impMonth) return alert('Chọn tháng cần đổ giờ công');
        if (!window.confirm('Đổ giờ công tháng ' + impMonth + (impBranch ? '' : ' (tất cả chi nhánh)') + ' từ chấm công?\n\n• Lấy giờ check-in/out thực tế\n• Quên chấm → để trống, nhập tay sau\n• Nghỉ được duyệt → 0 giờ\n• Ô đã nhập tay sẽ được GIỮ NGUYÊN')) return;
        setImpLoading(true);
        try {
            const r = await axios.post(API + '/salary/import-attendance', { month: impMonth, branch_id: impBranch || undefined });
            setImpResult(r.data?.data || null);
            fetchPayroll();
        } catch (e) { alert(e.response?.data?.message || 'Đổ giờ công thất bại'); }
        setImpLoading(false);
    };
    // Gói 40: lưu Lỗi 3 Chuyên (null = về tự động)
    const saveViolations = async () => {
        try {
            await axios.put(API + '/salary/' + empId + '/violations', { month, violation_count: violOverride === '' ? null : Number(violOverride), violation_note: violNote || null });
            alert('Đã lưu.'); fetchPayroll();
        } catch (e) { alert(e.response?.data?.message || 'Lưu thất bại'); }
    };
    // Gói 40: Trừ khác — diff với danh sách gốc rồi POST/PUT/DELETE
    const updDed = (i, k, v) => { const nd = [...deductions]; nd[i] = { ...nd[i], [k]: v }; setDeductions(nd); };
    const addDed = () => setDeductions([...deductions, { name: '', amount: '', note: '' }]);
    const delDedRow = (i) => setDeductions(deductions.filter((_, x) => x !== i));
    const saveDeductions = async () => {
        const origById = Object.fromEntries(deductionsOrig.filter((d) => d.id).map((d) => [d.id, d]));
        const curIds = new Set(deductions.filter((d) => d.id).map((d) => d.id));
        try {
            for (const o of deductionsOrig) {
                if (o.id && !curIds.has(o.id)) await axios.delete(API + '/salary/deductions/' + o.id);
            }
            for (const d of deductions) {
                if (!String(d.name || '').trim() && !Number(d.amount)) continue;
                if (!d.id) {
                    await axios.post(API + '/salary/' + empId + '/deductions', { month, name: String(d.name).trim(), amount: Number(d.amount) || 0, note: d.note || null });
                } else {
                    const o = origById[d.id];
                    if (!o || o.name !== d.name || Number(o.amount) !== Number(d.amount) || (o.note || '') !== (d.note || '')) {
                        await axios.put(API + '/salary/deductions/' + d.id, { name: String(d.name).trim(), amount: Number(d.amount) || 0, note: d.note || null });
                    }
                }
            }
            await axios.post(API + '/salary/' + empId + '/record', { month, hours: s?.total_hours || 0, work_days: 0, note: monthNote || null });
            alert('Đã lưu khoản trừ khác.'); fetchPayroll();
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
                    {editable && <button onClick={openImport} className={btn + 'bg-[#0d6efd] text-white'} title="Lấy giờ check-in/out thực tế đổ vào bảng lương">Đổ giờ công từ chấm công</button>}
                </div>

                <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-4">
                    {[['sheet', 'Bảng lương'], ['days', 'Chi tiết ngày công'], ['other', 'Mức lương / Ứng / Thưởng / BHXH'], ['total', 'Tổng lương']].map(([k, l]) => (
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
                                        <td className="px-3 py-1.5 border border-gray-300">{d.hours == null ? '' : fmtH(d.hours)}{d.hours_source === 'attendance' && <span className="inline-block ml-1 bg-blue-50 text-[#1d4ed8] border border-blue-200 rounded-full px-1.5 text-[10px] font-bold" title="Giờ từ chấm công">chấm công</span>}{d.hours_source === 'leave' && <span className="inline-block ml-1 bg-gray-100 text-gray-500 border border-gray-200 rounded-full px-1.5 text-[10px] font-bold" title="Nghỉ được duyệt">nghỉ</span>}</td>
                                        <td className="px-3 py-1.5 border border-gray-300">{d.meal_count > 1 ? 'X' + d.meal_count : (d.meal_count ? 'X' : '')}</td>
                                    </tr>
                                ))}
                                {sumRow('A. TỔNG GIỜ CÔNG', fmtH(s.total_hours), true)}
                                {(Array.isArray(s.deductions) ? s.deductions : (s.line1_deduction ? [{ name: s.line1_note || 'Các khoản trừ khác', amount: s.line1_deduction, note: '' }] : [])).map((d, i) =>
                                    sumRow('Trừ khác: ' + d.name + (d.note ? ' (' + d.note + ')' : ''), d.amount ? fmt(d.amount) : '')
                                )}
                                {(s.violations > 0 || s.violations_override) && sumRow('Số lỗi 3 Chuyên' + (s.violations_override ? ' (điều chỉnh tay)' : ' (tự động)') + (s.violation_note ? ' — ' + s.violation_note : ''), s.violations + ' lỗi')}
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
                                        <th className="px-3 py-2 font-medium">Ngày</th>
                                        <th className="px-3 py-2 font-medium">Chi nhánh</th><th className="px-3 py-2 font-medium">Giờ vào</th>
                                        <th className="px-3 py-2 font-medium">Giờ ra</th><th className="px-3 py-2 font-medium">Tổng giờ</th>
                                        <th className="px-3 py-2 font-medium">Suất ăn</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {days.map((d, i) => (
                                        <tr key={d.date + '|' + (d.branch_id || '')} className="border-t border-gray-100">
                                            <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(d.date)}</td>
                                            <td className="px-3 py-1.5 whitespace-nowrap text-[12px]">
                                                {d.branch_name ? <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 font-medium">{d.branch_name}</span> : <span className="text-gray-300">—</span>}
                                            </td>
                                            {['check_in', 'check_out'].map((k) => (
                                                <td key={k} className="px-2 py-1"><input disabled={!editable} value={d[k] || ''} placeholder="HH:MM"
                                                    onChange={(e) => { const nd = [...days]; nd[i][k] = e.target.value; setDays(nd); }} className={inp + ' !w-24'} /></td>
                                            ))}
                                            <td className="px-2 py-1"><div className="flex items-center gap-1">
                                                <input disabled={!editable} type="number" step="0.01" min="0" value={d.hours ?? ''}
                                                    onChange={(e) => { const nd = [...days]; nd[i].hours = e.target.value; if (!nd[i].meal_manual) nd[i].meal_count = (Number(e.target.value) || 0) >= Number(mealCfg.meal_min_hours || 14.5) ? 1 : 0; setDays(nd); }} className={inp + ' !w-24'} placeholder="tự tính" />
                                                {d.hours_source === 'attendance' && <span className="text-[10px] font-bold text-[#1d4ed8] bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5 whitespace-nowrap" title="Giờ đổ từ chấm công — sửa tay sẽ chuyển thành nhập tay">chấm công</span>}
                                                {d.hours_source === 'leave' && <span className="text-[10px] font-bold text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-1.5 py-0.5 whitespace-nowrap" title="Nghỉ được duyệt = 0 giờ">nghỉ</span>}
                                            </div></td>
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
                            <h3 className="font-bold mb-2">Trừ khác (tháng {month})</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-[13px] min-w-[520px]">
                                    <thead><tr className="text-left text-gray-500 border-b border-gray-100">
                                        <th className="py-2 font-medium">Tên khoản trừ</th>
                                        <th className="py-2 font-medium">Số tiền</th>
                                        <th className="py-2 font-medium">Lý do</th>
                                        {editable && <th className="py-2 w-10"></th>}
                                    </tr></thead>
                                    <tbody>
                                        {deductions.map((d, i) => (
                                            <tr key={d.id || 'new-' + i} className="border-b border-gray-50">
                                                <td className="py-1.5 pr-2"><input disabled={!editable} value={d.name || ''} onChange={(e) => updDed(i, 'name', e.target.value)} className={inp} placeholder="VD: Tạm ứng" /></td>
                                                <td className="py-1.5 pr-2"><input disabled={!editable} type="number" min="0" value={d.amount ?? ''} onChange={(e) => updDed(i, 'amount', e.target.value)} className={inp + ' !w-32'} placeholder="0" /></td>
                                                <td className="py-1.5 pr-2"><input disabled={!editable} value={d.note || ''} onChange={(e) => updDed(i, 'note', e.target.value)} className={inp} placeholder="Lý do" /></td>
                                                {editable && <td className="py-1.5"><button onClick={() => delDedRow(i)} className="text-red-500 text-[14px]" title="Xóa dòng">✕</button></td>}
                                            </tr>
                                        ))}
                                        {deductions.length === 0 && <tr><td colSpan={editable ? 4 : 3} className="py-6 text-center text-gray-400">Chưa có khoản trừ khác.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex justify-between items-center mt-2 text-[13px]">
                                <span className="text-gray-500">Tổng trừ khác</span>
                                <b className="text-[#24305E]">{fmt(deductions.reduce((t, d) => t + (Number(d.amount) || 0), 0))}đ</b>
                            </div>
                            <input placeholder="Ghi chú tháng" value={monthNote} onChange={(e) => setMonthNote(e.target.value)} className={inp + ' mt-2'} disabled={!editable} />
                            {editable && <div className="flex gap-2 mt-3">
                                <button onClick={addDed} className={btn + 'border border-gray-300'}>＋ Thêm khoản trừ</button>
                                <button onClick={saveDeductions} className={btn + 'bg-[#24305E] text-white'}>Lưu</button>
                            </div>}
                        </div>

                        <div className="m-card p-4">
                            <h3 className="font-bold mb-2">Lỗi 3 Chuyên (tháng {month})</h3>
                            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[13px]">
                                Tự động từ chấm công: <b className="text-[#24305E]">{violAuto} lỗi</b>
                                <div className="text-[12px] text-gray-400 mt-0.5">Cộng từ tab Lỗi 3 Chuyên — quản lý cửa hàng ghi nhận tại đó.</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <input type="number" min="0" placeholder="Điều chỉnh tay (trống = tự động)" value={violOverride} onChange={(e) => setViolOverride(e.target.value)} className={inp} disabled={!editable} />
                                <input placeholder="Lý do / ghi chú" value={violNote} onChange={(e) => setViolNote(e.target.value)} className={inp} disabled={!editable} />
                            </div>
                            {editable && <button onClick={saveViolations} className={btn + 'bg-[#24305E] text-white mt-3'}>Lưu</button>}
                        </div>
                    </div>
                )}

                {/* Gói 55: Tab Tổng lương */}
                {tab === 'total' && (
                    <TotalSalaryTab month={month} />
                )}
            </div>

            {/* Modal đổ giờ công từ chấm công */}
            {impOpen && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => !impLoading && setImpOpen(false)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[440px] max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                        <h2 className="font-bold text-[16px] text-[#24305E]">Đổ giờ công từ chấm công</h2>
                        {!impResult ? (<>
                            <p className="text-[12px] text-gray-500 mt-1 mb-3 leading-[1.7]">
                                Lấy giờ <b>check-in/out thực tế</b> đổ vào bảng lương tháng.<br />
                                • Quên chấm (thiếu giờ vào/ra) → <b>để trống</b>, nhập tay sau<br />
                                • Nghỉ được duyệt → <b>0 giờ</b><br />
                                • Ô đã nhập tay <b>không</b> bị ghi đè
                            </p>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div>
                                    <label className="text-[12px] text-gray-500">Tháng</label>
                                    <input type="month" value={impMonth} onChange={(e) => setImpMonth(e.target.value)} className={inp + ' mt-1'} />
                                </div>
                                <div>
                                    <label className="text-[12px] text-gray-500">Chi nhánh</label>
                                    <select value={impBranch} onChange={(e) => setImpBranch(e.target.value)} className={inp + ' mt-1'}>
                                        <option value="">Tất cả chi nhánh</option>
                                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setImpOpen(false)} disabled={impLoading} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                                <button onClick={doImport} disabled={impLoading} className={'flex-1 h-11 rounded-xl text-white text-[14px] font-semibold ' + (impLoading ? 'bg-gray-400' : 'bg-[#0d6efd]')}>{impLoading ? 'Đang đổ...' : 'Xác nhận đổ'}</button>
                            </div>
                        </>) : (
                            <div className="text-[13px] leading-[1.9] mt-2">
                                <div>✅ Đã đổ giờ đầy đủ: <b>{impResult.imported}</b> ngày</div>
                                <div>🏖️ Ngày nghỉ được duyệt: <b>{impResult.leave}</b> ngày</div>
                                <div>⚠️ Thiếu chấm (để trống): <b>{impResult.incomplete}</b> ngày — cần nhập tay bổ sung</div>
                                <div>🔒 Giữ nguyên (đã nhập tay): <b>{impResult.skipped_manual}</b> ô</div>
                                <div className="text-gray-500">Nhân viên xử lý: {impResult.employees}</div>
                                {(impResult.missing || []).length > 0 && (
                                    <div className="mt-2 max-h-[160px] overflow-y-auto border border-gray-200 rounded p-2 text-[12px]">
                                        <div className="font-semibold mb-1">Cần nhập tay bổ sung:</div>
                                        {impResult.missing.slice(0, 50).map((m, i) => (
                                            <div key={i}>{m.employee} — {fmtDate(m.date)}</div>
                                        ))}
                                        {impResult.missing.length > 50 && <div>... và {impResult.missing.length - 50} ngày nữa</div>}
                                    </div>
                                )}
                                <button onClick={() => { setImpOpen(false); fetchPayroll(); }} className="w-full h-11 rounded-xl bg-[#24305E] text-white text-[14px] font-semibold mt-4">Đóng</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
