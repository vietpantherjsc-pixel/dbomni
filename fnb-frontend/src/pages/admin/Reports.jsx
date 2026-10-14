import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';

// =====================================================================
// Gói 58 (2026-10-14): Tái cấu trúc theo demo v4 — 8 tab:
// Tổng quan / Doanh thu / Thu-chi & Giao ca / P&L / Kho & Hao hụt /
// Menu Engineering / Đơn hủy / Vận hành.
// Dữ liệu: GET /api/reports/overview + các endpoint chuyên biệt.
// Chú thích thuật ngữ cuối mỗi tab (yêu cầu lâu dài của Đại Vương).
// =====================================================================


const CSS = `
.rpt{
  --navy:#24305E; --navy-d:#1B2447; --orange:#F5A623;
  --bg:#F3F5F9; --card:#FFFFFF; --text:#22304F; --muted:#6E7890;
  --line:#E4E8F0; --green:#1E9E5A; --green-bg:#E6F6EC;
  --red:#D64545; --red-bg:#FDECEC; --yellow:#9A6A00; --yellow-bg:#FFF3D1;
  --blue:#2563EB; --blue-bg:#E8F0FE; --r:8px;
}
.rpt *{box-sizing:border-box;margin:0;padding:0}
.rpt{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.rpt .wrap{max-width:1080px;margin:0 auto;padding:0 12px 28px}
/* Sticky filter bar */
.rpt .filters{position:sticky;top:0;z-index:40;background:#fff;border-bottom:1px solid var(--line);padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;box-shadow:0 2px 8px rgba(36,48,94,.07)}
.rpt .filters .in{max-width:1080px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px;width:100%}
.rpt .f-item{display:flex;flex-direction:column;gap:4px;flex:1 1 130px;min-width:110px}
.rpt .f-item label{font-size:10.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
.rpt select, .rpt input[type=date], .rpt input[type=text]{padding:9px 10px;border:1px solid var(--line);border-radius:var(--r);font-size:14px;background:#fff;color:var(--text);font-family:inherit;width:100%}
.rpt select:focus, .rpt input:focus{outline:2px solid var(--orange);border-color:var(--orange)}
.rpt #customBox{display:none;flex:1 1 100%;gap:8px;flex-wrap:wrap}
.rpt #customBox.show{display:flex}
.rpt #customBox .f-item{flex:1 1 140px}
.rpt .period-line{max-width:1080px;margin:0 auto;padding:8px 12px 0;font-size:12.5px;color:var(--muted)}
.rpt .period-line b{color:var(--navy)}
/* Tabs */
.rpt .tabs{display:flex;gap:6px;padding:12px;overflow-x:auto;max-width:1080px;margin:0 auto}
.rpt .tab-btn{flex:1;white-space:nowrap;border:1px solid var(--line);background:#fff;padding:10px 14px;border-radius:var(--r);font-weight:700;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit}
.rpt .tab-btn.on{background:var(--navy);color:#fff;border-color:var(--navy)}
/* Cards & KPI */
.rpt .card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-bottom:12px}
.rpt .card h3{font-size:15px;color:var(--navy);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.rpt .card .sub{font-size:12.5px;color:var(--muted);margin-bottom:10px}
.rpt .kpis{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px}
.rpt .kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px}
.rpt .kpi .lb{font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.4px}
.rpt .kpi .v{font-size:23px;font-weight:800;color:var(--navy);margin:5px 0 6px}
.rpt .kpi.hero{background:var(--navy);border-color:var(--navy)}
.rpt .kpi.hero .lb{color:#AEB8D4}
.rpt .kpi.hero .v{color:#fff}
.rpt .kpi.hero .delta.up{background:rgba(255,255,255,.16);color:#7EE2A8}
.rpt .kpi.hero .delta.down{background:rgba(255,255,255,.16);color:#FF9C9C}
.rpt .kpi.hero .delta.flat{background:rgba(255,255,255,.16);color:#C9D1E6}
.rpt .kpi.alert{border:2px solid var(--red)}
.rpt .kpi.alert .v{color:var(--red)}
.rpt .delta{font-size:12px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap;display:inline-block}
.rpt .delta.up{background:var(--green-bg);color:var(--green)}
.rpt .delta.down{background:var(--red-bg);color:var(--red)}
.rpt .delta.flat{background:#EDF0F6;color:var(--muted)}
/* Segmented control */
.rpt .seg{display:inline-flex;background:#EDEFF5;border-radius:var(--r);padding:3px;gap:2px}
.rpt .seg button{border:0;background:transparent;padding:8px 14px;border-radius:6px;font-weight:700;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;white-space:nowrap}
.rpt .seg button.on{background:#fff;color:var(--navy);box-shadow:0 1px 3px rgba(0,0,0,.12)}
/* Buttons */
.rpt .btn{display:inline-block;background:var(--orange);color:var(--navy-d);border:0;border-radius:8px;padding:10px 18px;font-weight:800;font-size:13.5px;cursor:pointer;font-family:inherit}
.rpt .btn:disabled{opacity:.6;cursor:default}
.rpt .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--navy)}
.rpt .btn.navy{background:var(--navy);color:#fff}
/* Bar charts (pure CSS) */
.rpt .chart{overflow-x:auto;padding:10px 2px 0}
.rpt .chart-in{display:flex;align-items:stretch;gap:8px;height:238px}
.rpt .bcol{flex:1;min-width:44px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.rpt .bval{font-size:11px;font-weight:700;color:var(--navy);margin-bottom:4px;white-space:nowrap}
.rpt .bar{width:100%;max-width:54px;border-radius:6px 6px 0 0;background:var(--navy);min-height:3px}
.rpt .blab{font-size:11px;color:var(--muted);margin-top:6px;text-align:center;line-height:1.35;min-height:32px}
.rpt .gcol{flex:1;min-width:66px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.rpt .gbars{display:flex;gap:4px;align-items:flex-end;justify-content:center;flex:1;width:100%}
.rpt .gb{width:17px;border-radius:4px 4px 0 0;min-height:3px}
.rpt .legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12.5px;color:var(--muted)}
.rpt .legend .dot{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:baseline}
/* Donut */
.rpt .donut-wrap{display:flex;flex-direction:column;align-items:center;gap:14px}
.rpt .donut{width:190px;height:190px;border-radius:50%;position:relative;flex:none}
.rpt .hole{position:absolute;inset:30px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;box-shadow:inset 0 0 0 1px var(--line)}
.rpt .hole-lb{font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase}
.rpt .hole-v{font-size:19px;font-weight:800;color:var(--navy)}
.rpt .cost-legend{width:100%;list-style:none}
.rpt .cost-legend li{display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.rpt .cost-legend li:last-child{border-bottom:0}
.rpt .cost-legend .dot{width:12px;height:12px;border-radius:3px;flex:none}
.rpt .cost-legend .nm{flex:1;font-weight:600}
.rpt .cost-legend .pc{color:var(--muted);min-width:48px;text-align:right}
.rpt .cost-legend .am{font-weight:800;color:var(--navy);min-width:92px;text-align:right}
/* Channel rows */
.rpt .ch-row{display:grid;grid-template-columns:104px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.rpt .ch-row:last-child{border-bottom:0}
.rpt .ch-row .nm{font-weight:600;font-size:13px}
.rpt .ch-bar{height:10px;background:#EDF0F6;border-radius:5px;overflow:hidden}
.rpt .ch-fill{height:100%;border-radius:5px}
.rpt .ch-val{text-align:right;font-size:12.5px}
.rpt .ch-val b{display:block;color:var(--navy);font-size:13px}
/* Tables */
.rpt .tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r)}
.rpt table.tbl{width:100%;border-collapse:collapse;min-width:640px;font-size:13px}
.rpt .tbl th{background:#EFF2F8;color:var(--navy);text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}
.rpt .tbl td{padding:10px 12px;border-top:1px solid var(--line);vertical-align:middle}
.rpt .tbl tr:first-child td{border-top:0}
.rpt .tbl td.num, .rpt .tbl th.num{text-align:right;white-space:nowrap}
.rpt .tbl .prod{font-weight:600;color:var(--navy)}
.rpt .tbl tr.total td{background:#F6F8FD;font-weight:800;color:var(--navy)}
.rpt .tbl tr.grand td{background:var(--navy);color:#fff;font-weight:800}
.rpt .tbl tr.warn td{background:var(--red-bg)}
.rpt .pill{display:inline-block;padding:3px 10px;border-radius:20px;font-weight:800;font-size:12px;white-space:nowrap}
.rpt .pill.g{background:var(--green-bg);color:var(--green)}
.rpt .pill.y{background:var(--yellow-bg);color:var(--yellow)}
.rpt .pill.r{background:var(--red-bg);color:var(--red)}
.rpt .pill.b{background:var(--blue-bg);color:var(--blue)}
.rpt .explain{background:#FFF8E8;border:1px solid #F3DFAC;border-radius:var(--r);padding:12px 14px;font-size:13px;color:#6B5A2E;margin-bottom:12px}
.rpt .explain b{color:var(--navy)}
.rpt .more-btn{display:block;width:100%;margin-top:10px;padding:12px;border:1px dashed var(--navy);background:#F6F8FD;color:var(--navy);font-weight:800;font-size:14px;border-radius:var(--r);cursor:pointer;font-family:inherit}
.rpt .more-btn:disabled{border-color:var(--line);color:var(--muted);background:#F7F8FB;cursor:default}
.rpt .page-info{font-size:12.5px;color:var(--muted);margin-top:8px;text-align:center}
.rpt .foot{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:16px;font-size:12.5px;color:var(--muted)}
.rpt .foot h4{color:var(--navy);font-size:13px;margin-bottom:6px}
.rpt .foot ul{margin:6px 0 6px 18px}
.rpt .foot li{margin-bottom:3px}
/* Menu engineering matrix (từ demo v4) */
.rpt .matrix{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.rpt .quad{border-radius:var(--r);padding:14px;border:1px solid var(--line);min-height:150px}
.rpt .quad h4{font-size:14px;margin-bottom:2px}
.rpt .quad .qd{font-size:11.5px;opacity:.8;margin-bottom:8px}
.rpt .quad ul{list-style:none;font-size:12.5px;margin:0;padding:0}
.rpt .quad li{padding:5px 0;border-top:1px dashed rgba(0,0,0,.12)}
.rpt .quad li:first-child{border-top:0}
.rpt .quad.star{background:var(--green-bg);border-color:#BDE5CB}.rpt .quad.star h4{color:var(--green)}
.rpt .quad.plow{background:var(--blue-bg);border-color:#BFD4FB}.rpt .quad.plow h4{color:var(--blue)}
.rpt .quad.puzz{background:var(--yellow-bg);border-color:#F3DFAC}.rpt .quad.puzz h4{color:var(--yellow)}
.rpt .quad.dog{background:var(--red-bg);border-color:#F5C6C6}.rpt .quad.dog h4{color:var(--red)}
.rpt .axis-note{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:6px}
@media(min-width:640px){
.rpt .kpis{grid-template-columns:repeat(2,1fr)}
.rpt .donut-wrap{flex-direction:row;justify-content:flex-start;gap:26px}
.rpt .cost-legend{max-width:460px}
}
@media(min-width:960px){
.rpt .kpis{grid-template-columns:repeat(4,1fr)}
.rpt .two{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
}
`;

