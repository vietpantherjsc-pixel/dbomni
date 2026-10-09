import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';

// =====================================================================
// Gói 15 (2026-10-08): Trang Báo cáo cho Giám đốc — code từ demo v3 đã chốt.
// Dữ liệu: GET /api/reports/overview (1 endpoint trả đủ 4 tab).
// Biểu đồ vẽ bằng div/CSS thuần (copy từ demo), không thêm thư viện.
// =====================================================================

const API = 'http://localhost/api';

const CSS = `
.rpt{
  --navy:#24305E; --navy-d:#1B2447; --orange:#F5A623;
  --bg:#F3F5F9; --card:#FFFFFF; --text:#22304F; --muted:#6E7890;
  --line:#E4E8F0; --green:#1E9E5A; --green-bg:#E6F6EC;
  --red:#D64545; --red-bg:#FDECEC; --yellow:#9A6A00; --yellow-bg:#FFF3D1;
  --r:8px;
}
.rpt *{box-sizing:border-box;margin:0;padding:0}
.rpt{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.rpt .wrap{max-width:1080px;margin:0 auto;padding:0 12px 28px}
/* Header */
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
.rpt .delta{font-size:12px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap;display:inline-block}
.rpt .delta.up{background:var(--green-bg);color:var(--green)}
.rpt .delta.down{background:var(--red-bg);color:var(--red)}
.rpt .delta.flat{background:#EDF0F6;color:var(--muted)}
/* Segmented control */
.rpt .seg{display:inline-flex;background:#EDEFF5;border-radius:var(--r);padding:3px;gap:2px}
.rpt .seg button{border:0;background:transparent;padding:8px 14px;border-radius:6px;font-weight:700;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;white-space:nowrap}
.rpt .seg button.on{background:#fff;color:var(--navy);box-shadow:0 1px 3px rgba(0,0,0,.12)}
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
/* Channel & peak-hour rows */
.rpt .ch-row{display:grid;grid-template-columns:104px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.rpt .ch-row:last-child{border-bottom:0}
.rpt .ch-row .nm{font-weight:600;font-size:13px}
.rpt .ch-bar{height:10px;background:#EDF0F6;border-radius:5px;overflow:hidden}
.rpt .ch-fill{height:100%;border-radius:5px}
.rpt .ch-val{text-align:right;font-size:12.5px}
.rpt .ch-val b{display:block;color:var(--navy);font-size:13px}
.rpt .pk-row{display:grid;grid-template-columns:34px 52px 1fr auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.rpt .pk-row:last-child{border-bottom:0}
.rpt .pk-rank{font-weight:800;color:var(--orange);font-size:15px;text-align:center}
.rpt .pk-bar{height:8px;background:#EDF0F6;border-radius:4px;overflow:hidden}
.rpt .pk-fill{height:100%;background:var(--orange);border-radius:4px}
/* Tables */
.rpt .tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r)}
.rpt table.tbl{width:100%;border-collapse:collapse;min-width:640px;font-size:13px}
.rpt .tbl th{background:#EFF2F8;color:var(--navy);text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}
.rpt .tbl td{padding:10px 12px;border-top:1px solid var(--line);vertical-align:middle}
.rpt .tbl tr:first-child td{border-top:0}
.rpt .tbl td.num, .rpt .tbl th.num{text-align:right;white-space:nowrap}
.rpt .tbl .prod{font-weight:600;color:var(--navy)}
.rpt .pill{display:inline-block;padding:3px 10px;border-radius:20px;font-weight:800;font-size:12px;white-space:nowrap}
.rpt .pill.g{background:var(--green-bg);color:var(--green)}
.rpt .pill.y{background:var(--yellow-bg);color:var(--yellow)}
.rpt .pill.r{background:var(--red-bg);color:var(--red)}
.rpt .explain{background:#FFF8E8;border:1px solid #F3DFAC;border-radius:var(--r);padding:12px 14px;font-size:13px;color:#6B5A2E;margin-bottom:12px}
.rpt .explain b{color:var(--navy)}
.rpt .more-btn{display:block;width:100%;margin-top:10px;padding:12px;border:1px dashed var(--navy);background:#F6F8FD;color:var(--navy);font-weight:800;font-size:14px;border-radius:var(--r);cursor:pointer;font-family:inherit}
.rpt .more-btn:disabled{border-color:var(--line);color:var(--muted);background:#F7F8FB;cursor:default}
.rpt .page-info{font-size:12.5px;color:var(--muted);margin-top:8px;text-align:center}
.rpt .foot{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:16px;font-size:12.5px;color:var(--muted)}
.rpt .foot h4{color:var(--navy);font-size:13px;margin-bottom:6px}
.rpt .foot ul{margin:6px 0 6px 18px}
.rpt .foot li{margin-bottom:3px}
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
// Gói 36: dùng chung utils/format cho đồng nhất (giữ fallback '—')
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

const kpi = (lb, val, badgeHtml, hero) => (
    <div className={'kpi' + (hero ? ' hero' : '')}>
        <div className="lb">{lb}</div>
        <div className="v">{val}</div>
        <span dangerouslySetInnerHTML={{ __html: badgeHtml }} />
    </div>
);

const PERIOD_NAMES = { day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm' };
const COMPARE_NAMES = { previous: 'Kỳ trước', lastyear: 'Cùng kỳ năm trước', custom: 'Tùy chọn' };

export default function Reports() {
    const [branches, setBranches] = useState([]);
    // Gói 18: chi nhánh dùng chung từ BranchContext (sidebar), thay state riêng
    const { branchId, setBranchId } = useBranch();
    const [f, setF] = useState({
        period: 'week', date: todayStr(),
        compare: 'previous', compare_from: '', compare_to: '', tax_included: '1',
    });
    const [tab, setTab] = useState('rev');
    const [pFilter, setPFilter] = useState('top');
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [prodList, setProdList] = useState([]);
    const [prodMeta, setProdMeta] = useState({ total: 0, has_more: false });
    const [loading, setLoading] = useState(true);
    const [errMsg, setErrMsg] = useState('');

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
                setProdList((prev) => (append ? [...prev, ...d.products.items] : d.products.items));
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

    const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
    const changePFilter = (pf) => { setPFilter(pf); };
    const moreProducts = () => { const np = page + 1; setPage(np); load(np, true); };

    const meta = data?.meta;
    const r = data?.revenue;
    const p = data?.profit;
    const w = data?.waste;

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
                    {[
                        ['rev', 'Doanh thu'],
                        ['profit', 'Thu – Chi & Lợi nhuận'],
                        ['waste', 'Hao hụt nguyên liệu'],
                        ['products', 'Mặt hàng'],
                    ].map(([k, lb]) => (
                        <button key={k} className={'tab-btn' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{lb}</button>
                    ))}
                </nav>

                <main className="wrap">
                    {loading && !data && <div className="card">Đang tải số liệu…</div>}
                    {!loading && errMsg && !data && (
                        <div className="card" style={{ border: '1px solid #f5c2c7', background: '#fff5f5' }}>
                            <div style={{ color: '#b42318', fontWeight: 600, marginBottom: 6 }}>{errMsg}</div>
                            <button onClick={() => load(1, false)} className="btn btn-navy" style={{ marginTop: 4 }}>Thử tải lại</button>
                        </div>
                    )}
                    {data && (<>

                    {/* TAB 1: DOANH THU */}
                    {tab === 'rev' && (
                    <section>
                        <div className="card">
                            <h3>Hiển thị số liệu
                                <span className="seg">
                                    <button className={f.tax_included === '1' ? 'on' : ''} onClick={() => set('tax_included', '1')}>Đã gồm thuế</button>
                                    <button className={f.tax_included === '0' ? 'on' : ''} onClick={() => set('tax_included', '0')}>Chưa gồm thuế</button>
                                </span>
                            </h3>
                            <div className="sub">Thuế GTGT {meta.vat_rate}%. Chuyển đổi áp dụng cho toàn bộ số liệu doanh thu trong báo cáo.</div>
                            <div className="kpis">
                                {kpi('Doanh thu', fmtVND(r.displayed), deltaBadge(r.delta_revenue))}
                                {kpi('Số đơn', fmtInt(r.orders), deltaBadge(r.delta_orders))}
                                {kpi('Trung bình / đơn', fmtVND(r.avg), deltaBadge(r.delta_avg))}
                                {kpi('Tổng thuế GTGT', fmtVND(r.vat), deltaBadge(r.delta_vat))}
                            </div>
                        </div>
                        <div className="card">
                            <h3>Doanh thu theo kỳ <span dangerouslySetInnerHTML={{ __html: deltaBadge(r.delta_revenue) }} /></h3>
                            <div dangerouslySetInnerHTML={{ __html: barChart(r.buckets, '#24305E') }} />
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
                                                {/* Gói 25: badge "đang ẩn" — số liệu đơn cũ giữ nguyên */}
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
                                <h3>Doanh thu theo kênh</h3>
                                {r.channels.map((c) => (
                                    <div className="ch-row" key={c.key}>
                                        <div className="nm">{c.name}</div>
                                        <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: c.color }} /></div>
                                        <div className="ch-val"><b>{fmtVND(c.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(c.delta) }} /></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Gói 17: thêm 2 block chi tiết */}
                        <div className="two">
                            <div className="card">
                                <h3>Theo phương thức thanh toán</h3>
                                {(r.by_payment || []).map((m) => (
                                    <div className="ch-row" key={m.key}>
                                        <div className="nm">{m.name}</div>
                                        <div className="ch-bar"><div className="ch-fill" style={{ width: m.share + '%', background: '#24305E' }} /></div>
                                        <div className="ch-val"><b>{fmtVND(m.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(m.delta) }} /><div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtInt(m.orders)} đơn</div></div>
                                    </div>
                                ))}
                                {(r.by_payment || []).length === 0 && <div className="sub">Chưa có số liệu.</div>}
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
                        </div>
                        <div className="card">
                            <h3>Doanh thu theo giờ trong ngày</h3>
                            <div className="sub">Sắp xếp từ giờ có đơn đầu tiên đến giờ có đơn cuối cùng của ngày.</div>
                            <div dangerouslySetInnerHTML={{ __html: barChart(r.hourly.map((h) => ({ label: h.hour + 'h', value: h.value })), '#24305E') }} />
                        </div>
                    </section>
                    )}

                    {/* TAB 2: THU – CHI & LỢI NHUẬN */}
                    {tab === 'profit' && (
                    <section>
                        <div className="card">
                            <h3>Tổng quan thu – chi <span className="sub" style={{ margin: 0 }}>Doanh thu theo chế độ hiển thị thuế đã chọn ở tab Doanh thu</span></h3>
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
                            <h3>Thu – Chi – Lợi nhuận theo kỳ <span dangerouslySetInnerHTML={{ __html: deltaBadge(p.delta_profit) }} /></h3>
                            <div dangerouslySetInnerHTML={{ __html: groupChart(p.groups) }} />
                            <div className="legend">
                                <span><span className="dot" style={{ background: '#24305E' }} />Thu</span>
                                <span><span className="dot" style={{ background: '#D64545' }} />Chi</span>
                                <span><span className="dot" style={{ background: '#1E9E5A' }} />Lợi nhuận</span>
                            </div>
                        </div>
                    </section>
                    )}

                    {/* TAB 3: HAO HỤT */}
                    {tab === 'waste' && (
                    <section>
                        <div className="card">
                            <h3>Hao hụt nguyên liệu</h3>
                            <div className="explain">
                                <b>Cách tính:</b> “Xuất theo BOM” là lượng nguyên liệu phải dùng theo định mức, suy từ số món đã bán trong kỳ.
                                “Thực tế tiêu hao” = lượng <b>nhập kho trong kỳ</b> (giả định tồn đầu ≈ tồn cuối — chỉ là ước tính).
                                <b>Chênh lệch = Thực tế − BOM</b>; tỷ lệ hao hụt càng thấp càng tốt.
                            </div>
                            {w.items.length === 0 ? (
                                <div className="sub">Chưa có định mức (BOM) hoặc chưa có đơn bán trong kỳ.</div>
                            ) : (
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Nguyên liệu</th><th>ĐVT</th><th className="num">Xuất theo BOM</th><th className="num">Thực tế (nhập)</th><th className="num">Chênh lệch</th><th className="num">% hao hụt</th></tr>
                                {w.items.map((m) => {
                                    const cls = m.waste_pct === null ? 'y' : (m.waste_pct < 2 ? 'g' : (m.waste_pct <= 5 ? 'y' : 'r'));
                                    return (
                                    <tr key={m.material_id}>
                                        <td className="prod">{m.material}</td>
                                        <td>{m.unit}</td>
                                        <td className="num">{fmtInt(m.bom_qty)}</td>
                                        <td className="num">{fmtInt(m.actual_qty)}</td>
                                        <td className="num" style={{ color: m.diff > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                                            {(m.diff > 0 ? '+' : '') + fmtInt(m.diff)}
                                        </td>
                                        <td className="num"><span className={'pill ' + cls}>{m.waste_pct === null ? '—' : trimN(m.waste_pct) + '%'}</span></td>
                                    </tr>
                                    );
                                })}
                                </tbody>
                            </table></div>
                            )}
                            <div className="legend" style={{ marginTop: 10 }}>
                                <span><span className="pill g">&lt; 2%</span> Tốt</span>
                                <span><span className="pill y">2–5%</span> Cần theo dõi</span>
                                <span><span className="pill r">&gt; 5%</span> Cảnh báo</span>
                            </div>
                        </div>
                    </section>
                    )}

                    {/* TAB 4: MẶT HÀNG */}
                    {tab === 'products' && (
                    <section>
                        <div className="card">
                            <h3>Danh sách mặt hàng
                                <span className="seg">
                                    <button className={pFilter === 'top' ? 'on' : ''} onClick={() => changePFilter('top')}>Top 10 bán chạy</button>
                                    <button className={pFilter === 'slow' ? 'on' : ''} onClick={() => changePFilter('slow')}>Top 10 bán chậm</button>
                                    <button className={pFilter === 'all' ? 'on' : ''} onClick={() => changePFilter('all')}>Tất cả</button>
                                </span>
                            </h3>
                            <div className="sub">Sắp xếp theo doanh thu {pFilter === 'slow' ? 'tăng dần (bán chậm nhất trước)' : 'giảm dần'}.</div>
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th className="num">#</th><th>Tên món</th><th className="num">SL bán</th><th className="num">Doanh thu</th><th className="num">% trên tổng DT</th><th className="num">So với kỳ SS</th></tr>
                                {prodList.map((t) => (
                                    <tr key={t.product_id + '-' + t.rank}>
                                        <td className="num">{t.rank}</td>
                                        <td className="prod">{t.name}</td>
                                        <td className="num">{fmtInt(t.quantity)}</td>
                                        <td className="num"><b>{fmtVND(t.revenue)}</b></td>
                                        <td className="num">{trimN(t.share_pct)}%</td>
                                        <td className="num"><span dangerouslySetInnerHTML={{ __html: deltaBadge(t.delta) }} /></td>
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                            {pFilter === 'all' && (
                                <>
                                    <button className="more-btn" disabled={!prodMeta.has_more} onClick={moreProducts}>
                                        {prodMeta.has_more ? 'Xem tiếp 10 món →' : 'Đã hiển thị tất cả ' + prodMeta.total + ' món'}
                                    </button>
                                    <div className="page-info">Đang xem {prodList.length} / {prodMeta.total} món</div>
                                </>
                            )}
                        </div>
                    </section>
                    )}

                    {/* Ghi chú */}
                    <div className="foot">
                        <h4>Ghi chú về số liệu</h4>
                        <ul>
                            <li>Chỉ tính đơn đã thanh toán (<b>payment_status = paid</b>, chưa hủy) — khớp tab “Đã thanh toán” ở trang Hóa đơn.</li>
                            <li>VAT tính theo từng dòng món (thuế suất riêng của món, mặc định {meta.vat_rate}% từ Thiết lập).</li>
                            <li>Vốn nguyên liệu ước tính từ định mức BOM × giá vốn bình quân các lô đang còn.</li>
                            <li>Chi phí ca lấy từ phiếu chi trong ca (shift_expenses); lý do chứa “lương” được xếp vào Lương.</li>
                            <li>Hao hụt “thực tế” hiện dùng lượng nhập kho trong kỳ làm ước tính (giả định tồn đầu ≈ tồn cuối).</li>
                        </ul>
                    </div>

                    </>)}
                </main>
            </div>
        </AdminLayout>
    );
}
