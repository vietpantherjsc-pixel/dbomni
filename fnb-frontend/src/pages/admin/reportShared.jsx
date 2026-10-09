// =====================================================================
// Gói 17: Dùng chung cho 3 trang báo cáo (Reports / ReportsInventory / ReportsPnl).
// Tách từ Reports.jsx (Gói 15) để khỏi lặp code. Theme navy #24305E + cam #F5A623.
// =====================================================================
import { fmtDate } from '../../utils/format';

export const REPORT_CSS = `
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

export const PERIOD_NAMES = { day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm' };
export const COMPARE_NAMES = { previous: 'Kỳ trước', lastyear: 'Cùng kỳ năm trước', custom: 'Tùy chọn' };

export { fmtInt, fmtVND, trimN, fmtShort, pad, fmtD, todayStr, deltaBadge, barChart, groupChart, donut, kpi };