// ---------- helpers ----------
const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('vi-VN');
const fmtVND = (n) => fmtInt(n) + ' ₫';
const trimN = (x) => parseFloat(Number(x || 0).toFixed(1)).toString().replace('.', ',');
const fmtShort = (n) => {
    n = Number(n) || 0;
    if (n >= 1e9) return trimN(n / 1e9) + ' tỷ';
    if (n >= 1e6) return trimN(n / 1e6) + ' tr';
    if (n >= 1e3) return trimN(n / 1e3) + ' nghìn';
    return fmtInt(n);
};
const pad = (n) => String(n).padStart(2, '0');
const fmtD = (s) => fmtDate(s) || '—';
const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

function deltaBadge(pct, goodUp = true) {
    if (pct === null || pct === undefined || isNaN(Number(pct))) {
        return '<span class="delta flat">—</span>';
    }
    pct = Number(pct);
    const flat = Math.abs(pct) < 0.05;
    const cls = flat ? 'flat' : ((pct > 0) === goodUp ? 'up' : 'down');
    const ar = flat ? '—' : (pct > 0 ? '▲ ' : '▼ ');
    return '<span class="delta ' + cls + '">' + ar + trimN(Math.abs(pct)) + '%</span>';
}

function barChart(items, color) {
    const max = Math.max(1, ...items.map((x) => Number(x.value) || 0));
    let h = '<div class="chart"><div class="chart-in" style="min-width:' + items.length * 58 + 'px">';
    items.forEach((it) => {
        const pc = Math.max(2, (Number(it.value) || 0) / max * 100);
        h += '<div class="bcol"><div class="bval">' + fmtShort(it.value) + '</div>'
            + '<div class="bar" style="height:' + pc.toFixed(1) + '%;background:' + color + '" title="' + it.label + ': ' + fmtVND(it.value) + '"></div>'
            + '<div class="blab">' + it.label + '</div></div>';
    });
    return h + '</div></div>';
}

function groupChart(groups) {
    const max = Math.max(1, ...groups.map((g) => Math.max(Number(g.thu) || 0, Number(g.chi) || 0, Number(g.loi_nhuan) || 0)));
    let h = '<div class="chart"><div class="chart-in" style="min-width:' + groups.length * 72 + 'px">';
    groups.forEach((g) => {
        const f = (v) => Math.max(2, (Number(v) || 0) / max * 100).toFixed(1);
        h += '<div class="gcol"><div class="gbars">'
            + '<div class="gb" style="height:' + f(g.thu) + '%;background:#24305E" title="Thu: ' + fmtVND(g.thu) + '"></div>'
            + '<div class="gb" style="height:' + f(g.chi) + '%;background:#D64545" title="Chi: ' + fmtVND(g.chi) + '"></div>'
            + '<div class="gb" style="height:' + f(g.loi_nhuan) + '%;background:#1E9E5A" title="Lợi nhuận: ' + fmtVND(g.loi_nhuan) + '"></div>'
            + '</div><div class="blab">' + g.label + '</div></div>';
    });
    return h + '</div></div>';
}

function donut(costs, total) {
    let acc = 0;
    const parts = costs.map((c) => {
        const p = total > 0 ? (Number(c.value) || 0) / total * 100 : 0;
        const s = c.color + ' ' + acc.toFixed(2) + '% ' + (acc + p).toFixed(2) + '%';
        acc += p;
        return s;
    });
    return '<div class="donut" style="background:conic-gradient(' + parts.join(',') + ')">'
        + '<div class="hole"><div><div class="hole-lb">Tổng chi</div><div class="hole-v">' + fmtShort(total) + '</div></div></div></div>';
}

const kpi = (lb, val, badgeHtml, hero, alert) => (
    <div className={'kpi' + (hero ? ' hero' : '') + (alert ? ' alert' : '')}>
        <div className="lb">{lb}</div>
        <div className="v">{val}</div>
        <span dangerouslySetInnerHTML={{ __html: badgeHtml }} />
    </div>
);

