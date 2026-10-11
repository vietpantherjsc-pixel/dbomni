import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';
import { fmtTime, fmtDate, startOfWeek } from '../../utils/format';
import DateInput from '../../components/DateInput';
import TimeInput, { valid24 } from '../../components/TimeInput'; // Gói 36: dùng chung

const API = 'http://localhost/api';
const WD = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
const WD_FULL = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const WD_UP = ['THỨ 2', 'THỨ 3', 'THỨ 4', 'THỨ 5', 'THỨ 6', 'THỨ 7', 'CHỦ NHẬT'];
const mondayOf = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; };
const fmtD = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const weekDates = (mondayIso) => { const m = new Date(mondayIso + 'T00:00:00'); return Array.from({ length: 7 }, (_, i) => { const x = new Date(m); x.setDate(x.getDate() + i); return fmtD(x); }); };
const ddMM = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const weekdayOf = (iso) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7; // 0=Thứ 2
const slug = (s) => (s || 'cn').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
const hhmm = (t) => fmtTime(t); // Gói 36: dùng chung utils/format


// ---------- Gói 37: Xuất ảnh PNG bảng xếp ca kiểu Excel bằng canvas thuần ----------
function exportSchedulePNG({ branchName, days, shifts, cellMap, capOf, note }) {
    const scale = 2;
    const cwShift = 170, cwDay = 132, cwNote = 210;
    const W = cwShift + cwDay * 7 + cwNote;
    const xs = [0, cwShift];
    for (let i = 1; i <= 7; i++) xs.push(xs[xs.length - 1] + cwDay);
    xs.push(W);
    const rhTitle = 42, rhSub = 30, rhHead = 46;

    const wrap = (ctx, text, maxW) => {
        const out = [];
        String(text || '').split('\n').forEach((para) => {
            let line = '';
            para.split(/\s+/).forEach((w) => {
                const t = line ? line + ' ' + w : w;
                if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; }
                else line = t;
            });
            out.push(line);
        });
        return out.filter((l, i) => l !== '' || i === out.length - 1);
    };

    // đo chiều cao từng hàng ca (Gói 37d: cộng thêm dòng giờ riêng)
    const rowHs = shifts.map((s) => {
        const sid = String(s.id);
        let maxN = 0, maxC = 0;
        days.forEach((d) => {
            const list = ((cellMap[sid] || {})[d] || []);
            maxN = Math.max(maxN, list.length);
            maxC = Math.max(maxC, list.filter((sc) => sc.is_custom).length);
        });
        return Math.max(66, 30 + maxN * 19 + maxC * 13 + 22);
    });
    const H = rhTitle + rhSub + rhHead + rowHs.reduce((a, b) => a + b, 0) + 2;

    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';

    const cell = (x, y, w, h, text, opts = {}) => {
        ctx.save();
        ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
        ctx.font = (opts.bold ? 'bold ' : '') + (opts.size || 12) + 'px Arial, "Segoe UI", sans-serif';
        ctx.fillStyle = opts.color || '#000';
        ctx.textAlign = opts.center === false ? 'left' : 'center';
        const lines = String(text ?? '').split('\n');
        const lh = (opts.size || 12) + 4;
        const tx = opts.center === false ? x + 8 : x + w / 2;
        const startY = y + h / 2 - (lines.length - 1) * lh / 2 + 0.5;
        lines.forEach((ln, i) => ctx.fillText(ln, tx, startY + i * lh));
        ctx.restore();
    };
    const hline = (y) => { ctx.strokeStyle = '#9aa1b5'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(1, y); ctx.lineTo(W - 1, y); ctx.stroke(); };
    const vlines = (y0, y1) => { ctx.strokeStyle = '#9aa1b5'; ctx.lineWidth = 1; xs.forEach((x) => { const lx = x === 0 ? 1 : x; ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y1); ctx.stroke(); }); };

    let y = 1;
    // Tiêu đề navy: đủ tên chi nhánh + tuần + ngày bắt đầu
    ctx.fillStyle = '#24305E'; ctx.fillRect(1, y, W - 2, rhTitle);
    cell(1, y, W - 2, rhTitle, 'LỊCH LÀM VIỆC TUẦN ' + ddMM(days[0]) + ' – ' + ddMM(days[6]), { bold: true, size: 16, color: '#fff' });
    y += rhTitle;
    ctx.fillStyle = '#eef0f8'; ctx.fillRect(1, y, W - 2, rhSub);
    cell(1, y, W - 2, rhSub, 'Chi nhánh: ' + branchName + '    ·    NGÀY BẮT ĐẦU: ' + fmtDate(days[0]) + ' (' + WD_UP[0] + ')', { size: 12, color: '#24305E' });
    hline(y); y += rhSub;
    // Hàng thứ/ngày
    ctx.fillStyle = '#e8ecf7'; ctx.fillRect(1, y, W - 2, rhHead);
    cell(xs[0], y, cwShift, rhHead, '', {});
    days.forEach((d, i) => cell(xs[i + 1], y, cwDay, rhHead, WD_UP[i] + '\n' + ddMM(d), { bold: true, size: 12, color: '#24305E' }));
    cell(xs[8], y, cwNote, rhHead, 'NOTE', { bold: true, size: 12, color: '#24305E' });
    vlines(y, y + rhHead); hline(y); y += rhHead;

    // Các hàng ca
    const noteTop = y;
    shifts.forEach((s, si) => {
        const rh = rowHs[si];
        const sid = String(s.id);
        cell(xs[0], y, cwShift, rh, s.name + '\n' + hhmm(s.start_time) + '–' + hhmm(s.end_time), { bold: true, size: 12, color: '#24305E', center: false });
        days.forEach((d, i) => {
            const list = ((cellMap[sid] || {})[d] || []);
            const cap = capOf(sid, d);
            const x = xs[i + 1];
            // tên NV (+ giờ riêng nếu có — Gói 37d)
            ctx.save();
            ctx.beginPath(); ctx.rect(x + 2, y + 2, cwDay - 4, rh - 4); ctx.clip();
            ctx.textAlign = 'center';
            let yy = y + 18;
            list.forEach((sc) => {
                ctx.font = '600 12px Arial, "Segoe UI", sans-serif';
                ctx.fillStyle = '#1d4ed8';
                ctx.fillText(sc.employee?.full_name || '', x + cwDay / 2, yy);
                yy += 19;
                if (sc.is_custom) {
                    ctx.font = '11px Arial, "Segoe UI", sans-serif';
                    ctx.fillStyle = '#b45309';
                    ctx.fillText(hhmm(sc.start_time) + '–' + hhmm(sc.end_time), x + cwDay / 2, yy);
                    yy += 13;
                }
            });
            // badge sức chứa
            if (cap != null) {
                const t = list.length + '/' + cap;
                ctx.font = 'bold 11px Arial, sans-serif';
                ctx.fillStyle = list.length > cap ? '#b91c1c' : (list.length === cap ? '#b45309' : '#475569');
                ctx.fillText(t, x + cwDay / 2, y + rh - 14);
            }
            ctx.restore();
        });
        vlines(y, y + rh); hline(y); y += rh;
    });
    // Cột NOTE (rowspan)
    if (note) {
        ctx.save();
        ctx.beginPath(); ctx.rect(xs[8] + 2, noteTop + 2, cwNote - 4, y - noteTop - 4); ctx.clip();
        ctx.font = '12px Arial, "Segoe UI", sans-serif';
        ctx.fillStyle = '#57534e'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const lines = wrap(ctx, note, cwNote - 16);
        lines.forEach((ln, i) => ctx.fillText(ln, xs[8] + 8, noteTop + 10 + i * 17));
        ctx.restore();
        ctx.textBaseline = 'middle';
    }
    vlines(noteTop, y);

    ctx.strokeStyle = '#24305E'; ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const a = document.createElement('a');
    a.download = 'lich-lam-viec-' + slug(branchName) + '-' + days[0] + '.png';
    a.href = cv.toDataURL('image/png');
    a.click();
}