// ---------- Chú thích thuật ngữ (từ demo v4 — yêu cầu lâu dài của Đại Vương) ----------
const GLOSSARY = {
    gross: ['Gross Sales (Doanh thu gộp)', 'Tổng tiền hàng nguyên giá trước mọi giảm giá, gồm VAT nếu có.'],
    net: ['Net Revenue (Doanh thu thuần)', 'Gross − Giảm giá − Phí sàn. Mốc 100% để tính mọi tỷ trọng chi phí.'],
    aov: ['AOV (Average Order Value)', 'Giá trị đơn trung bình = Net Revenue / số đơn thành công.'],
    cogs: ['COGS (Cost of Goods Sold)', 'Giá vốn hàng bán — tính theo FIFO từ snapshot lúc bán.'],
    foodcost: ['Food cost %', 'Tỷ lệ giá vốn nguyên liệu / Doanh thu thuần. Chuẩn F&B: 25–32%.'],
    prime: ['Prime Cost', 'COGS + Chi phí nhân sự. "Chỉ số sống còn" — phải dưới 55%.'],
    ebitda: ['EBITDA', 'Lợi nhuận vận hành = Lợi nhuận gộp − Nhân sự − Chi phí vận hành (chưa trừ khấu hao, thuế).'],
    cm: ['Contribution Margin (Lãi gộp/ly)', 'Giá bán thuần − Giá vốn 1 ly. Tiền lãi mỗi ly đóng góp sau khi trừ nguyên liệu.'],
    matrix: ['Stars / Plowhorses / Puzzles / Dogs', 'Ma trận 4 ô phân loại món: Ngôi sao (chạy+lãi cao) / Ngựa thồ (chạy+lãi thấp) / Dấu hỏi (chậm+lãi cao) / Cần cắt giảm (chậm+lãi thấp).'],
    blind: ['Blind count (Kiểm mù)', 'NV kiểm kê không thấy số tồn lý thuyết trên màn hình — chống chép số đối phó.'],
    fifo: ['FIFO (First In First Out)', 'Nhập trước xuất trước — giá vốn tính theo lô nhập thực tế.'],
    overshort: ['Over/Short', 'Chênh lệch két: tiền thực đếm − tiền lý thuyết. Dương là thừa, âm là thiếu.'],
    running: ['Running Balance', 'Số dư lũy kế sau từng giao dịch trong sổ dòng tiền.'],
    commission: ['Commission', 'Phí chiết khấu sàn (GrabFood/ShopeeFood ~20–25%) trích trên mỗi đơn.'],
};

const Glossary = ({ keys }) => (
    <div className="foot">
        <h4>📖 Chú thích thuật ngữ</h4>
        <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}>
            <tbody>
                <tr><th>Thuật ngữ</th><th>Ý nghĩa</th></tr>
                {keys.map((k) => (
                    <tr key={k}><td><b>{GLOSSARY[k][0]}</b></td><td>{GLOSSARY[k][1]}</td></tr>
                ))}
            </tbody>
        </table></div>
    </div>
);