// Gói 35/37: (a) Đăng ký ca của NV theo tuần, (b) Xếp ca kiểu Excel.
export default function Scheduling() {
    const { can } = useAuth();
    const [tab, setTab] = useState('sched');
    const [week, setWeek] = useState(() => fmtD(mondayOf(new Date())));
    const [branchId, setBranchId] = useState('');
    const [branches, setBranches] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [regs, setRegs] = useState({ days: [], registrations: [] });
    const [scheds, setScheds] = useState({ days: [], schedules: [], capacities: {}, note: null });
    const [loading, setLoading] = useState(false);
    // Gói 37: modals — {shiftId, date} | null
    const [assignCell, setAssignCell] = useState(null);
    const [assignSel, setAssignSel] = useState({}); // empId -> {on, cs, ce}
    const [capCell, setCapCell] = useState(null);
    const [capVal, setCapVal] = useState('');
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteVal, setNoteVal] = useState('');
    const [noteBid, setNoteBid] = useState(null); // Gói 37b: CN của modal ghi chú
    const [notesMap, setNotesMap] = useState({}); // Gói 37b: ghi chú theo CN ở chế độ tất cả
    const [setOpen, setSetOpen] = useState(false);
    const [dl, setDl] = useState({ weekday: '5', time: '20:00' }); // hạn chót đăng ký

    const days = weekDates(week);
    const weekLabel = ddMM(days[0]) + ' – ' + ddMM(days[6]);

    // audit #28: bọc try/catch như các fetch khác
    const fetchBase = useCallback(async () => {
        try {
            const [b, s] = await Promise.all([
                axios.get(API + '/branches'),
                axios.get(API + '/work-shifts', { params: { branch_id: branchId || undefined } }),
            ]);
            setBranches(b.data?.data || b.data || []);
            setShifts((s.data?.data || []).filter((x) => x.is_active));
        } catch (e) { alert(e.response?.data?.message || 'Tải chi nhánh / ca làm việc thất bại'); }
    }, [branchId]);
    const fetchRegs = useCallback(async () => {
        setLoading(true);
        try {
            const r = await axios.get(API + '/shift-registrations/week', { params: { week: days[0], branch_id: branchId || undefined } });
            setRegs(r.data?.data || { days: [], registrations: [] });
        } catch (e) { alert(e.response?.data?.message || 'Tải đăng ký thất bại'); }
        setLoading(false);
    }, [week, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
    const fetchSched = useCallback(async () => {
        setLoading(true);
        try {
            const [sc, e] = await Promise.all([
                axios.get(API + '/work-schedules/week', { params: { week: days[0], branch_id: branchId || undefined } }),
                axios.get(API + '/employees', { params: { branch_id: branchId || undefined, is_active: 1, per_page: 100 } }),
            ]);
            setScheds(sc.data?.data || { days: [], schedules: [], capacities: {}, note: null });
            setEmployees(e.data?.data?.data || e.data?.data || []);
        } catch (e2) { alert(e2.response?.data?.message || 'Tải lịch xếp ca thất bại'); }
        setLoading(false);
    }, [week, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
    const fetchDeadline = useCallback(async () => {
        try {
            const r = await axios.get(API + '/settings');
            const d = r.data || {};
            setDl({
                weekday: String(d.shift_reg_deadline_weekday ?? '5'),
                time: String(d.shift_reg_deadline_time ?? '20:00'),
            });
        } catch (e) { /* giữ mặc định */ }
    }, []);
    // Gói 37b: map ghi chú tuần theo chi nhánh (chế độ tất cả CN)
    const fetchNotesMap = useCallback(async () => {
        try {
            const r = await axios.get(API + '/schedule-notes/map', { params: { week: days[0] } });
            setNotesMap(r.data?.data || {});
        } catch (e) { setNotesMap({}); }
    }, [week]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { fetchBase(); }, [fetchBase]);
    useEffect(() => { fetchDeadline(); }, [fetchDeadline]);
    useEffect(() => { if (tab === 'reg') fetchRegs(); }, [tab, fetchRegs]);
    // Gói 41: tab Xếp ca cũng cần danh sách đăng ký để hiện khung "chờ duyệt" đồng bộ
    useEffect(() => { if (tab === 'sched') { fetchSched(); fetchRegs(); if (!branchId) fetchNotesMap(); } }, [tab, fetchSched, fetchRegs, fetchNotesMap, branchId]);
    // Gói 42: nháp xếp ca — key `${bid}|${sid}|${date}` -> {empId: {on, cs, ce}}; bấm Lưu của CN mới lưu thật
    // (khai báo trước useEffect để dependency array không dính TDZ)
    const [drafts, setDrafts] = useState({});
    const [branchConfirm, setBranchConfirm] = useState(null); // {bid, branchName, cells: [{sid, date, shiftName, dateLabel, added, changed, removed}]}
    const [savingBranch, setSavingBranch] = useState(null); // bid đang lưu
    // Gói 42: giữ nháp kể cả tắt trang (theo tuần) — quản lý xếp nhiều lần mới xong
    const draftKey = 'sched_drafts_' + (days[0] || '');
    useEffect(() => {
        try { setDrafts(JSON.parse(localStorage.getItem(draftKey)) || {}); }
        catch { setDrafts({}); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftKey]);
    useEffect(() => {
        try { localStorage.setItem(draftKey, JSON.stringify(drafts)); } catch { /* bỏ qua */ }
    }, [draftKey, drafts]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);
    const editable = can('staff.edit');
    const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] w-full';
    const shiftWeek = (delta) => { const m = mondayOf(week); m.setDate(m.getDate() + delta * 7); setWeek(fmtD(m)); };
    const branchName = branches.find((b) => String(b.id) === String(branchId))?.name || 'Tất cả chi nhánh';

    // Gói 37b: chế độ "Tất cả chi nhánh" → tách mỗi CN 1 bảng riêng
    const branchesToShow = (() => {
        if (!branchId) return branches;
        const f = branches.find((b) => String(b.id) === String(branchId));
        return f ? [f] : [{ id: branchId, name: branchName }];
    })();
    const empsOf = (bid) => employees.filter((e) => String(e.branch_id) === String(bid));
    const schedsOf = (bid) => (scheds.schedules || []).filter((sc) => String(sc.employee?.branch_id) === String(bid));
    const noteOf = (bid) => (branchId ? scheds.note : (notesMap[String(bid)] ?? null));
    // Gói 37c: ca dùng chung (branch_id null) hiện ở mọi CN
    const shiftsOf = (bid) => shifts.filter((s) => s.branch_id == null || String(s.branch_id) === String(bid));

    // Gói 37: map ô [shiftId][date] -> [schedules] (Gói 37b: nhận list riêng từng CN)
    const cellMapOf = (list) => {
        const map = {};
        (list || []).forEach((sc) => {
            const sid = String(sc.work_shift_id);
            (map[sid] = map[sid] || {});
            (map[sid][sc.date] = map[sid][sc.date] || []).push(sc);
        });
        return map;
    };
    const capOf = (shiftId, date) => {
        const v = (scheds.capacities || {})[String(shiftId)]?.[weekdayOf(date)];
        return v == null ? null : v;
    };

    // ---- Popup gán NV cho 1 ô ca×ngày (Gói 37b: theo chi nhánh của bảng) ----
    const openAssignCell = (shiftId, date, bid, branchEmps, branchCm) => {
        const sid = String(shiftId);
        const list = ((branchCm[sid] || {})[date] || []);
        const dkey = bid + '|' + sid + '|' + date;
        const draft = drafts[dkey]; // Gói 42: mở lại thì hiện nháp cũ
        const init = {};
        branchEmps.forEach((e) => {
            const eid = String(e.id);
            if (draft && draft[eid]) {
                init[eid] = { on: !!draft[eid].on, cs: draft[eid].cs || '', ce: draft[eid].ce || '' };
            } else {
                const ex = list.find((sc) => String(sc.employee_id) === String(e.id));
                init[eid] = { on: !!ex, cs: ex ? hhmm(ex.custom_start_time || '') : '', ce: ex ? hhmm(ex.custom_end_time || '') : '' };
            }
        });
        setAssignSel(init);
        setAssignCell({ shiftId: sid, date, branchId: bid, emps: branchEmps, cm: branchCm, dkey });
    };
    // audit #32: chống bấm 2 lần cho các modal còn lại
    const [savingCap, setSavingCap] = useState(false);
    const [savingNote, setSavingNote] = useState(false);
    const [savingSet, setSavingSet] = useState(false);
    // Gói 42: Lưu nháp ô ca (chưa lưu lên server) — bấm nút Lưu của chi nhánh mới lưu thật
    const saveDraft = () => {
        if (!assignCell) return;
        const { shiftId, date, emps, cm: bcm, dkey } = assignCell;
        for (const e of emps) {
            const sel = assignSel[String(e.id)];
            const cs = (sel?.cs || '').slice(0, 5), ce = (sel?.ce || '').slice(0, 5);
            if (cs && !valid24(cs)) return alert('Giờ vào riêng của ' + e.full_name + ' sai định dạng HH:MM');
            if (ce && !valid24(ce)) return alert('Giờ ra riêng của ' + e.full_name + ' sai định dạng HH:MM');
        }
        const list = ((bcm[String(shiftId)] || {})[date] || []);
        const exByEmp = {};
        list.forEach((sc) => { exByEmp[String(sc.employee_id)] = sc; });
        let changed = false;
        const nd = {};
        emps.forEach((e) => {
            const eid = String(e.id);
            const sel = assignSel[eid];
            const ex = exByEmp[eid];
            const on = !!sel?.on;
            const cs = (sel?.cs || '').slice(0, 5) || '', ce = (sel?.ce || '').slice(0, 5) || '';
            nd[eid] = { on, cs, ce };
            const sameTime = hhmm(ex?.custom_start_time || '') === cs && hhmm(ex?.custom_end_time || '') === ce;
            if (on !== !!ex || (on && !sameTime)) changed = true;
        });
        const ndrafts = { ...drafts };
        if (changed) ndrafts[dkey] = nd;
        else delete ndrafts[dkey]; // nháp trùng hệt đã lưu → xóa nháp
        setDrafts(ndrafts);
        setAssignCell(null);
    };

    // Gói 42: mở bảng xác nhận lưu tất cả ô nháp của chi nhánh
    const openBranchConfirm = (bid) => {
        const bCm = cellMapOf(schedsOf(bid));
        const bEmps = empsOf(bid);
        const cells = [];
        Object.keys(drafts).forEach((k) => {
            if (!k.startsWith(bid + '|')) return;
            const [, sid, date] = k.split('|');
            const draft = drafts[k];
            const list = ((bCm[sid] || {})[date] || []);
            const exByEmp = {};
            list.forEach((sc) => { exByEmp[String(sc.employee_id)] = sc; });
            const added = [], changed = [], removed = [];
            Object.keys(draft).forEach((eid) => {
                const sel = draft[eid];
                const ex = exByEmp[eid];
                const emp = bEmps.find((e) => String(e.id) === eid);
                const nm = emp?.full_name || ('#' + eid);
                const cs = (sel.cs || '').slice(0, 5), ce = (sel.ce || '').slice(0, 5);
                if (sel.on && !ex) added.push({ name: nm, cs, ce });
                else if (sel.on && ex) {
                    const same = hhmm(ex.custom_start_time || '') === cs && hhmm(ex.custom_end_time || '') === ce;
                    if (!same) changed.push({ name: nm, cs, ce });
                } else if (!sel.on && ex) removed.push(nm);
            });
            if (!added.length && !changed.length && !removed.length) return;
            const sh = shifts.find((x) => String(x.id) === sid);
            cells.push({ sid, date, shiftName: sh ? sh.name : '', dateLabel: WD[weekdayOf(date)] + ' ' + ddMM(date), added, changed, removed });
        });
        if (!cells.length) return alert('Không có thay đổi nào để lưu.');
        const b = branches.find((x) => String(x.id) === String(bid));
        setBranchConfirm({ bid, branchName: b?.name || '', cells });
    };

    // Gói 42: lưu thật tất cả ô nháp của chi nhánh (1 API batch)
    const doBranchSave = async () => {
        const { bid, cells } = branchConfirm;
        setBranchConfirm(null);
        setSavingBranch(bid);
        const bCm = cellMapOf(schedsOf(bid));
        const items = [], deletes = [];
        cells.forEach((c) => {
            const list = ((bCm[String(c.sid)] || {})[c.date] || []);
            const exByEmp = {};
            list.forEach((sc) => { exByEmp[String(sc.employee_id)] = sc.id; });
            const draft = drafts[bid + '|' + c.sid + '|' + c.date] || {};
            Object.keys(draft).forEach((eid) => {
                const sel = draft[eid];
                if (sel.on) {
                    items.push({
                        employee_id: Number(eid), work_shift_id: Number(c.sid), date: c.date,
                        branch_id: bid || undefined,
                        custom_start_time: (sel.cs || '').slice(0, 5) || null,
                        custom_end_time: (sel.ce || '').slice(0, 5) || null,
                    });
                } else if (exByEmp[eid]) {
                    deletes.push(exByEmp[eid]);
                }
            });
        });
        try {
            await axios.post(API + '/work-schedules/batch-save', { items, deletes });
            const nd = { ...drafts };
            Object.keys(nd).forEach((k) => { if (k.startsWith(bid + '|')) delete nd[k]; });
            setDrafts(nd);
            fetchSched();
        } catch (e) { alert(e.response?.data?.message || 'Lưu lịch thất bại'); }
        setSavingBranch(null);
    };

    // Gói 42: bỏ tất cả nháp của chi nhánh
    const discardDrafts = (bid) => {
        if (!window.confirm('Bỏ tất cả các ô đang nháp của chi nhánh này?')) return;
        const nd = { ...drafts };
        Object.keys(nd).forEach((k) => { if (k.startsWith(bid + '|')) delete nd[k]; });
        setDrafts(nd);
    };

    // ---- Sức chứa ô ca×ngày ----
    const openCap = (shiftId, date) => {
        const cur = capOf(shiftId, date);
        setCapVal(cur == null ? '' : String(cur));
        setCapCell({ shiftId: String(shiftId), date });
    };
    // audit #32: cờ saving + disabled nút (copy pattern savingCell)
    const saveCap = async () => {
        if (savingCap) return;
        const v = capVal.trim() === '' ? null : parseInt(capVal, 10);
        if (v !== null && !(v >= 1 && v <= 100)) return alert('Nhập số từ 1 đến 100, hoặc để trống = không giới hạn');
        setSavingCap(true);
        try {
            await axios.post(API + '/work-shift-capacities', {
                work_shift_id: Number(capCell.shiftId), weekday: weekdayOf(capCell.date), max_staff: v,
            });
            setCapCell(null);
            fetchSched();
        } catch (e) { alert(e.response?.data?.message || 'Lưu sức chứa thất bại'); }
        setSavingCap(false);
    };

    // ---- Ghi chú tuần (Gói 37b: theo chi nhánh của bảng) ----
    const openNote = (bid) => { setNoteBid(bid); setNoteVal(noteOf(bid) || ''); setNoteOpen(true); };
    const saveNote = async () => {
        if (savingNote) return;
        setSavingNote(true);
        try {
            await axios.put(API + '/schedule-notes', {
                week: days[0], branch_id: noteBid || null, note: noteVal.trim() || null,
            });
            setNoteOpen(false);
            fetchSched();
            if (!branchId) fetchNotesMap();
        } catch (e) { alert(e.response?.data?.message || 'Lưu ghi chú thất bại'); }
        setSavingNote(false);
    };

    // ---- Cài đặt hạn chót ----
    const [dlForm, setDlForm] = useState({ weekday: '5', time: '20:00' });
    const openSettings = () => { setDlForm({ ...dl }); setSetOpen(true); };
    const saveSettings = async () => {
        if (savingSet) return;
        if (!valid24(dlForm.time)) return alert('Giờ chốt chưa đúng định dạng HH:MM (VD: 20:00)');
        setSavingSet(true);
        try {
            await axios.post(API + '/settings', { settings: {
                shift_reg_deadline_weekday: String(dlForm.weekday),
                shift_reg_deadline_time: dlForm.time,
            } });
            setDl({ ...dlForm });
            setSetOpen(false);
            alert('Đã lưu hạn chót đăng ký ca.');
        } catch (e) { alert(e.response?.data?.message || 'Lưu cài đặt thất bại'); }
        setSavingSet(false);
    };

    // ---- B2: duyệt / từ chối đăng ký ca ----
    const approveReg = async (id) => {
        try {
            await axios.post(API + '/shift-registrations/' + id + '/approve');
            fetchRegs();
        } catch (e) { alert(e.response?.data?.message || 'Duyệt thất bại'); }
    };
    const rejectReg = async (id) => {
        const note = window.prompt('Lý do từ chối (không bắt buộc):');
        if (note === null) return; // bấm Hủy → thôi
        try {
            await axios.post(API + '/shift-registrations/' + id + '/reject', { note: note.trim() || null });
            fetchRegs();
            if (tab === 'sched') fetchSched();
        } catch (e) { alert(e.response?.data?.message || 'Từ chối thất bại'); }
    };
    // Gói 41: duyệt + tự động xếp NV vào ca ngay trên bảng Xếp ca
    const approveRegSched = async (r) => {
        try {
            await axios.post(API + '/shift-registrations/' + r.id + '/approve-and-assign');
            fetchRegs(); fetchSched();
        } catch (e) { alert(e.response?.data?.message || 'Duyệt & xếp ca thất bại'); }
    };

    // Gói 37b: xuất PNG theo từng bảng chi nhánh
    const doExport = (b) => {
        const bid = String(b.id);
        const bShifts = shiftsOf(bid);
        if (!bShifts.length) return alert('Chưa có ca làm việc nào');
        // Gói 42: ảnh PNG xuất theo lịch ĐÃ LƯU — báo nếu còn nháp chưa lưu
        const bcnt = Object.keys(drafts).filter((k) => k.startsWith(bid + '|')).length;
        if (bcnt > 0 && !window.confirm('Còn ' + bcnt + ' ô chưa lưu. Xuất ảnh theo lịch ĐÃ LƯU (không gồm nháp)?')) return;
        exportSchedulePNG({ branchName: b.name, days, shifts: bShifts, cellMap: cellMapOf(schedsOf(bid)), capOf, note: noteOf(bid) });
    };

    const dlWdName = WD_FULL[parseInt(dl.weekday, 10)] || 'Thứ 7';

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">Đăng ký & Xếp ca</h1>
                    <button onClick={() => shiftWeek(-1)} className="px-3 py-2 rounded border border-gray-300 text-[13px]">‹ Trước</button>
                    <DateInput value={week} onChange={(v) => v && setWeek(startOfWeek(v))} className="border border-gray-300 rounded px-3 py-2 text-[13px]" title="Chọn ngày bất kỳ — tự lấy về Thứ 2 tuần đó" />
                    <button onClick={() => shiftWeek(1)} className="px-3 py-2 rounded border border-gray-300 text-[13px]">Sau ›</button>
                    <button onClick={() => setWeek(fmtD(mondayOf(new Date())))} className="px-3 py-2 rounded border border-gray-300 text-[13px]">Tuần này</button>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <div className="ml-auto flex gap-2">
                        {tab === 'sched' && editable && <button onClick={openSettings} className="px-4 py-2 rounded border border-gray-300 text-[13px]">⚙ Cài đặt</button>}
                    </div>
                </div>

                <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-4">
                    {[['sched', 'Xếp ca'], ['reg', 'Đăng ký']].map(([k, l]) => (
                        <button key={k} onClick={() => setTab(k)} className={'px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px ' + (tab === k ? 'border-[#0d6efd] text-[#0d6efd] font-medium' : 'border-transparent text-gray-500')}>{l}</button>
                    ))}
                </div>

                {loading && <div className="text-gray-500 text-sm py-10 text-center">Đang tải...</div>}

                {/* ============ TAB ĐĂNG KÝ · Gói 37c: cấu trúc giống bảng Xếp ca (hàng=ca, cột=ngày) ============ */}
                {tab === 'reg' && !loading && branchesToShow.map((b) => {
                    const bid = String(b.id);
                    const bShifts = shiftsOf(bid);
                    // map [shiftId][date] -> [đăng ký] của CN này
                    const rmap = {};
                    (regs.registrations || []).forEach((r) => {
                        if (String(r.employee?.branch_id) !== bid) return;
                        const sid = String(r.work_shift_id);
                        (rmap[sid] = rmap[sid] || {});
                        (rmap[sid][r.date] = rmap[sid][r.date] || []).push(r);
                    });
                    const hasAny = Object.keys(rmap).length > 0;
                    if (!hasAny) return null;
                    return (
                    <div key={bid} className="mb-6">
                        <div className="rounded-xl p-4 mb-3 text-white" style={{ background: '#24305E' }}>
                            <div className="font-extrabold text-[17px] tracking-wide">ĐĂNG KÝ CA TUẦN {weekLabel}</div>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[13px] text-[#dbe1f5]">
                                <span>Chi nhánh: <b className="text-white">{b.name}</b></span>
                                <span>NGÀY BẮT ĐẦU: <b className="text-white">{fmtDate(days[0])} ({WD_UP[0]})</b></span>
                            </div>
                            <div className="mt-2 text-[12px] text-[#ffe1a8]">⏰ Hạn đăng ký ca: <b>{dlWdName}, {dl.time}</b> · áp dụng cho tuần trước tuần được đăng ký · 🔒 Gửi xong được gửi lại 1 lần rồi khóa</div>
                        </div>
                        <div className="m-card overflow-x-auto">
                            <table className="w-full text-[13px] min-w-[1020px] border-collapse">
                                <thead>
                                    <tr className="bg-[#eef0f8]">
                                        <th className="px-3 py-3 text-left font-bold text-[#24305E] border border-gray-200 min-w-[150px] sticky left-0 bg-[#eef0f8] z-10">Ca</th>
                                        {days.map((d, i) => (
                                            <th key={d} className={'px-2 py-2 border border-gray-200 text-center min-w-[120px] ' + (i === 6 ? 'bg-[#fff6e3]' : '')}>
                                                <div className={'font-extrabold text-[12px] ' + (i === 6 ? 'text-[#b45309]' : 'text-[#24305E]')}>{WD_UP[i]}</div>
                                                <div className="font-semibold text-[11px] text-gray-500">{ddMM(d)}</div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {bShifts.map((s) => {
                                        const sid = String(s.id);
                                        return (
                                            <tr key={s.id}>
                                                <td className="px-3 py-2 border border-gray-200 bg-[#f8fafc] sticky left-0 z-10 align-top">
                                                    <div className="font-bold text-[#24305E] text-[13px]">{s.name}</div>
                                                    <div className="text-[11px] text-gray-500 font-mono">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                                                </td>
                                                {days.map((d) => {
                                                    const list = ((rmap[sid] || {})[d] || []);
                                                    return (
                                                        <td key={d} className="px-2 py-2 border border-gray-200 align-top min-w-[120px]">
                                                            {list.length === 0
                                                                ? <span className="text-gray-300 text-[12px]">—</span>
                                                                : list.map((r) => (
                                                                    <div key={r.id} className={'font-semibold text-[13px] leading-[1.55] ' + (r.status === 'approved' ? 'text-green-700' : r.status === 'rejected' ? 'text-red-400 line-through' : 'text-[#1d4ed8]')}>
                                                                        <span>{r.employee?.full_name}</span>
                                                                        {editable && r.status === 'submitted' && (
                                                                            <span className="ml-1 whitespace-nowrap">
                                                                                <button onClick={() => approveReg(r.id)} title="Duyệt" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-[12px] font-bold mr-1">✓</button>
                                                                                <button onClick={() => rejectReg(r.id)} title="Từ chối" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-[12px] font-bold">✕</button>
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                    {bShifts.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Chưa có ca làm việc nào.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        <div className="mt-2 text-[11px] text-gray-500 px-1">Màu chữ: <span className="text-[#1d4ed8] font-semibold">xanh = chờ duyệt</span> · <span className="text-green-700 font-semibold">xanh lá = đã duyệt</span> · <span className="text-red-400 font-semibold line-through">gạch ngang = từ chối</span></div>
                    </div>
                    );
                })}
                {tab === 'reg' && !loading && !branchesToShow.some((b) => (regs.registrations || []).some((r) => String(r.employee?.branch_id) === String(b.id))) && (
                    <div className="m-card px-4 py-8 text-center text-gray-400 text-[13px]">Chưa có đăng ký ca tuần này.</div>
                )}

                {/* ============ TAB XẾP CA — kiểu Excel (Gói 37) · Gói 37b: mỗi CN 1 bảng riêng ============ */}
                {tab === 'sched' && !loading && branchesToShow.map((b) => {
                    const bid = String(b.id);
                    const bEmps = empsOf(bid);
                    const bShifts = shiftsOf(bid);
                    const bCm = cellMapOf(schedsOf(bid));
                    const bNote = noteOf(bid);
                    // Gói 41: đăng ký chờ duyệt của CN này -> [shiftId][date] để hiện trong ô xếp ca
                    const bPend = {};
                    (regs.registrations || []).forEach((r) => {
                        if (r.status !== 'submitted') return;
                        if (String(r.employee?.branch_id) !== bid) return;
                        const psid = String(r.work_shift_id);
                        (bPend[psid] = bPend[psid] || {});
                        (bPend[psid][r.date] = bPend[psid][r.date] || []).push(r);
                    });
                    return (
                    <div key={bid} className="mb-6">
                        <div className="rounded-xl p-4 mb-3 text-white" style={{ background: '#24305E' }}>
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="font-extrabold text-[17px] tracking-wide">LỊCH LÀM VIỆC TUẦN {weekLabel}</div>
                                <button onClick={() => doExport(b)} className="ml-auto px-3 py-1.5 rounded bg-[#F5A623] text-[#24305E] text-[12px] font-semibold">⬇ Xuất ảnh PNG</button>
                                {editable && (() => {
                                    // Gói 42: nút Lưu theo chi nhánh — lưu tất cả ô đang nháp (bấm được nhiều lần)
                                    const bcnt = Object.keys(drafts).filter((k) => k.startsWith(bid + '|')).length;
                                    const dis = bcnt === 0 || savingBranch === bid;
                                    return (<>
                                        <button onClick={() => openBranchConfirm(bid)} disabled={dis}
                                            className={'px-3 py-1.5 rounded text-[12px] font-semibold ' + (dis ? 'bg-gray-500 text-gray-200' : 'bg-green-600 text-white')}>
                                            {savingBranch === bid ? 'Đang lưu...' : '💾 Lưu' + (bcnt ? ' (' + bcnt + ')' : '')}
                                        </button>
                                        {bcnt > 0 && <button onClick={() => discardDrafts(bid)} className="text-[12px] text-red-300 underline">Bỏ nháp</button>}
                                    </>);
                                })()}
                            </div>
                            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-[13px] text-[#dbe1f5]">
                                <span>Chi nhánh: <b className="text-white">{b.name}</b></span>
                                <span>NGÀY BẮT ĐẦU: <b className="text-white">{fmtDate(days[0])} ({WD_UP[0]})</b></span>
                            </div>
                            <div className="mt-2 text-[12px] text-[#ffe1a8]">⏰ Hạn đăng ký ca: <b>{dlWdName}, {dl.time}</b> · áp dụng cho tuần trước tuần được đăng ký · 🔒 Gửi xong được gửi lại 1 lần rồi khóa</div>
                        </div>

                        <div className="m-card overflow-x-auto">
                            <table className="w-full text-[13px] min-w-[1020px] border-collapse">
                                <thead>
                                    <tr className="bg-[#eef0f8]">
                                        <th className="px-3 py-3 text-left font-bold text-[#24305E] border border-gray-200 min-w-[150px] sticky left-0 bg-[#eef0f8] z-10">Ca</th>
                                        {days.map((d, i) => (
                                            <th key={d} className={'px-2 py-2 border border-gray-200 text-center min-w-[120px] ' + (i === 6 ? 'bg-[#fff6e3]' : '')}>
                                                <div className={'font-extrabold text-[12px] ' + (i === 6 ? 'text-[#b45309]' : 'text-[#24305E]')}>{WD_UP[i]}</div>
                                                <div className="font-semibold text-[11px] text-gray-500">{ddMM(d)}</div>
                                            </th>
                                        ))}
                                        <th className="px-3 py-3 font-bold text-[#24305E] border border-gray-200 min-w-[190px]">NOTE</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bShifts.map((s, si) => {
                                        const sid = String(s.id);
                                        return (
                                            <tr key={s.id}>
                                                <td className="px-3 py-2 border border-gray-200 bg-[#f8fafc] sticky left-0 z-10 align-top">
                                                    <div className="font-bold text-[#24305E] text-[13px]">{s.name}</div>
                                                    <div className="text-[11px] text-gray-500 font-mono">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                                                </td>
                                                {days.map((d) => {
                                                    const list = ((bCm[sid] || {})[d] || []);
                                                    const cap = capOf(sid, d);
                                                    const dkey = bid + '|' + sid + '|' + d;
                                                    const draft = drafts[dkey]; // Gói 42: có nháp thì hiện nội dung nháp
                                                    const shown = draft
                                                        ? bEmps.filter((e) => draft[String(e.id)]?.on).map((e) => {
                                                            const sel = draft[String(e.id)];
                                                            return { id: 'draft-' + e.id, employee: e, is_custom: !!(sel.cs || sel.ce), start_time: sel.cs || '', end_time: sel.ce || '' };
                                                        })
                                                        : list;
                                                    const over = cap != null && shown.length > cap;
                                                    const full = cap != null && shown.length === cap;
                                                    const pend = ((bPend[sid] || {})[d] || []); // Gói 41: đăng ký chờ duyệt
                                                    return (
                                                        <td key={d} className="px-2 py-2 border border-gray-200 align-top hover:bg-[#f6f8ff] cursor-pointer min-w-[120px]"
                                                            onClick={() => editable && openAssignCell(sid, d, bid, bEmps, bCm)} title={editable ? 'Bấm để gán nhân viên' : ''}>
                                                            {shown.length === 0 && pend.length === 0 && <div className="text-gray-300 text-[12px]">+ Gán</div>}
                                                            {shown.map((sc) => (
                                                                <div key={sc.id} className="text-[#1d4ed8] font-semibold text-[13px] leading-[1.55]">
                                                                    {sc.employee?.full_name}
                                                                    {sc.is_custom && <div className="text-[11px] font-medium text-[#b45309]">✎ {hhmm(sc.start_time)}–{hhmm(sc.end_time)}</div>}
                                                                </div>
                                                            ))}
                                                            {draft && <div><span className="inline-block mt-1 text-[10px] font-bold text-[#b45309] bg-[#fef3c7] border border-[#fcd34d] rounded-full px-2 py-0.5">● chưa lưu</span></div>}
                                                            {pend.length > 0 && (
                                                                <div className="mt-1.5 border-[1.5px] border-dashed border-[#F5A623] rounded-lg px-1.5 py-1 bg-[#fffaf0]" onClick={(e) => e.stopPropagation()}>
                                                                    <div className="text-[10px] font-bold text-[#b45309] mb-0.5">📝 Chờ duyệt ({pend.length})</div>
                                                                    {pend.map((r) => (
                                                                        <div key={r.id} className="flex items-center gap-1 py-0.5">
                                                                            <span className="flex-1 text-[12px] font-semibold text-[#92400e] truncate">{r.employee?.full_name}</span>
                                                                            {editable && (<span className="whitespace-nowrap">
                                                                                <button onClick={() => approveRegSched(r)} title="Duyệt & tự xếp vào ca" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-[12px] font-bold mr-1">✓</button>
                                                                                <button onClick={() => rejectReg(r.id)} title="Từ chối" className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-[12px] font-bold">✕</button>
                                                                            </span>)}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <span
                                                                className={'inline-block mt-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full cursor-pointer ' + (over ? 'bg-red-100 text-red-700' : full ? 'bg-[#fff3e0] text-[#b45309]' : 'bg-[#eef0f8] text-[#24305E]')}
                                                                onClick={(e) => { e.stopPropagation(); if (editable) openCap(sid, d); }}
                                                                title={editable ? 'Bấm để sửa sức chứa ô này' : ''}>
                                                                {shown.length}/{cap == null ? '∞' : cap}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
                                                {si === 0 && (
                                                    <td rowSpan={bShifts.length} className="px-3 py-2 border border-gray-200 align-top bg-[#fffdf4] cursor-pointer min-w-[190px] max-w-[230px]"
                                                        onClick={() => editable && openNote(bid)} title={editable ? 'Bấm để sửa ghi chú tuần' : ''}>
                                                        <div className="text-[12px] text-[#57534e] leading-[1.6] whitespace-pre-line">{bNote || <span className="text-gray-300">+ Thêm ghi chú</span>}</div>
                                                        {editable && <div className="mt-2 text-[11px] text-[#b45309] font-semibold">✎ Bấm để sửa ghi chú tuần</div>}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                    {bShifts.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Chưa có ca làm việc nào. Thêm ca ở mục Chấm công → Ca làm việc.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    );
                })}
            </div>

            {/* Popup gán NV cho ô ca×ngày */}
            {assignCell && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setAssignCell(null)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[430px] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="p-5 pb-3 shrink-0">
                        {(() => {
                            const s = shifts.find((x) => String(x.id) === String(assignCell.shiftId));
                            const cap = capOf(assignCell.shiftId, assignCell.date);
                            // audit #27: đếm từ assignSel (lựa chọn hiện tại), không phải dữ liệu cũ trong ô
                            const n = Object.values(assignSel).filter((x) => x?.on).length;
                            return (<>
                                <h2 className="font-bold text-[16px] text-[#24305E]">{s?.name} · {WD[weekdayOf(assignCell.date)]} {ddMM(assignCell.date)}</h2>
                                <p className="text-[12px] text-gray-500 mt-1 mb-3">{s ? hhmm(s.start_time) + '–' + hhmm(s.end_time) : ''} — sức chứa ô này: <b>{cap == null ? '∞' : cap}</b> người. Bấm tên để chọn/bỏ chọn; giờ riêng để trống = theo giờ ca.</p>
                                <div className="text-[13px] font-semibold text-[#24305E] mb-1">Đã chọn: {n}{cap != null ? '/' + cap : ''} người</div>
                            </>);
                        })()}
                        </div>
                        <div className="flex-1 overflow-y-auto px-5">
                        <div className="divide-y divide-gray-100">
                            {(assignCell.emps || []).map((e) => {
                                const eid = String(e.id);
                                const sel = assignSel[eid] || {};
                                return (
                                    <div key={e.id} className="py-2">
                                        <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                                            <input type="checkbox" checked={!!sel.on} onChange={() => setAssignSel({ ...assignSel, [eid]: { ...sel, on: !sel.on } })} className="w-5 h-5 accent-[#24305E]" />
                                            <span className={'text-[14px] ' + (sel.on ? 'font-semibold text-[#24305E]' : '')}>{e.full_name}</span>
                                        </label>
                                        {sel.on && (
                                            <div className="grid grid-cols-2 gap-2 mt-1 ml-8">
                                                <TimeInput value={sel.cs || ''} onChange={(v) => setAssignSel({ ...assignSel, [eid]: { ...sel, cs: v } })} className={inp} placeholder="Giờ vào riêng" />
                                                <TimeInput value={sel.ce || ''} onChange={(v) => setAssignSel({ ...assignSel, [eid]: { ...sel, ce: v } })} className={inp} placeholder="Giờ ra riêng" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {(assignCell.emps || []).length === 0 && <div className="py-6 text-center text-gray-400 text-[13px]">Chưa có nhân viên.</div>}
                        </div>
                        </div>
                        {/* Gói 41b: nút Hủy/Lưu dính đáy popup — luôn thấy được kể cả danh sách dài */}
                        <div className="p-4 pt-3 border-t border-gray-100 shrink-0 bg-white">
                        <div className="flex gap-2">
                            <button onClick={() => setAssignCell(null)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                            <button onClick={saveDraft} className="flex-1 h-11 rounded-xl text-white text-[14px] font-semibold bg-[#24305E]">Lưu nháp</button>
                        </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Gói 42: Xác nhận lưu tất cả ô nháp của chi nhánh */}
            {branchConfirm && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={() => setBranchConfirm(null)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[460px] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="p-5 pb-2 shrink-0">
                        <h2 className="font-bold text-[16px] text-[#24305E]">✋ Xác nhận lưu lịch</h2>
                        <p className="text-[12px] text-gray-500 mt-1 mb-3">Chi nhánh <b>{branchConfirm.branchName}</b> · tuần {weekLabel} — các thay đổi dưới đây sẽ được lưu:</p>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5">
                        {branchConfirm.cells.map((c, ci) => (
                            <div key={ci} className="py-2 border-b border-dashed border-gray-200">
                                <div className="font-bold text-[13px] text-[#24305E]">{c.shiftName} · {c.dateLabel}</div>
                                {c.added.map((a, i) => (
                                    <div key={'a' + i} className="flex justify-between py-1 text-[13px]">
                                        <span className="text-green-700 font-medium">＋ Thêm</span>
                                        <b>{a.name}{a.cs || a.ce ? <span className="font-mono font-normal text-gray-500"> ({a.cs || '…'}–{a.ce || '…'})</span> : ''}</b>
                                    </div>
                                ))}
                                {c.changed.map((a, i) => (
                                    <div key={'c' + i} className="flex justify-between py-1 text-[13px]">
                                        <span className="text-[#b45309] font-medium">✎ Đổi giờ</span>
                                        <b>{a.name}<span className="font-mono font-normal text-gray-500"> ({a.cs || '…'}–{a.ce || '…'})</span></b>
                                    </div>
                                ))}
                                {c.removed.map((n, i) => (
                                    <div key={'r' + i} className="flex justify-between py-1 text-[13px]">
                                        <span className="text-red-600 font-medium">－ Bỏ</span>
                                        <b>{n}</b>
                                    </div>
                                ))}
                            </div>
                        ))}
                        </div>
                        <div className="p-4 pt-3 border-t border-gray-100 shrink-0 bg-white">
                        <div className="flex gap-2">
                            <button onClick={() => setBranchConfirm(null)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">← Quay lại</button>
                            <button onClick={doBranchSave} className="flex-1 h-11 rounded-xl text-white text-[14px] font-semibold bg-[#16a34a]">Xác nhận lưu</button>
                        </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal sức chứa */}
            {capCell && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setCapCell(null)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[380px] p-5" onClick={(e) => e.stopPropagation()}>
                        <h2 className="font-bold text-[16px] text-[#24305E]">Sức chứa ô ca × ngày</h2>
                        <p className="text-[12px] text-gray-500 mt-1 mb-3">Số nhân viên tối đa cho ô này. Để trống = không giới hạn.</p>
                        <input type="number" min="1" max="100" inputMode="numeric" value={capVal}
                            onChange={(e) => setCapVal(e.target.value)} placeholder="VD: 5 (trống = ∞)"
                            className={inp} />
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setCapCell(null)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                            <button onClick={saveCap} disabled={savingCap} className={'flex-1 h-11 rounded-xl text-white text-[14px] font-semibold ' + (savingCap ? 'bg-gray-400' : 'bg-[#24305E]')}>{savingCap ? 'Đang lưu...' : 'Lưu'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal ghi chú tuần */}
            {noteOpen && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setNoteOpen(false)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[430px] p-5" onClick={(e) => e.stopPropagation()}>
                        <h2 className="font-bold text-[16px] text-[#24305E]">Ghi chú tuần {weekLabel}{noteBid ? ' · ' + (branches.find((b) => String(b.id) === String(noteBid))?.name || '') : ''}</h2>
                        <p className="text-[12px] text-gray-500 mt-1 mb-3">Ghi chú chung của bảng tuần này (VD: phân công Tiktok, WC, cửa kính…).</p>
                        <textarea value={noteVal} onChange={(e) => setNoteVal(e.target.value)} rows={6} className={inp + ' leading-[1.6]'} placeholder={'Tiktok: Phúc +\nWC: Uyên'} />
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setNoteOpen(false)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                            <button onClick={saveNote} disabled={savingNote} className={'flex-1 h-11 rounded-xl text-white text-[14px] font-semibold ' + (savingNote ? 'bg-gray-400' : 'bg-[#24305E]')}>{savingNote ? 'Đang lưu...' : 'Lưu ghi chú'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal cài đặt hạn chót */}
            {setOpen && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setSetOpen(false)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[380px] p-5" onClick={(e) => e.stopPropagation()}>
                        <h2 className="font-bold text-[16px] text-[#24305E]">⚙ Cài đặt đăng ký ca</h2>
                        <p className="text-[12px] text-gray-500 mt-1 mb-3">Hạn chót áp dụng cho <b>tuần trước</b> tuần được đăng ký. Sau hạn chót, nhân viên không chỉnh sửa/gửi đăng ký ca được.</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[12px] text-gray-500">Ngày chốt</label>
                                <select value={dlForm.weekday} onChange={(e) => setDlForm({ ...dlForm, weekday: e.target.value })} className={inp + ' mt-1'}>
                                    {WD_FULL.map((w, i) => <option key={i} value={String(i)}>{w}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[12px] text-gray-500">Giờ chốt (24h)</label>
                                <TimeInput value={dlForm.time} onChange={(v) => setDlForm({ ...dlForm, time: v })} className={inp + ' mt-1'} />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setSetOpen(false)} className="flex-1 h-11 rounded-xl border border-gray-300 text-[14px]">Hủy</button>
                            <button onClick={saveSettings} disabled={savingSet} className={'flex-1 h-11 rounded-xl text-white text-[14px] font-semibold ' + (savingSet ? 'bg-gray-400' : 'bg-[#24305E]')}>{savingSet ? 'Đang lưu...' : 'Lưu cài đặt'}</button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
}