const PERIOD_NAMES = { day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm' };
const COMPARE_NAMES = { previous: 'Kỳ trước', lastyear: 'Cùng kỳ năm trước', custom: 'Tùy chọn' };
export default function Reports() {
    const [branches, setBranches] = useState([]);
    const { branchId, setBranchId } = useBranch();
    const [f, setF] = useState({
        period: 'week', date: todayStr(),
        compare: 'previous', compare_from: '', compare_to: '', tax_included: '1',
    });
    // Gói 58: 8 tab theo demo v4 (7 + Vận hành)
    const [tab, setTab] = useState('overview');
    const [pFilter, setPFilter] = useState('top');
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [prodList, setProdList] = useState([]);
    const [prodMeta, setProdMeta] = useState({ total: 0, has_more: false });
    const [loading, setLoading] = useState(true);
    const [errMsg, setErrMsg] = useState('');
    const [cancelData, setCancelData] = useState(null);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [opsData, setOpsData] = useState(null);
    const [opsLoading, setOpsLoading] = useState(false);
    // Gói 58: Menu Engineering + Sổ dòng tiền
    const [menuData, setMenuData] = useState(null);
    const [menuLoading, setMenuLoading] = useState(false);
    const [cashData, setCashData] = useState(null);
    const [cashLoading, setCashLoading] = useState(false);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        axios.get(API + '/branches')
            .then((r) => { if (r.data?.success) setBranches(r.data.data || []); })
            .catch(() => {});
    }, []);

    const load = useCallback(async (pg, append) => {
        setLoading(true);
        setErrMsg('');
        try {
            const res = await axios.get(API + '/reports/overview', {
                params: {
                    branch_id: branchId, period: f.period, date: f.date,
                    compare: f.compare,
                    compare_from: f.compare_from || undefined,
                    compare_to: f.compare_to || undefined,
                    tax_included: f.tax_included, product_filter: pFilter, page: pg,
                },
            });
            if (res.data?.success) {
                const d = res.data.data;
                setData(d);
                const safeItems = Array.isArray(d.products?.items)
                    ? d.products.items.filter((t) => t && typeof t === 'object')
                    : [];
                setProdList((prev) => (append ? [...prev, ...safeItems] : safeItems));
                setProdMeta({ total: d.products.total, has_more: d.products.has_more });
            }
        } catch (e) {
            console.error('Lỗi tải báo cáo:', e);
            const detail = e?.response?.data?.message || e?.message || '';
            setErrMsg('Không tải được số liệu báo cáo.' + (detail ? ' Chi tiết: ' + detail : '')
                + ' Kiểm tra: đã giải nén file backend (ReportController.php, routes/api.php) vào D:\\WORK\\VIBE và restart backend chưa.');
        }
        setLoading(false);
    }, [f, pFilter, branchId]);

    useEffect(() => { setPage(1); load(1, false); }, [load]);

    const loadCancelled = useCallback(async () => {
        setCancelLoading(true);
        try {
            const res = await axios.get(API + '/reports/cancelled-by-staff', {
                params: { branch_id: branchId, period: f.period, date: f.date },
            });
            if (res.data?.success) setCancelData(res.data.data);
        } catch (e) {
            console.error('Lỗi tải báo cáo đơn hủy:', e);
        }
        setCancelLoading(false);
    }, [f, branchId]);

    const loadOps = useCallback(async () => {
        setOpsLoading(true);
        try {
            const res = await axios.get(API + '/reports/operations', {
                params: { branch_id: branchId, period: f.period, date: f.date },
            });
            if (res.data?.success) setOpsData(res.data.data);
        } catch (e) {
            console.error('Lỗi tải báo cáo vận hành:', e);
        }
        setOpsLoading(false);
    }, [f, branchId]);

    // Gói 58: Menu Engineering
    const loadMenu = useCallback(async () => {
        setMenuLoading(true);
        try {
            const res = await axios.get(API + '/reports/menu-engineering', {
                params: { branch_id: branchId, period: f.period, date: f.date },
            });
            if (res.data?.success) setMenuData(res.data.data);
        } catch (e) {
            console.error('Lỗi tải menu engineering:', e);
        }
        setMenuLoading(false);
    }, [f, branchId]);

    // Gói 58: Sổ dòng tiền — tính running balance ở frontend
    const loadCash = useCallback(async () => {
        setCashLoading(true);
        try {
            const res = await axios.get(API + '/transactions', {
                params: { branch_id: branchId, per_page: 50, status: 'paid' },
            });
            const raw = res.data?.data || res.data?.items || [];
            const items = Array.isArray(raw) ? [...raw].reverse() : [];
            let bal = 0;
            const withBal = items.map((t) => {
                const amt = Number(t.amount) || 0;
                bal += t.type === 'income' ? amt : -amt;
                return { ...t, running_balance: bal };
            }).reverse();
            setCashData({ items: withBal, summary: res.data?.summary || null });
        } catch (e) {
            console.error('Lỗi tải sổ dòng tiền:', e);
        }
        setCashLoading(false);
    }, [branchId]);

    useEffect(() => { if (tab === 'cancelled' || tab === 'overview') loadCancelled(); }, [tab, loadCancelled]);
    useEffect(() => { if (tab === 'ops') loadOps(); }, [tab, loadOps]);
    useEffect(() => { if (tab === 'menu') loadMenu(); }, [tab, loadMenu]);
    useEffect(() => { if (tab === 'cash') loadCash(); }, [tab, loadCash]);

    // Gói 58: Xuất Excel doanh thu
    const exportExcel = async () => {
        setExporting(true);
        try {
            const res = await axios.get(API + '/reports/revenue/export', {
                params: { branch_id: branchId, period: f.period, date: f.date, tax_included: f.tax_included },
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'doanh-thu-' + f.date + '.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Lỗi xuất Excel:', e);
            alert('Không xuất được file Excel. Backend chưa hỗ trợ (cần endpoint GET /api/reports/revenue/export).');
        }
        setExporting(false);
    };

    const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
    const changePFilter = (pf) => { setPFilter(pf); };
    const moreProducts = () => { const np = page + 1; setPage(np); load(np, true); };

    const meta = data?.meta;
    const r = data?.revenue;
    const p = data?.profit;
    const w = data?.waste;

    // Gói 58: Prime Cost = (COGS + Lương) / Net — đỏ khi >55%
    const cogsVal = Number(r?.food_cost_value) || 0;
    const laborVal = Number((p?.costs || []).find((c) => /lương/i.test(c.name || ''))?.value) || 0;
    const netVal = Number(r?.net) || 0;
    const primeCostPct = netVal > 0 ? (cogsVal + laborVal) / netVal * 100 : 0;
    const aovNet = r?.orders > 0 ? netVal / r.orders : 0;

    const rangeTxt = meta
        ? (meta.from.slice(0, 10) === meta.to.slice(0, 10)
            ? fmtD(meta.from)
            : fmtD(meta.from) + ' – ' + fmtD(meta.to))
        : '';
    const cmpTxt = meta
        ? COMPARE_NAMES[meta.compare] + ' (' + (meta.compare_from.slice(0, 10) === meta.compare_to.slice(0, 10)
            ? fmtD(meta.compare_from)
            : fmtD(meta.compare_from) + ' – ' + fmtD(meta.compare_to)) + ')'
        : '';

    const TABS = [
        ['overview', 'Tổng quan'],
        ['rev', 'Doanh thu'],
        ['cash', 'Thu-chi & Giao ca'],
        ['pnl', 'P&L'],
        ['waste', 'Kho & Hao hụt'],
        ['menu', 'Menu Engineering'],
        ['cancelled', 'Đơn hủy'],
        ['ops', 'Vận hành'],
    ];

    return (
        <AdminLayout>
            <style>{CSS}</style>
            <div className="rpt">
                <div style={{ padding: '20px 20px 0' }}>
                    <h1 className="text-xl font-semibold text-gray-800">Báo cáo</h1>
                    <p className="text-[13px] text-gray-500">Tổng quan hoạt động quán dành cho Giám đốc</p>
                </div>

                {/* Bộ lọc */}
                <div className="filters">
                    <div className="in">
                        <div className="f-item">
                            <label>Chi nhánh</label>
                            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                                <option value="0">Tất cả chi nhánh</option>
                                {branches.map((b) => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="f-item">
                            <label>Kỳ báo cáo</label>
                            <select value={f.period} onChange={(e) => set('period', e.target.value)}>
                                <option value="day">Ngày</option>
                                <option value="week">Tuần</option>
                                <option value="month">Tháng</option>
                                <option value="year">Năm</option>
                            </select>
                        </div>
                        <div className="f-item">
                            <label>Ngày mốc</label>
                            <DateInput value={f.date} onChange={(v) => set('date', v)} />
                        </div>
                        <div className="f-item">
                            <label>Kỳ so sánh</label>
                            <select value={f.compare} onChange={(e) => set('compare', e.target.value)}>
                                <option value="previous">Kỳ trước</option>
                                <option value="lastyear">Cùng kỳ năm trước</option>
                                <option value="custom">Tùy chọn…</option>
                            </select>
                        </div>
                        <div id="customBox" className={f.compare === 'custom' ? 'show' : ''}>
                            <div className="f-item">
                                <label>Từ ngày</label>
                                <DateInput value={f.compare_from} onChange={(v) => set('compare_from', v)} />
                            </div>
                            <div className="f-item">
                                <label>Đến ngày</label>
                                <DateInput value={f.compare_to} onChange={(v) => set('compare_to', v)} />
                            </div>
                        </div>
                    </div>
                </div>
                {meta && (
                    <div className="period-line">
                        <b>{meta.branch_name}</b> · Kỳ {PERIOD_NAMES[meta.period]}: <b>{rangeTxt}</b> · So sánh với: <b>{cmpTxt}</b>
                    </div>
                )}

                {/* Tabs */}
                <nav className="tabs">
                    {TABS.map(([k, lb]) => (
                        <button key={k} className={'tab-btn' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{lb}</button>
                    ))}
                </nav>

                <main className="wrap">
                    {loading && !data && <div className="card">Đang tải số liệu…</div>}
                    {!loading && errMsg && !data && (
                        <div className="card" style={{ border: '1px solid #f5c2c7', background: '#fff5f5' }}>
                            <div style={{ color: '#b42318', fontWeight: 600, marginBottom: 6 }}>{errMsg}</div>
                            <button onClick={() => load(1, false)} className="btn navy" style={{ marginTop: 4 }}>Thử tải lại</button>
                        </div>
                    )}
                    {data && (<>
                    {/* TAB 1: TỔNG QUAN (mới — theo demo v4) */}
                    {tab === 'overview' && (
                    <section>
                        <div className="card">
                            <h3>KPI kỳ {PERIOD_NAMES[meta.period]}: {rangeTxt}</h3>
                            <div className="kpis">
                                <div className="kpi hero">
                                    <div className="lb">Doanh thu thuần (Net Revenue)</div>
                                    <div className="v">{fmtVND(netVal)}</div>
                                    <span dangerouslySetInnerHTML={{ __html: deltaBadge(r.delta_revenue) }} />
                                </div>
                                {kpi('AOV (Net / đơn)', fmtVND(aovNet), deltaBadge(r.delta_avg))}
                                <div className={'kpi' + (primeCostPct > 55 ? ' alert' : '')}>
                                    <div className="lb">Prime Cost (COGS + Lương)</div>
                                    <div className="v">{trimN(primeCostPct)}%</div>
                                    <span dangerouslySetInnerHTML={{ __html: primeCostPct > 55
                                        ? '<span class="pill r">Vượt 55% — cần xem lại</span>'
                                        : '<span class="pill g">An toàn</span>' }} />
                                </div>
                                {kpi('Food cost %', trimN(r.food_cost_pct) + '%', Number(r.food_cost_pct) > 30 ? '<span class="pill r">Vượt 30%</span>' : '<span class="pill g">An toàn</span>')}
                                <div className="kpi hero">
                                    <div className="lb">EBITDA (lợi nhuận vận hành)</div>
                                    <div className="v">{fmtVND(p.profit)}</div>
                                    <span dangerouslySetInnerHTML={{ __html: deltaBadge(p.delta_profit) }} />
                                </div>
                                {kpi('Đơn hủy', fmtInt(cancelData?.summary?.total_cancelled ?? 0) + ' đơn', cancelData ? fmtVND(cancelData.summary.total_amount) : '<span class="delta flat">—</span>')}
                            </div>
                            <div className="explain"><b>Cách đọc:</b> mọi tỷ trọng % trên P&amp;L đều lấy <b>Doanh thu thuần (Net Revenue)</b> làm mốc 100%. Prime Cost = Giá vốn + Chi phí nhân sự — "chỉ số sống còn" của quán.</div>
                        </div>
                        <div className="card">
                            <h3>Doanh thu theo kỳ <span dangerouslySetInnerHTML={{ __html: deltaBadge(r.delta_revenue) }} /></h3>
                            <div dangerouslySetInnerHTML={{ __html: barChart(r.buckets, '#24305E') }} />
                        </div>
                        <Glossary keys={['net', 'aov', 'prime', 'ebitda', 'foodcost', 'gross']} />
                    </section>
                    )}

                    {/* TAB 2: DOANH THU */}
                    {tab === 'rev' && (
                    <section>
                        <div className="card">
                            <h3>Hiển thị số liệu
                                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span className="seg">
                                        <button className={f.tax_included === '1' ? 'on' : ''} onClick={() => set('tax_included', '1')}>Đã gồm thuế</button>
                                        <button className={f.tax_included === '0' ? 'on' : ''} onClick={() => set('tax_included', '0')}>Chưa gồm thuế</button>
                                    </span>
                                    <button className="btn" onClick={exportExcel} disabled={exporting}>
                                        {exporting ? 'Đang xuất…' : '⬇ Xuất Excel'}
                                    </button>
                                </span>
                            </h3>
                            <div className="sub">Thuế GTGT {meta.vat_rate}%. Chuyển đổi áp dụng cho toàn bộ số liệu doanh thu trong báo cáo. Nút Xuất Excel tải file chi tiết từng bill.</div>
                            <div className="kpis">
                                {kpi('Doanh thu', fmtVND(r.displayed), deltaBadge(r.delta_revenue))}
                                {kpi('Số đơn', fmtInt(r.orders), deltaBadge(r.delta_orders))}
                                {kpi('Trung bình / đơn', fmtVND(r.avg), deltaBadge(r.delta_avg))}
                                {kpi('Tổng thuế GTGT', fmtVND(r.vat), deltaBadge(r.delta_vat))}
                            </div>
                        </div>
                        <div className="card">
                            <h3>Doanh thu theo kênh</h3>
                            <div className="sub">Net = Gross − Giảm giá (quán chịu) − Phí sàn. Phí sàn snapshot tại lúc tạo đơn.</div>
                            {r.channels.map((c) => (
                                <div className="ch-row" key={c.key}>
                                    <div className="nm">{c.name}</div>
                                    <div>
                                        <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: c.color }} /></div>
                                        {(c.cogs !== undefined || c.commission !== undefined || c.gross_profit !== undefined) && (
                                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                                                Giá vốn: <b style={{ color: 'var(--text)' }}>{fmtVND(c.cogs)}</b>
                                                {' · '}Phí sàn: <b style={{ color: 'var(--text)' }}>{fmtVND(c.commission)}</b>
                                                {' · '}Lãi gộp: <b style={{ color: Number(c.gross_profit) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                    {fmtVND(c.gross_profit)}{c.margin_pct !== undefined && c.margin_pct !== null ? ' (' + trimN(c.margin_pct) + '%)' : ''}
                                                </b>
                                            </div>
                                        )}
                                    </div>
                                    <div className="ch-val"><b>{fmtVND(c.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(c.delta) }} /></div>
                                </div>
                            ))}
                        </div>
                        <div className="two">
                            <div className="card">
                                <h3>Top 5 món bán chạy</h3>
                                <div className="tbl-wrap"><table className="tbl">
                                    <tbody>
                                    <tr><th className="num">#</th><th>Món</th><th className="num">SL bán</th><th className="num">Doanh thu</th><th className="num">So với kỳ SS</th></tr>
                                    {r.top_products.map((t, i) => (
                                        <tr key={i}>
                                            <td className="num">{i + 1}</td>
                                            <td className="prod">{t.name}
                                                {(t.hidden_branches || []).length > 0 && (
                                                    <span style={{ display: 'inline-block', marginLeft: 8, fontSize: 11, padding: '1px 8px', borderRadius: 20, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', whiteSpace: 'nowrap' }}>
                                                        đang ẩn ở {t.hidden_branches.join(', ')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="num">{fmtInt(t.quantity)}</td>
                                            <td className="num"><b>{fmtVND(t.revenue)}</b></td>
                                            <td className="num"><span dangerouslySetInnerHTML={{ __html: deltaBadge(t.delta) }} /></td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table></div>
                            </div>
                            <div className="card">
                                <h3>Theo phương thức thanh toán</h3>
                                <div className="sub">Kế toán dùng bảng này đối soát sao kê ngân hàng &amp; ví mỗi sáng.</div>
                                {(r.by_payment || []).map((m) => (
                                    <div className="ch-row" key={m.key}>
                                        <div className="nm">{m.name}</div>
                                        <div className="ch-bar"><div className="ch-fill" style={{ width: m.share + '%', background: '#24305E' }} /></div>
                                        <div className="ch-val"><b>{fmtVND(m.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(m.delta) }} /><div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtInt(m.orders)} đơn</div></div>
                                    </div>
                                ))}
                                {(r.by_payment || []).length === 0 && <div className="sub">Chưa có số liệu.</div>}
                            </div>
                        </div>
                        <div className="card">
                            <h3>Doanh thu theo giờ trong ngày</h3>
                            <div className="sub">Sắp xếp từ giờ có đơn đầu tiên đến giờ có đơn cuối cùng của ngày.</div>
                            <div dangerouslySetInnerHTML={{ __html: barChart(r.hourly.map((h) => ({ label: h.hour + 'h', value: h.value })), '#24305E') }} />
                        </div>
                        <div className="card">
                            <h3>Theo danh mục mặt hàng</h3>
                            {(r.by_category || []).map((c) => (
                                <div className="ch-row" key={c.category_id}>
                                    <div className="nm">{c.name}</div>
                                    <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: '#F5A623' }} /></div>
                                    <div className="ch-val"><b>{fmtVND(c.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(c.delta) }} /></div>
                                </div>
                            ))}
                            {(r.by_category || []).length === 0 && <div className="sub">Chưa có số liệu.</div>}
                        </div>
                        <Glossary keys={['gross', 'net', 'aov', 'commission']} />
                    </section>
                    )}
                    {/* TAB 3: THU-CHI & GIAO CA (theo demo v4) */}
                    {tab === 'cash' && (
                    <section>
                        <div className="card">
                            <h3>Phần A — Đối soát thu chi</h3>
                            <div className="kpis">
                                {kpi('Doanh thu', fmtVND(p.revenue), deltaBadge(p.delta_revenue))}
                                {kpi('Chi phí', fmtVND(p.cost_total), deltaBadge(p.delta_cost, false))}
                                <div className="kpi hero">
                                    <div className="lb">Lợi nhuận = Thu − Chi</div>
                                    <div className="v">{fmtVND(p.profit)}</div>
                                    <span dangerouslySetInnerHTML={{ __html: deltaBadge(p.delta_profit) }} />
                                </div>
                                {kpi('Biên lợi nhuận', trimN(p.margin) + '%', '<span class="delta flat">—</span>')}
                            </div>
                        </div>
                        <div className="card">
                            <h3>Cơ cấu chi phí</h3>
                            <div className="donut-wrap">
                                <div dangerouslySetInnerHTML={{ __html: donut(p.costs, p.cost_total) }} />
                                <ul className="cost-legend">
                                    {p.costs.map((c, i) => (
                                        <li key={i}>
                                            <span className="dot" style={{ background: c.color }} />
                                            <span className="nm">{c.name}</span>
                                            <span className="pc">{trimN(p.cost_total > 0 ? c.value / p.cost_total * 100 : 0)}%</span>
                                            <span className="am">{fmtVND(c.value)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                        <div className="card">
                            <h3>Phần B — Sổ dòng tiền</h3>
                            <div className="sub">Mỗi giao dịch có số dư lũy kế (running balance) — phát hiện "âm quỹ ảo" theo thời gian.</div>
                            {cashLoading && !cashData && <div className="sub">Đang tải sổ dòng tiền…</div>}
                            {cashData && cashData.items.length === 0 && <div className="sub">Chưa có giao dịch thu-chi.</div>}
                            {cashData && cashData.items.length > 0 && (
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Mã GD</th><th>Ngày</th><th>Loại</th><th>Hạng mục</th><th>Diễn giải</th><th>Quỹ / TK</th><th className="num">Thu (+)</th><th className="num">Chi (−)</th><th className="num">Số dư lũy kế</th></tr>
                                {cashData.items.slice(0, 30).map((t) => (
                                    <tr key={t.id}>
                                        <td><b>{t.code || '—'}</b></td>
                                        <td>{fmtD(t.paid_at || t.created_at)}</td>
                                        <td>{t.type === 'income' ? <span className="pill g">Thu</span> : <span className="pill r">Chi</span>}</td>
                                        <td>{t.category?.name || '—'}</td>
                                        <td style={{ maxWidth: 220 }}>{t.note || '—'}</td>
                                        <td>{t.account?.name || '—'}</td>
                                        <td className="num">{t.type === 'income' ? <b style={{ color: 'var(--green)' }}>{fmtVND(t.amount)}</b> : ''}</td>
                                        <td className="num">{t.type === 'expense' ? <b style={{ color: 'var(--red)' }}>{fmtVND(t.amount)}</b> : ''}</td>
                                        <td className="num"><b>{fmtVND(t.running_balance)}</b></td>
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                            )}
                            <div className="explain" style={{ marginTop: 12 }}><b>Nguyên tắc kế toán:</b> tách <b>ngày thực chi tiền</b> (lên sổ dòng tiền) khỏi <b>kỳ kế toán</b> (lên P&amp;L). VD: tiền nhà 6 tháng chi 1 lần → dòng tiền ghi 1 cục, P&amp;L phân bổ đều 6 tháng.</div>
                        </div>
                        <Glossary keys={['running', 'overshort', 'net']} />
                    </section>
                    )}

                    {/* TAB 4: P&L — tóm tắt + link trang chi tiết */}
                    {tab === 'pnl' && (
                    <section>
                        <div className="card">
                            <h3>Kết quả kinh doanh <span className="pill b">Net Revenue làm mốc 100%</span></h3>
                            <div className="kpis">
                                {kpi('Doanh thu thuần (Net)', fmtVND(netVal), deltaBadge(r.delta_revenue))}
                                {kpi('Giá vốn (COGS)', fmtVND(cogsVal), '<span class="delta flat">' + trimN(netVal > 0 ? cogsVal / netVal * 100 : 0) + '% / Net</span>')}
                                <div className="kpi hero">
                                    <div className="lb">Lợi nhuận gộp (Net − COGS)</div>
                                    <div className="v">{fmtVND(netVal - cogsVal)}</div>
                                    <span className="delta flat">{trimN(netVal > 0 ? (netVal - cogsVal) / netVal * 100 : 0)}% / Net</span>
                                </div>
                                {kpi('Lợi nhuận ròng', fmtVND(p.profit), deltaBadge(p.delta_profit))}
                            </div>
                            <div className="sub">Xem báo cáo P&amp;L đầy đủ theo chi nhánh tại trang riêng:</div>
                            <a href="/admin/reports/pnl" className="btn navy" style={{ textDecoration: 'none' }}>Mở báo cáo P&amp;L chi tiết →</a>
                        </div>
                        <Glossary keys={['net', 'cogs', 'prime', 'ebitda', 'cm']} />
                    </section>
                    )}

                    {/* TAB 5: KHO & HAO HỤT (giữ nguyên) */}
                    {tab === 'waste' && (
                    <section>
                        <div className="card">
                            <h3>Hao hụt nguyên liệu</h3>
                            <div className="explain">
                                <b>Cách tính:</b> Hao hụt = (Tồn đầu kỳ + Nhập trong kỳ − Tồn thực tế kiểm kê) − Tiêu thụ theo BOM.
                                Dòng có dấu <b>⚠ ước tính</b> là chưa có phiếu kiểm kê → dùng công thức cũ (Nhập − BOM), độ tin cậy thấp.
                                <b style={{ color: 'var(--red)' }}>% đỏ</b> = vượt ngưỡng hao hụt cho phép của nguyên liệu → nghi ngờ bán chui/thất thoát, cần kiểm tra ngay.
                            </div>
                            {w.items.length === 0 ? (
                                <div className="sub">Chưa có định mức (BOM) hoặc chưa có đơn bán trong kỳ.</div>
                            ) : (
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Nguyên liệu</th><th className="num">Tồn đầu kỳ</th><th className="num">Nhập trong kỳ</th><th className="num">Xuất theo BOM</th><th className="num">Tồn thực tế (kiểm kê)</th><th className="num">Hao hụt</th><th className="num">% hao hụt</th></tr>
                                {w.items.map((m) => {
                                    const cls = m.waste_pct === null ? 'y' : (m.over_threshold ? 'r' : (m.waste_pct < 2 ? 'g' : 'y'));
                                    return (
                                    <tr key={m.material_id} style={m.over_threshold ? { background: '#fff5f5' } : undefined}>
                                        <td className="prod">{m.material} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({m.unit})</span>
                                            {m.is_estimate && <span className="pill y" style={{ marginLeft: 6 }} title="Chưa có phiếu kiểm kê — số liệu chỉ là ước tính">⚠ ước tính</span>}
                                        </td>
                                        <td className="num">{m.opening_qty === null || m.opening_qty === undefined ? '—' : fmtInt(m.opening_qty)}</td>
                                        <td className="num">{fmtInt(m.inbound_qty)}</td>
                                        <td className="num">{fmtInt(m.bom_qty)}</td>
                                        <td className="num">{m.actual_qty === null || m.actual_qty === undefined ? '—' : fmtInt(m.actual_qty)}</td>
                                        <td className="num" style={{ color: m.diff > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                                            {(m.diff > 0 ? '+' : '') + fmtInt(m.diff)}
                                        </td>
                                        <td className="num"><span className={'pill ' + cls} title={'Ngưỡng: ' + trimN(m.threshold_pct) + '%'}>{m.waste_pct === null ? '—' : trimN(m.waste_pct) + '%'}</span></td>
                                    </tr>
                                    );
                                })}
                                </tbody>
                            </table></div>
                            )}
                            <div className="legend" style={{ marginTop: 10 }}>
                                <span><span className="pill g">&lt; 2%</span> Tốt</span>
                                <span><span className="pill y">2% – ngưỡng</span> Cần theo dõi</span>
                                <span><span className="pill r">&gt; ngưỡng</span> Cảnh báo thất thoát</span>
                                <span><span className="pill y">⚠ ước tính</span> Chưa có số kiểm kê</span>
                            </div>
                        </div>
                        <Glossary keys={['cogs', 'foodcost', 'blind', 'fifo']} />
                    </section>
                    )}
                    {/* TAB 6: MENU ENGINEERING (mới — theo demo v4) */}
                    {tab === 'menu' && (
                    <section>
                        {menuLoading && !menuData && <div className="card">Đang tải số liệu…</div>}
                        {!menuLoading && !menuData && (
                            <div className="card">
                                <h3>Menu Engineering</h3>
                                <div className="sub">Backend chưa hỗ trợ endpoint <b>GET /api/reports/menu-engineering</b>. Áp dụng gói backend mới rồi tải lại trang.</div>
                            </div>
                        )}
                        {menuData && (<>
                        <div className="card">
                            <h3>Ma trận Menu 4 ô</h3>
                            <div className="sub">Trục X: số lượng bán · Trục Y: lãi gộp 1 ly. Mốc chia: trung bình toàn menu.</div>
                            <div className="axis-note"><span>← Bán chậm</span><span><b>Số lượng bán</b></span><span>Bán chạy →</span></div>
                            <div className="matrix">
                                {[
                                    ['puzz', '❓ Puzzles — Dấu hỏi', 'Bán chậm · Lãi cao', 'puzzles'],
                                    ['star', '⭐ Stars — Ngôi sao', 'Bán chạy · Lãi cao', 'stars'],
                                    ['dog', '🐶 Dogs — Cắt giảm', 'Bán chậm · Lãi thấp', 'dogs'],
                                    ['plow', '🐴 Plowhorses — Ngựa thồ', 'Bán chạy · Lãi thấp', 'plowhorses'],
                                ].map(([cls, title, desc, key]) => (
                                    <div className={'quad ' + cls} key={key}>
                                        <h4>{title}</h4><div className="qd">{desc}</div>
                                        <ul>
                                            {((menuData.matrix || {})[key] || []).map((m, i) => (
                                                <li key={i}><b>{m.name}</b><br />{fmtInt(m.qty)} ly · lãi {fmtVND(m.profit_per_unit)}/ly</li>
                                            ))}
                                            {((menuData.matrix || {})[key] || []).length === 0 && <li>—</li>}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                            <div className="axis-note"><span>Lãi thấp</span><span><b>Lãi gộp / ly</b></span><span>Lãi cao</span></div>
                        </div>
                        <div className="card">
                            <h3>Chi tiết từng món <span className="pill b">giá vốn FIFO snapshot lúc bán</span></h3>
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Món</th><th className="num">Giá bán</th><th className="num">Giá vốn/ly</th><th className="num">% cost</th><th className="num">Lãi gộp/ly</th><th className="num">SL bán</th><th className="num">Tổng lãi</th><th>Phân loại</th></tr>
                                {(menuData.items || []).map((m, i) => (
                                    <tr key={i}>
                                        <td className="prod">{m.name}</td>
                                        <td className="num">{fmtVND(m.price)}</td>
                                        <td className="num">{fmtVND(m.cogs_per_unit)}</td>
                                        <td className="num">{trimN(m.cost_pct)}%</td>
                                        <td className="num"><b>{fmtVND(m.profit_per_unit)}</b></td>
                                        <td className="num">{fmtInt(m.qty)}</td>
                                        <td className="num"><b>{fmtVND(m.total_profit)}</b></td>
                                        <td>{m.category === 'star' ? <span className="pill g">Star</span>
                                            : m.category === 'plowhorse' ? <span className="pill b">Plowhorse</span>
                                            : m.category === 'puzzle' ? <span className="pill y">Puzzle</span>
                                            : m.category === 'dog' ? <span className="pill r">Dog</span> : '—'}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                            <div className="explain" style={{ marginTop: 12 }}><b>Lưu ý:</b> giá vốn lấy từ <b>snapshot FIFO tại lúc bán</b> — xem lại kỳ trước không bị nhảy số khi giá nguyên liệu tháng này tăng.</div>
                        </div>
                        </>)}
                        <Glossary keys={['matrix', 'cm', 'cogs', 'fifo']} />
                    </section>
                    )}

                    {/* TAB 7: ĐƠN HỦY */}
                    {tab === 'cancelled' && (
                    <section>
                        <div className="card">
                            <h3>Đơn hủy theo nhân viên</h3>
                            <div className="explain">
                                Truy vết <b>ai đã hủy đơn</b> trong kỳ. Dòng <b style={{ color: 'var(--red)' }}>đỏ</b> là
                                bất thường: nhân viên hủy <b>&gt; 5 đơn/ngày</b> hoặc tổng tiền hủy <b>&gt; 500.000₫/ngày</b> —
                                cần kiểm tra ngay (nguy cơ hủy đơn đã thu tiền rồi bỏ túi).
                            </div>
                            {cancelLoading && !cancelData && <div className="sub">Đang tải số liệu…</div>}
                            {cancelData && (<>
                                <div className="kpis">
                                    {kpi('Đơn đã hủy', fmtInt(cancelData.summary.total_cancelled), '<span class="delta flat">trong kỳ</span>')}
                                    {kpi('Tổng tiền hủy', fmtVND(cancelData.summary.total_amount), '<span class="delta flat">—</span>')}
                                    <div className={'kpi' + (cancelData.summary.flagged_groups > 0 ? ' alert' : '')}>
                                        <div className="lb">Nhóm cảnh báo</div>
                                        <div className="v">{fmtInt(cancelData.summary.flagged_groups)}</div>
                                        <span className={cancelData.summary.flagged_groups > 0 ? 'pill r' : 'pill g'}>
                                            {cancelData.summary.flagged_groups > 0 ? '⚠ Cần kiểm tra' : 'Bình thường'}
                                        </span>
                                    </div>
                                </div>
                                {/* Gói 58: group theo lý do hủy (nếu API trả về) */}
                                {Array.isArray(cancelData.by_reason) && cancelData.by_reason.length > 0 && (
                                <>
                                    <h4 style={{ margin: '4px 0 10px', color: 'var(--navy)' }}>Đơn hủy theo lý do</h4>
                                    <div className="tbl-wrap"><table className="tbl">
                                        <tbody>
                                        <tr><th>Lý do hủy</th><th className="num">Số đơn</th><th className="num">Tổng tiền</th><th className="num">% trên tổng hủy</th></tr>
                                        {cancelData.by_reason.map((g, i) => (
                                            <tr key={i}>
                                                <td className="prod">{g.reason || 'Không rõ lý do'}</td>
                                                <td className="num">{fmtInt(g.count)}</td>
                                                <td className="num"><b>{fmtVND(g.total_amount)}</b></td>
                                                <td className="num">{trimN(cancelData.summary.total_cancelled > 0 ? g.count / cancelData.summary.total_cancelled * 100 : 0)}%</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table></div>
                                </>
                                )}
                                {cancelData.groups.length === 0 ? (
                                    <div className="sub">Không có đơn hủy trong kỳ. Tốt!</div>
                                ) : (
                                <>
                                    <h4 style={{ margin: '16px 0 10px', color: 'var(--navy)' }}>Đơn hủy theo nhân viên / ngày</h4>
                                    <div className="tbl-wrap"><table className="tbl">
                                        <tbody>
                                        <tr><th>Ngày</th><th>Người hủy</th><th>Loại</th><th className="num">Số đơn hủy</th><th className="num">Đơn đã thu tiền</th><th className="num">Tổng tiền hủy</th><th>Cảnh báo</th></tr>
                                        {cancelData.groups.map((g, i) => (
                                            <tr key={i} style={g.flagged ? { background: '#fff5f5' } : undefined}>
                                                <td>{fmtD(g.date)}</td>
                                                <td className="prod">{g.cancelled_by}</td>
                                                <td>{g.cancelled_by_type === 'employee' ? 'Nhân viên' : (g.cancelled_by_type === 'user' ? 'Quản trị' : (g.cancelled_by_type === 'customer' ? 'Khách online' : g.cancelled_by_type))}</td>
                                                <td className="num" style={{ fontWeight: 700 }}>{g.count}</td>
                                                <td className="num" style={{ color: g.paid_count > 0 ? 'var(--red)' : 'inherit', fontWeight: g.paid_count > 0 ? 700 : 400 }}>{g.paid_count}</td>
                                                <td className="num" style={{ fontWeight: 700 }}>{fmtVND(g.total_amount)}</td>
                                                <td>{g.flagged ? <span className="pill r">⚠ Bất thường</span> : <span className="pill g">Bình thường</span>}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table></div>
                                </>
                                )}
                                {cancelData.detail.length > 0 && (
                                <>
                                    <h4 style={{ marginTop: 16, color: 'var(--navy)' }}>Chi tiết từng đơn hủy</h4>
                                    <div className="tbl-wrap"><table className="tbl">
                                        <tbody>
                                        <tr><th>Mã đơn</th><th>Thời gian hủy</th><th>Người hủy</th><th className="num">Tiền đơn</th><th>Thanh toán</th><th>Lý do</th></tr>
                                        {cancelData.detail.map((d) => (
                                            <tr key={d.code}>
                                                <td><b>{d.code}</b></td>
                                                <td>{d.cancelled_at}</td>
                                                <td className="prod">{d.cancelled_by}</td>
                                                <td className="num">{fmtVND(d.total_amount)}</td>
                                                <td>{d.payment_status === 'paid' || d.payment_status === 'refunded' ? <span className="pill r">Đã thu tiền</span> : d.payment_status}</td>
                                                <td>{d.cancel_reason || '—'}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table></div>
                                </>
                                )}
                            </>)}
                        </div>
                        <div className="foot">
                            <h4>📖 Chú thích thuật ngữ</h4>
                            <ul>
                                <li><b>Đơn hủy bất thường:</b> nhân viên hủy quá 5 đơn/ngày hoặc tổng tiền hủy quá 500.000₫/ngày — dấu hiệu cần kiểm tra gian lận.</li>
                                <li><b>Đã thu tiền:</b> đơn hủy sau khi khách đã thanh toán — tiền phải được hoàn lại và ghi nhận rõ ràng.</li>
                            </ul>
                        </div>
                    </section>
                    )}

                    {/* TAB 8: VẬN HÀNH (giữ nguyên từ Gói 56) */}
                    {tab === 'ops' && (
                    <section>
                        <div className="card">
                            <h3>Chỉ số vận hành</h3>
                            <div className="sub">Theo dõi tốc độ pha chế, tỷ lệ hủy đơn và tình trạng nhân sự theo giờ.</div>
                            {opsLoading && !opsData && <div className="sub">Đang tải số liệu…</div>}
                            {opsData && (
                            <div className="kpis">
                                <div className="kpi">
                                    <div className="lb">Thời gian pha chế TB</div>
                                    <div className="v">{opsData.kpis?.avg_prep_minutes != null ? trimN(opsData.kpis.avg_prep_minutes) + ' phút' : '—'}</div>
                                    <span className="delta flat">nhận đơn → bếp xong</span>
                                </div>
                                <div className="kpi">
                                    <div className="lb">Tỷ lệ hủy đơn</div>
                                    <div className="v">{opsData.kpis?.cancel_rate_pct != null ? trimN(opsData.kpis.cancel_rate_pct) + '%' : '—'}</div>
                                    <span className="delta flat">đơn hủy / tổng đơn</span>
                                </div>
                                <div className="kpi">
                                    <div className="lb">Đơn / giờ / NV</div>
                                    <div className="v">{opsData.kpis?.orders_per_hour_per_staff != null ? trimN(opsData.kpis.orders_per_hour_per_staff) : '—'}</div>
                                    <span className="delta flat">năng suất bình quân</span>
                                </div>
                                <div className="kpi" style={Number(opsData.kpis?.understaffed_hours) > 0 ? { borderColor: 'var(--red)' } : undefined}>
                                    <div className="lb">Cảnh báo thiếu người</div>
                                    <div className="v" style={Number(opsData.kpis?.understaffed_hours) > 0 ? { color: 'var(--red)' } : undefined}>
                                        {fmtInt(opsData.kpis?.understaffed_hours)} giờ
                                    </div>
                                    <span className={Number(opsData.kpis?.understaffed_hours) > 0 ? 'pill r' : 'pill g'}>
                                        {Number(opsData.kpis?.understaffed_hours) > 0 ? '⚠ Cần xem lại' : 'Ổn định'}
                                    </span>
                                </div>
                            </div>
                            )}
                        </div>
                        {opsData && (opsData.hourly || []).length > 0 && (
                        <div className="card">
                            <h3>Đơn và nhân sự theo giờ</h3>
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Giờ</th><th className="num">Số đơn</th><th className="num">Số NV</th><th>Trạng thái</th></tr>
                                {(opsData.hourly || []).map((h) => (
                                    <tr key={h.hour} style={h.understaffed ? { background: '#fff5f5' } : undefined}>
                                        <td><b>{h.hour}h – {Number(h.hour) + 1}h</b></td>
                                        <td className="num">{fmtInt(h.orders)}</td>
                                        <td className="num">{fmtInt(h.staff)}</td>
                                        <td>{h.understaffed ? <span className="pill r">⚠ Thiếu người</span> : <span className="pill g">Đủ</span>}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                        </div>
                        )}
                        {opsData && (opsData.alerts || []).length > 0 && (
                        <div className="card">
                            <h3>Cảnh báo</h3>
                            {(opsData.alerts || []).map((a, i) => (
                                <div key={i} className="explain" style={{ background: '#fff5f5', borderColor: '#f5c2c7', color: '#8a2b2b', marginBottom: i < opsData.alerts.length - 1 ? 8 : 0 }}>
                                    ⚠ {typeof a === 'string' ? a : (a.message || '')}
                                </div>
                            ))}
                        </div>
                        )}
                        <div className="foot">
                            <h4>📖 Chú thích thuật ngữ</h4>
                            <ul>
                                <li><b>Thời gian pha chế:</b> khoảng thời gian từ lúc đơn được tạo đến khi bếp/bar bấm "Sẵn sàng" (tính trung bình theo phút).</li>
                                <li><b>Tỷ lệ hủy:</b> số đơn bị hủy chia cho tổng số đơn trong kỳ (tính theo %).</li>
                                <li><b>Đơn/giờ/NV:</b> số đơn trung bình mỗi nhân viên phục vụ trong 1 giờ — đo năng suất lao động.</li>
                                <li><b>Thiếu người:</b> khung giờ có số đơn vượt ngưỡng phục vụ của số nhân viên đang làm (ngưỡng cài ở Thiết lập).</li>
                            </ul>
                        </div>
                    </section>
                    )}

                    {/* Ghi chú chung */}
                    <div className="foot">
                        <h4>Ghi chú về số liệu</h4>
                        <ul>
                            <li>Chỉ tính đơn đã thanh toán (<b>payment_status = paid</b>, chưa hủy) — khớp tab "Đã thanh toán" ở trang Hóa đơn.</li>
                            <li>VAT tính theo từng dòng món (thuế suất riêng của món, mặc định {meta.vat_rate}% từ Thiết lập).</li>
                            <li>Vốn nguyên liệu ước tính từ định mức BOM × giá vốn bình quân các lô đang còn.</li>
                            <li>Chi phí ca lấy từ phiếu chi trong ca (shift_expenses); lý do chứa "lương" được xếp vào Lương.</li>
                            <li>Hao hụt = (Tồn đầu kỳ + Nhập trong kỳ − Tồn thực tế kiểm kê) − Tiêu thụ BOM. Dòng "⚠ ước tính" là chưa có phiếu kiểm kê.</li>
                        </ul>
                    </div>

                    </>)}
                </main>
            </div>
        </AdminLayout>
    );
}
