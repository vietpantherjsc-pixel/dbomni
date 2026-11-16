import React, { useState, useEffect, useCallback } from 'react';

// S5(3): 401 trong các luồng nạp → hiện câu chuẩn hết phiên qua alert, có
// khóa chống dội 30s để nhiều catch cùng chết phiên không xếp hàng alert.
let __expiredAt = 0;
const noteExpired = (e) => {
    if (e?.response?.status === 401 && Date.now() - __expiredAt > 30000) {
        __expiredAt = Date.now();
        alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
};
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';
import { fmtDate } from '../../utils/format';
import DateInput from '../../components/DateInput';
import MonthInput, { validMonth } from '../../components/MonthInput';
import { API } from '../../utils/api';
import { REPORT_TABS, REPORT_TAB_PERMS, EstTag, CONFIG_FIELD_LABELS, fmtConfigValue } from './reportShared';
import { RevenueTargetForm } from './ReportsPnl'; // N-3 vòng nhỏ (a): tab Mục tiêu tái dùng form ở trang PNL
import { useAuth } from '../../contexts/AuthContext'; // Cây phân quyền §2: gác tab báo cáo theo lá view

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
.rpt .two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}
.rpt .two>*{min-width:0}
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
    net: ['Net Revenue (Doanh thu thuần)', 'Gross − VAT. Mốc 100% để tính mọi tỷ trọng chi phí. Thu khác (phiếu thu tay) để riêng — vẫn tính vào Lợi nhuận nhưng KHÔNG nằm trong Doanh thu thuần. Giảm giá và phí sàn KHÔNG trừ vào chỉ số này (phí sàn nằm ở phía chi phí của P&L). Cùng cơ số với Doanh thu thuần ở báo cáo P&L.'],
    aov: ['AOV (Average Order Value)', 'Giá trị đơn trung bình = Net Revenue / số đơn thành công.'],
    // Riêng tab Doanh thu (2026-11-04): thẻ "Trung bình / đơn" ở tab này tính
    // theo doanh thu ĐANG HIỂN THỊ (công tắc thuế) sau lát 2h — chú thích phải
    // nói đúng cơ số đó; key 'aov' (theo Net) giữ cho tab Tổng quan.
    aov_display: ['AOV (Average Order Value)', 'Giá trị đơn trung bình = Doanh thu đang hiển thị ở thẻ Doanh thu của tab này (theo công tắc Đã gồm thuế / Chưa gồm thuế) / số đơn thành công.'],
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
    // Phương án B (2026-11-15): dải tab dùng chung trên trang chi tiết dẫn về
    // đây qua ?tab=<danh mục> — mở đúng tab được chọn; tab không có quyền
    // hoặc sai mã được vòng kiểm visibleTabs phía dưới tự đưa về tab đầu.
    const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview');
    const [pFilter, setPFilter] = useState('top');
    const [page, setPage] = useState(1);
    const [cashShown, setCashShown] = useState(30); // UX 2026-10-26: sổ dòng tiền hiện tăng dần (trước slice cứng 30 không ghi chú)
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
    // Chỉ số 360 đợt 1: tab Khách hàng (TC-2 nằm trong CashSummary tự nạp)
    const [custData, setCustData] = useState(null);
    const [custLoading, setCustLoading] = useState(false);
    const [sp1Group, setSp1Group] = useState('platform');

    useEffect(() => {
        axios.get(API + '/branches')
            .then((r) => { if (r.data?.success) setBranches(r.data.data || []); })
            .catch((e) => noteExpired(e));
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
            // UX 2026-10-26 (🟠T3): KHÔNG lộ hướng dẫn nội bộ/đường dẫn máy cho người dùng cuối
            console.error('Chi tiết lỗi báo cáo:', detail);
            setErrMsg('Không tải được số liệu báo cáo. Kiểm tra kết nối mạng rồi bấm Thử tải lại.');
        }
        setLoading(false);
    }, [f, pFilter, branchId]);

    // Vòng nhỏ N-3 §KP: chỉ tải overview khi tab đang mở cần nó — Tổng quan,
    // Doanh thu, Thu-chi, P&L, Kho dùng chung payload overview; Menu, Đơn hủy,
    // Vận hành, Nhân sự, Khách hàng, Mục tiêu tự nạp dữ kiện riêng. Trước đây
    // tải overview lúc mở trang bất kể tab nào nên Chủ CN (không có lá
    // overview) 403 và toàn bộ nội dung tab bị thẻ lỗi che.
    const NEEDS_OVERVIEW = ['overview', 'rev', 'cash', 'pnl', 'waste'];
    useEffect(() => { if (NEEDS_OVERVIEW.includes(tab)) { setPage(1); load(1, false); } }, [load, tab]);

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
                // Lát 2j (2026-11-04): '0' = Tất cả chi nhánh — KHÔNG gửi branch_id,
                // gửi nguyên '0' làm backend lọc branch_id = 0 và sổ luôn rỗng
                // trong khi khối tổng (hiểu 0 = tất cả) vẫn có số.
                params: { ...(branchId !== '0' ? { branch_id: branchId } : {}), per_page: 50, status: 'paid' },
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

    // Chỉ số 360 đợt 1: tab Khách hàng (KH-1→KH-5 + Marketing)
    const loadCustomers = useCallback(async () => {
        setCustLoading(true);
        try {
            const res = await axios.get(API + '/reports/customers', {
                params: { branch_id: branchId, period: f.period === 'day' ? 'month' : f.period, date: f.date },
            });
            if (res.data?.success) setCustData(res.data.data);
        } catch (e) {
            console.error('Lỗi tải báo cáo khách hàng:', e);
        }
        setCustLoading(false);
    }, [f, branchId]);

    useEffect(() => { if (tab === 'cancelled' || tab === 'overview') loadCancelled(); }, [tab, loadCancelled]);
    useEffect(() => { if (tab === 'ops') loadOps(); }, [tab, loadOps]);
    useEffect(() => { if (tab === 'menu') loadMenu(); }, [tab, loadMenu]);
    useEffect(() => { if (tab === 'cash') loadCash(); }, [tab, loadCash]);
    useEffect(() => { if (tab === 'customers') loadCustomers(); }, [tab, loadCustomers]);

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
            alert('Không xuất được file Excel. Tính năng xuất file đang tạm thời không khả dụng — vui lòng thử lại sau.');
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

    // Danh mục + cổng quyền từng tab: nguồn duy nhất ở reportShared
    // (REPORT_TABS / REPORT_TAB_PERMS) — dùng chung với dải tab điều hướng
    // trên 2 trang chi tiết PNL · Kho (Phương án B, 2026-11-15).
    const TABS = REPORT_TABS;
    const { can } = useAuth();
    const TAB_PERMS = REPORT_TAB_PERMS;
    const visibleTabs = TABS.filter(([k]) => can(TAB_PERMS[k]));
    useEffect(() => {
        if (visibleTabs.length && !visibleTabs.some(([k]) => k === tab)) setTab(visibleTabs[0][0]);
    }, [tab, visibleTabs]); // eslint-disable-line
    if (visibleTabs.length === 0) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem báo cáo.</div></AdminLayout>);

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
                    {visibleTabs.map(([k, lb]) => (
                        <button key={k} className={'tab-btn' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{lb}</button>
                    ))}
                </nav>

                <main className="wrap">
                    {loading && !data && NEEDS_OVERVIEW.includes(tab) && <div className="card">Đang tải số liệu…</div>}
                    {!loading && errMsg && !data && NEEDS_OVERVIEW.includes(tab) && (
                        <div className="card" style={{ border: '1px solid #f5c2c7', background: '#fff5f5' }}>
                            <div style={{ color: '#b42318', fontWeight: 600, marginBottom: 6 }}>{errMsg}</div>
                            <button onClick={() => load(1, false)} className="m-btn m-btn-primary" style={{ marginTop: 4 }}>Thử tải lại</button>
                        </div>
                    )}
                    {/* Vòng nhỏ N-3 §KP: nội dung từng tab render độc lập khỏi dữ kiện
                        overview — 5 tab dùng overview tự gác bằng `data` ở đầu
                        từng khối; các tab tự nạp dữ kiện riêng hiện dù data null. */}
                    {<>
                    {/* TAB 1: TỔNG QUAN (mới — theo demo v4) */}
                    {tab === 'overview' && data && (
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
                                    {/* Điểm 6 (2026-11-15): Biên EBITDA = EBITDA / Doanh thu thuần
                                        (đúng cơ số C1: Gross − VAT, không gồm thu khác) — dòng
                                        riêng có nhãn "Biên" để không nhầm với % biến động so kỳ */}
                                    <div style={{ fontSize: 12, color: '#AEB8D4', marginTop: 4 }}>Biên <b style={{ color: '#fff' }}>{trimN(netVal > 0 ? p.profit / netVal * 100 : 0)}%</b></div>
                                </div>
                                {/* #70 (2026-11-04): đang tải mà chưa có dữ liệu thì hiện "—" —
                                    trước đây ?? 0 làm thẻ hiện "0 đơn" giả trong lúc nạp
                                    (cùng họ bịt cửa sổ số giả như các vá trạng thái tải). */}
                                {kpi('Đơn hủy', (cancelLoading && !cancelData) ? '—' : fmtInt(cancelData?.summary?.total_cancelled ?? 0) + ' đơn', cancelData ? fmtVND(cancelData.summary.total_amount) : '<span class="delta flat">—</span>')}
                            </div>
                            {/* TC-1 (chỉ số 360 đợt 1): đơn hòa vốn hôm nay cạnh đơn thực tế — chỉ ở kỳ Ngày */}
                            {f.period === 'day' && data?.breakeven && (
                                <div className="sub" style={{ marginTop: 10 }}>
                                    {data.breakeven.status === 'unconfigured'
                                        ? <>🎯 Hòa vốn tháng {data.breakeven.month}: <b>chưa đủ cấu hình</b> — còn danh mục chi chưa phân loại Cố định/Biến đổi ({(data.breakeven.unconfigured || []).map((u) => u.name).join(' · ')}).</>
                                        : <>🎯 Đơn hòa vốn hôm nay: <b>{data.breakeven.daily_breakeven_orders !== null ? trimN(data.breakeven.daily_breakeven_orders) + ' đơn' : '—'}</b> (doanh thu hòa vốn ngày {data.breakeven.daily_breakeven_revenue !== null ? fmtVND(data.breakeven.daily_breakeven_revenue) : '—'}) · Thực tế hôm nay: <b>{fmtInt(r.orders)} đơn</b>.</>}
                                </div>
                            )}
                            {/* TC-3 (360 đợt 2, N-3): dự báo doanh thu cuối tháng + lệch mục tiêu — chỉ kỳ Tháng */}
                            {f.period === 'month' && data?.forecast && (
                                <div className="sub" style={{ marginTop: 10 }}>
                                    🎯 Dự báo tháng {data.forecast.month}: <b>{fmtVND(data.forecast.forecast_mid)}</b> (khoảng {fmtVND(data.forecast.forecast_low)} – {fmtVND(data.forecast.forecast_high)}) · Lũy kế tới nay: <b>{fmtVND(data.forecast.mtd_net)}</b> · Còn {data.forecast.remaining_days} ngày. {data.forecast.has_target ? (<>Mục tiêu: <b>{fmtVND(data.forecast.target)}</b> · Lệch dự báo: <b>{(data.forecast.deviation_pct ?? 0) >= 0 ? '+' : ''}{trimN(data.forecast.deviation_pct ?? 0)}%</b>.</>) : 'Chưa đặt mục tiêu tháng — đặt tại trang PNL.'} <EstTag note="Ước tính theo doanh thu trung bình cùng thứ trong 8 tuần gần nhất — hệ số lịch sử có thể sai khi tháng có yếu tố bất thường." />
                                </div>
                            )}
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
                    {tab === 'rev' && data && (
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
                                {/* Lát 2h (2026-11-04): AOV của thẻ này phải cùng cơ số với số
                                    Doanh thu ngay bên trái (displayed theo công tắc thuế) —
                                    trước đây lấy r.avg tính trên Net nên 2 số cạnh nhau 2 cơ số. */}
                                {kpi('Trung bình / đơn', fmtVND(r.orders > 0 ? (Number(r.displayed) || 0) / r.orders : 0), deltaBadge(r.delta_avg))}
                                {kpi('Tổng thuế GTGT', fmtVND(r.vat), deltaBadge(r.delta_vat))}
                            </div>
                        </div>
                        <div className="card">
                            <h3>Doanh thu theo kênh</h3>
                            <div className="sub">Net = Gross − VAT. Giảm giá (quán chịu) và phí sàn không trừ vào doanh thu kênh — phí sàn nằm ở phía chi phí của P&L. Phí sàn snapshot tại lúc tạo đơn.</div>
                            {r.channels.map((c) => (
                                <div className="ch-row" key={c.key}>
                                    <div className="nm">{c.name}</div>
                                    <div>
                                        <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: c.color }} /></div>
                                        {(c.cogs !== undefined || c.commission !== undefined || c.gross_profit !== undefined) && (
                                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                                                Giá vốn: <b style={{ color: 'var(--text)' }}>{fmtVND(c.cogs)}</b>
                                                {' · '}Phí sàn: <b style={{ color: 'var(--text)' }}>{fmtVND(c.commission)}</b>
                                                {c.marketing_fee !== undefined ? (<>
                                                    {' · '}Lãi gộp (trước phí marketing): <b style={{ color: Number(c.gross_profit) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                        {fmtVND(c.gross_profit)}{c.margin_pct !== undefined && c.margin_pct !== null ? ' (' + trimN(c.margin_pct) + '%)' : ''}
                                                    </b>
                                                    {' · '}Phí marketing: <b style={{ color: 'var(--text)' }}>{fmtVND(c.marketing_fee)}</b>
                                                    {' · '}Lãi gộp (sau phí marketing): <b style={{ color: Number(c.gross_profit_after_marketing) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                        {fmtVND(c.gross_profit_after_marketing)}{c.margin_after_pct !== undefined && c.margin_after_pct !== null ? ' (' + trimN(c.margin_after_pct) + '%)' : ''}
                                                    </b>
                                                </>) : (<>
                                                    {' · '}Lãi gộp: <b style={{ color: Number(c.gross_profit) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                                        {fmtVND(c.gross_profit)}{c.margin_pct !== undefined && c.margin_pct !== null ? ' (' + trimN(c.margin_pct) + '%)' : ''}
                                                    </b>
                                                </>)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="ch-val"><b>{fmtVND(c.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(c.delta) }} /></div>
                                </div>
                            ))}
                            {/* Gói PNL kênh sàn (2026-10-31): chú thích đối soát marketing của kỳ */}
                            {data?.marketing && (data.marketing.missing_months || []).length > 0 && (
                                <div className="sub" style={{ marginTop: 8 }}>⚠ Chưa nhập phí marketing sàn cho tháng {(data.marketing.missing_months).map((m) => `${String(m).slice(5)}/${String(m).slice(0, 4)}`).join(', ')} — lãi gộp sau marketing của tháng này chưa tính được (không phải bằng 0). Nhập tại Kênh bán hàng → Đối soát sàn theo tháng.</div>
                            )}
                            {data?.marketing && (data.marketing.partial_months || []).length > 0 && (
                                <div className="sub" style={{ marginTop: 8 }}>Phí marketing sàn tính theo tháng trọn — kỳ đang xem cắt ngang tháng {(data.marketing.partial_months).map((m) => `${String(m).slice(5)}/${String(m).slice(0, 4)}`).join(', ')} nên chưa gồm phí marketing của tháng bị cắt.</div>
                            )}
                            {/* N-5 (360 đợt 2): mốc đổi cấu hình chiết khấu/phí marketing trong kỳ */}
                            {(r.channels || []).some((c) => (c.config_markers || []).length > 0) && (
                                <div className="sub" style={{ marginTop: 8 }}>
                                    {(r.channels || []).flatMap((c) => (c.config_markers || []).map((m, i) => (
                                        <div key={c.key + '-' + i}>📅 Cấu hình đổi {m.changed_at}: <b>{m.label}</b> — {CONFIG_FIELD_LABELS[m.field] || m.field}: {fmtConfigValue(m.field, m.old_value)} → {fmtConfigValue(m.field, m.new_value)}{m.changed_by_name ? ' (' + m.changed_by_name + ')' : ''}.</div>
                                    )))}
                                </div>
                            )}
                        </div>

                        {/* BH-1 (chỉ số 360 đợt 1): gánh nặng kênh + biên đóng góp */}
                        <div className="card">
                            <h3>Gánh nặng kênh & biên đóng góp (BH-1)</h3>
                            <div className="sub">Gánh nặng % = (Chiết khấu + Phí marketing sàn + Giảm giá quán chịu) ÷ Doanh thu kênh · Biên đóng góp = Doanh thu − Giá vốn − toàn bộ chi phí kênh trực tiếp. Chi phí chung (lương, mặt bằng) KHÔNG phân bổ xuống kênh.{(data?.marketing?.missing_months || []).length > 0 ? ' Kỳ này chưa gồm phí marketing sàn (chưa đối soát trọn tháng) — kênh chưa có số marketing hiện "—", không tính thiếu như đã đủ.' : ''}</div>
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Kênh</th><th className="num">Doanh thu</th><th className="num">Giảm giá quán chịu</th><th className="num">Gánh nặng kênh</th><th className="num">Biên đóng góp</th><th className="num">Biên %</th></tr>
                                {r.channels.map((c) => (
                                    <tr key={c.key}>
                                        <td className="prod">{c.name}</td>
                                        <td className="num">{fmtVND(c.value)}</td>
                                        <td className="num">{fmtVND(c.discount || 0)}</td>
                                        <td className="num">{c.burden_incomplete ? '—' : trimN(c.burden_pct) + '%'}</td>
                                        <td className="num" style={{ fontWeight: 700, color: c.contribution === null || c.contribution === undefined ? undefined : (Number(c.contribution) >= 0 ? 'var(--green)' : 'var(--red)') }}>{c.burden_incomplete ? '—' : fmtVND(c.contribution)}</td>
                                        <td className="num">{c.burden_incomplete ? '—' : trimN(c.contribution_pct) + '%'}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                        </div>

                        {/* BH-2 + BH-3 (chỉ số 360 đợt 1) */}
                        <div className="two">
                            <div className="card">
                                <h3>Cơ cấu đơn (BH-2)</h3>
                                {r.ipo ? (
                                <div className="kpis">
                                    <div className="kpi"><div className="lb">Số món / đơn (IPO)</div><div className="v">{trimN(r.ipo.ipo)}</div><span className="delta flat">{fmtInt(r.ipo.orders)} đơn trong mẫu</span></div>
                                    <div className="kpi"><div className="lb">Đơn có món kèm</div><div className="v">{trimN(r.ipo.attach_rate)}%</div><span className="delta flat">{fmtInt(r.ipo.attach_orders)} đơn</span></div>
                                </div>
                                ) : <div className="sub">Chưa có dữ kiện.</div>}
                                <div className="sub">Mẫu loại đơn nhóm và dòng quà tặng (giá 0). "Món kèm" = dòng có chọn tùy chọn (theo dữ kiện tùy chọn của dòng — gồm size, topping, món phụ).{r.ipo?.ipo_group !== null && r.ipo?.ipo_group !== undefined ? ' IPO đơn nhóm (tách riêng): ' + trimN(r.ipo.ipo_group) + ' món/đơn trên ' + fmtInt(r.ipo.group_orders) + ' đơn nhóm.' : ''}</div>
                            </div>
                            <div className="card">
                                <h3>Khung giờ cao điểm (BH-3)</h3>
                                <div className="sub">Ma trận doanh thu Thứ × Giờ — ô đậm nhất là khung cao điểm của kỳ. Xem bảng đầy đủ bên dưới.</div>
                                {r.daypart?.peak ? (
                                    <div style={{ fontSize: 15 }}>Cao điểm: <b>{['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'][r.daypart.peak.weekday]} · {r.daypart.peak.hour}h</b> — {fmtVND(r.daypart.peak.value)}</div>
                                ) : <div className="sub">Chưa có đơn trong kỳ.</div>}
                            </div>
                        </div>
                        {r.daypart && (
                        <div className="card">
                            <h3>Ma trận doanh thu Thứ × Giờ (BH-3)</h3>
                            <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 900 }}>
                                <tbody>
                                <tr><th>Thứ</th>{Array.from({ length: 17 }, (_, i) => 6 + i).map((h) => <th key={h} className="num">{h}h</th>)}</tr>
                                {r.daypart.rows.map((row) => (
                                    <tr key={row.weekday}>
                                        <td className="prod">{row.label}</td>
                                        {row.cells.map((c) => (
                                            <td key={c.hour} className="num" style={c.is_peak ? { background: '#FFF3D1', fontWeight: 800 } : (c.value > 0 ? { background: 'rgba(245,166,35,.10)' } : undefined)} title={fmtInt(c.orders) + ' đơn'}>
                                                {c.value > 0 ? fmtInt(c.value) : '·'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                            <div className="sub">Số trong ô là doanh thu (đ), di chuột để xem số đơn. Ô vàng đậm = khung cao điểm nhất của kỳ.</div>
                        </div>
                        )}
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
                            {/* UX 2026-10-26 (🟠28): danh sách mặt hàng ĐẦY ĐỦ theo luật "10/trang + Xem thêm"
                                — trước đây dữ liệu prodList đã tải về nhưng không JSX nào render (code chết) */}
                            <div className="card">
                                <h3>Danh sách mặt hàng ({fmtInt(prodMeta.total)} món)</h3>
                                <div className="sub">Toàn bộ mặt hàng có phát sinh trong kỳ, {pFilter === 'slow' ? 'xếp theo doanh thu tăng dần — món bán chậm nhất lên đầu' : 'xếp theo doanh thu giảm dần — món bán chạy nhất lên đầu'}. Mỗi trang {10} món — bấm Xem thêm để tải tiếp.</div>
                                {/* A1 (rà soát chỉ số 2026-11-15): nút chuyển lọc bán chạy ↔ bán chậm —
                                    backend đã có bộ lọc 'slow', trước đây không nút nào gọi changePFilter */}
                                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                                    <button className={'m-btn m-btn-sm ' + (pFilter === 'slow' ? 'm-btn-ghost' : 'm-btn-primary')} onClick={() => changePFilter('top')}>Bán chạy nhất</button>
                                    <button className={'m-btn m-btn-sm ' + (pFilter === 'slow' ? 'm-btn-primary' : 'm-btn-ghost')} onClick={() => changePFilter('slow')}>Bán chậm nhất</button>
                                </div>
                                <div className="tbl-wrap"><table className="tbl">
                                    <tbody>
                                    <tr><th className="num">#</th><th>Món</th><th className="num">SL bán</th><th className="num">Doanh thu</th></tr>
                                    {prodList.map((t, i) => (
                                        <tr key={i}>
                                            <td className="num">{i + 1}</td>
                                            <td className="prod">{t.name}</td>
                                            <td className="num">{fmtInt(t.quantity)}</td>
                                            <td className="num"><b>{fmtVND(t.revenue)}</b></td>
                                        </tr>
                                    ))}
                                    {prodList.length === 0 && (<tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>Chưa có mặt hàng nào phát sinh trong kỳ.</td></tr>)}
                                    </tbody>
                                </table></div>
                                {prodMeta.has_more && (
                                    <button className="m-btn m-btn-ghost" style={{ marginTop: 10 }} onClick={moreProducts}>Xem thêm ({fmtInt(prodMeta.total - prodList.length)} món nữa)</button>
                                )}
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
                        <div className="card">
                            <h3>Theo ca thu ngân</h3>
                            <div className="sub">Đơn, doanh thu, AOV từng ca — đối chiếu với tiền két cuối ca.</div>
                            {(r.by_shift || []).map((m) => (
                                <div className="ch-row" key={m.key}>
                                    <div className="nm">{m.name}</div>
                                    <div className="ch-bar"><div className="ch-fill" style={{ width: m.share + '%', background: '#7C8DB0' }} /></div>
                                    <div className="ch-val"><b>{fmtVND(m.value)}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtInt(m.orders)} đơn · AOV {fmtVND(m.avg)}</div></div>
                                </div>
                            ))}
                            {(r.by_shift || []).length === 0 && <div className="sub">Chưa có số liệu.</div>}
                        </div>
                        <div className="card">
                            <h3>Theo nhân viên thu ngân</h3>
                            <div className="sub">Đơn, doanh thu, AOV từng NV — đánh giá hiệu suất thu ngân.</div>
                            {(r.by_staff || []).map((m) => (
                                <div className="ch-row" key={m.key}>
                                    <div className="nm">{m.name}</div>
                                    <div className="ch-bar"><div className="ch-fill" style={{ width: m.share + '%', background: '#24305E' }} /></div>
                                    <div className="ch-val"><b>{fmtVND(m.value)}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtInt(m.orders)} đơn · AOV {fmtVND(m.avg)}</div></div>
                                </div>
                            ))}
                            {(r.by_staff || []).length === 0 && <div className="sub">Chưa có số liệu.</div>}
                        </div>
                        <Glossary keys={['gross', 'net', 'aov_display', 'commission']} />
                    </section>
                    )}
                    {/* TAB 3: THU-CHI & GIAO CA (theo demo v4) */}
                    {tab === 'cash' && data && (
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
                            {(() => {
                                const sal = (p.costs || []).find((c) => c.name === 'Lương');
                                const estimated = sal && sal.note && sal.note.includes('Ước tính');
                                return estimated ? (
                                    <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5, color: '#9a3412', fontWeight: 600 }}>
                                        ⚠ Chi phí lương là <b>ƯỚC TÍNH</b> — kỳ này chưa chốt lương. Số chính xác sau khi chốt ở trang Bảng lương.
                                    </div>
                                ) : null;
                            })()}
                            <div className="donut-wrap">
                                <div dangerouslySetInnerHTML={{ __html: donut(p.costs, p.cost_total, r?.net) }} />
                                <ul className="cost-legend">
                                    {p.costs.map((c, i) => (
                                        <li key={i}>
                                            <span className="dot" style={{ background: c.color }} />
                                            <span className="nm">{c.name}{c.note ? <span style={{ color: '#999', fontSize: 11 }}> ({c.note})</span> : null}</span>
                                            <span className="pc">{trimN(c.pct || 0)}%</span>
                                            <span className="am">{fmtVND(c.value)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                        <CashSummary branchId={branchId} />
                        <div className="card">
                            <h3>Phần B — Sổ dòng tiền</h3>
                            <div className="sub">Mỗi giao dịch có số dư lũy kế (running balance) — phát hiện "âm quỹ ảo" theo thời gian.</div>
                            {cashLoading && !cashData && <div className="sub">Đang tải sổ dòng tiền…</div>}
                            {cashData && cashData.items.length === 0 && <div className="sub">Chưa có giao dịch thu-chi.</div>}
                            {cashData && cashData.items.length > 0 && (
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Mã GD</th><th>Ngày</th><th>Loại</th><th>Hạng mục</th><th>Diễn giải</th><th>Quỹ / TK</th><th className="num">Thu (+)</th><th className="num">Chi (−)</th><th className="num">Số dư lũy kế</th></tr>
                                {cashData.items.slice(0, cashShown).map((t) => (
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
                            {cashData && cashData.items.length > 0 && (
                                <div className="sub" style={{ marginTop: 8 }}>
                                    Đang hiện {Math.min(cashShown, cashData.items.length)}/{cashData.items.length} giao dịch đã tải.
                                    {cashShown < cashData.items.length && (
                                        <button className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 10 }} onClick={() => setCashShown((v) => v + 30)}>Xem thêm</button>
                                    )}
                                </div>
                            )}
                            <div className="explain" style={{ marginTop: 12 }}><b>Nguyên tắc kế toán:</b> tách <b>ngày thực chi tiền</b> (lên sổ dòng tiền) khỏi <b>kỳ kế toán</b> (lên P&amp;L). VD: tiền nhà 6 tháng chi 1 lần → dòng tiền ghi 1 cục, P&amp;L phân bổ đều 6 tháng.</div>
                        </div>
                        <Glossary keys={['running', 'overshort', 'net']} />
                    </section>
                    )}

                    {/* TAB 4: P&L — tóm tắt + link trang chi tiết */}
                    {tab === 'pnl' && data && (
                    <section>
                        <div className="card">
                            <h3>Kết quả kinh doanh <span className="pill b">Net Revenue làm mốc 100%</span></h3>
                            <div className="kpis">
                                {kpi('Doanh thu thuần (Net)', fmtVND(netVal), deltaBadge(r.delta_revenue))}
                                {kpi('Giá vốn (COGS)', fmtVND(cogsVal), '<span class="delta flat">' + trimN(netVal > 0 ? cogsVal / netVal * 100 : 0) + '% / Net</span>')}
                                <div className="kpi hero">
                                    {/* Lát 2h (2026-11-04): lãi gộp tính trên CÙNG cơ số doanh thu
                                        với "Lợi nhuận ròng" bên dưới (p.revenue — đã gồm thu khác,
                                        theo công tắc thuế) trừ giá vốn. Trước đây gộp tính trên
                                        Net trong khi ròng tính trên cơ số hiển thị → ròng > gộp
                                        dù chi phí = 0. */}
                                    <div className="lb">Lợi nhuận gộp (Thu − COGS)</div>
                                    <div className="v">{fmtVND((Number(p?.revenue) || 0) - cogsVal)}</div>
                                    <span className="delta flat">{trimN((Number(p?.revenue) || 0) > 0 ? ((Number(p?.revenue) || 0) - cogsVal) / (Number(p?.revenue) || 0) * 100 : 0)}% / Thu</span>
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
                    {tab === 'waste' && data && (
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
                                <div className="sub">Chưa tải được dữ liệu phân tích thực đơn. Kiểm tra kết nối rồi bấm "Thử lại" ở đầu trang báo cáo.</div>
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
                        {/* SP-1 (chỉ số 360 đợt 1): biên đóng góp theo món SAU chiết khấu kênh */}
                        {menuData.by_channel_group && (
                        <div className="card">
                            <h3>Biên đóng góp theo món sau chiết khấu kênh (SP-1) <EstTag note="Chiết khấu kênh phân bổ theo doanh thu món trong kênh — số phân bổ ước tính. Phí marketing không phân bổ xuống món." /></h3>
                            <div style={{ marginBottom: 10 }}>
                                <span className="seg">
                                    <button className={sp1Group === 'platform' ? 'on' : ''} onClick={() => setSp1Group('platform')}>Kênh sàn (gộp)</button>
                                    <button className={sp1Group === 'direct' ? 'on' : ''} onClick={() => setSp1Group('direct')}>Kênh trực tiếp (quầy + Zalo)</button>
                                </span>
                            </div>
                            <div className="sub">Tỷ lệ chiết khấu phân bổ của nhóm kênh: <b>{trimN(menuData.by_channel_group[sp1Group].commission_rate)}%</b> · Biên đóng góp TB nhóm: <b>{trimN(menuData.by_channel_group[sp1Group].avg_cm_pct)}%</b>. CM/ly = Giá bán kênh − Giá vốn định lượng − Chiết khấu phân bổ/ly.</div>
                            <div className="tbl-wrap"><table className="tbl">
                                <tbody>
                                <tr><th>Món</th><th>Ô</th><th className="num">SL</th><th className="num">Giá bán</th><th className="num">Giá vốn</th><th className="num">CK phân bổ</th><th className="num">CM / ly</th><th className="num">CM %</th></tr>
                                {(menuData.by_channel_group[sp1Group].items || []).map((it) => (
                                    <tr key={it.product_id}>
                                        <td className="prod">{it.product_name}</td>
                                        <td>{{ star: '⭐ Sao', puzzle: '❓ Dấu hỏi', plowhorse: '🐴 Ngựa thồ', dog: '🐶 Cắt giảm' }[it.quadrant] || it.quadrant}</td>
                                        <td className="num">{fmtInt(it.qty)}</td>
                                        <td className="num">{fmtVND(it.price)}</td>
                                        <td className="num">{fmtVND(it.cogs_per_unit)}</td>
                                        <td className="num">{fmtVND(it.commission_alloc_per_unit)}</td>
                                        <td className="num" style={{ fontWeight: 700, color: Number(it.cm_per_unit) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtVND(it.cm_per_unit)}</td>
                                        <td className="num">{trimN(it.cm_pct)}%</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table></div>
                        </div>
                        )}
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
                                {/* N-2 (360 đợt 2): đơn nguồn bị gộp không tính là hủy — đếm riêng để tổng đối chiếu được. */}
                                {typeof cancelData.merged_count === 'number' && cancelData.merged_count > 0 && (
                                    <div className="sub">Đã gộp đơn (không tính là hủy): <b>{fmtInt(cancelData.merged_count)} đơn</b>.</div>
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
                                {/* VH-2 (chỉ số 360 đợt 1): hủy theo phía + đã thu tiền rồi hủy */}
                                {cancelData.vh2 && (
                                <>
                                    <h4 style={{ margin: '16px 0 10px', color: 'var(--navy)' }}>Hủy theo phía & đơn đã thu tiền rồi hủy (VH-2)</h4>
                                    <div className="kpis">
                                        <div className="kpi"><div className="lb">Tỷ lệ hủy kỳ này</div><div className="v">{trimN(cancelData.vh2.cancel_rate)}%</div><span className="delta flat">kỳ trước {trimN(cancelData.vh2.prev.cancel_rate)}%</span></div>
                                        <div className="kpi"><div className="lb">Đã thu tiền rồi hủy</div><div className="v">{fmtInt(cancelData.vh2.paid_cancelled)} đơn</div><span className="delta flat">{trimN(cancelData.vh2.paid_cancelled_pct)}% tổng đơn · kỳ trước {fmtInt(cancelData.vh2.prev.paid_cancelled)} đơn</span></div>
                                    </div>
                                    <div className="tbl-wrap"><table className="tbl">
                                        <tbody>
                                        <tr><th>Phía hủy</th><th className="num">Số đơn</th><th className="num">Tổng tiền</th><th className="num">% tổng hủy</th></tr>
                                        {cancelData.vh2.by_side.map((s) => (
                                            <tr key={s.side}>
                                                <td className="prod">{s.label}</td>
                                                <td className="num">{fmtInt(s.count)}</td>
                                                <td className="num">{fmtVND(s.total_amount)}</td>
                                                <td className="num">{trimN(s.pct_of_cancelled)}%</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table></div>
                                </>
                                )}
                                {/* CL-2 (chỉ số 360 đợt 1): hoàn tác xác nhận thanh toán */}
                                {cancelData.payment_undo && (
                                <>
                                    <h4 style={{ margin: '16px 0 10px', color: 'var(--navy)' }}>Hoàn tác xác nhận thanh toán (CL-2)</h4>
                                    <div className="sub">Trong kỳ: <b>{fmtInt(cancelData.payment_undo.count)} lượt</b> · tổng tiền đơn hoàn tác <b>{fmtVND(cancelData.payment_undo.amount)}</b>. Theo phía (danh mục nguyên nhân chuẩn N-2 — dữ kiện cũ chưa có mã vào nhóm chưa rõ phía): lỗi quán <b>{fmtInt(cancelData.payment_undo.by_cause.shop.count)} lượt · {fmtVND(cancelData.payment_undo.by_cause.shop.amount)}</b> · phía khách <b>{fmtInt(cancelData.payment_undo.by_cause.customer.count)} lượt · {fmtVND(cancelData.payment_undo.by_cause.customer.amount)}</b> · chưa rõ <b>{fmtInt(cancelData.payment_undo.by_cause.unknown.count)} lượt</b>.</div>
                                    {cancelData.payment_undo.by_reason.length > 0 && (
                                    <div className="tbl-wrap"><table className="tbl">
                                        <tbody>
                                        <tr><th>Lý do hoàn tác</th><th className="num">Số lượt</th><th className="num">Tổng tiền</th></tr>
                                        {cancelData.payment_undo.by_reason.map((g, i) => (
                                            <tr key={i}>
                                                <td className="prod">{g.reason}</td>
                                                <td className="num">{fmtInt(g.count)}</td>
                                                <td className="num">{fmtVND(g.amount)}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table></div>
                                    )}
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
                                                <td>{d.is_merged ? 'Gộp đơn' : (d.cancel_reason_code ? d.cancel_reason_label : (d.cancel_reason || '—'))}</td>
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
                        {opsData?.prep && (
                        <div className="card">
                            <h3>Phân vị thời gian pha chế (VH-1)</h3>
                            <div className="kpis">
                                <div className="kpi"><div className="lb">p50 (trung vị)</div><div className="v">{opsData.prep.p50_minutes !== null ? trimN(opsData.prep.p50_minutes) + ' phút' : '—'}</div><span className="delta flat">nửa số đơn xong trước mốc này</span></div>
                                <div className="kpi"><div className="lb">p90</div><div className="v">{opsData.prep.p90_minutes !== null ? trimN(opsData.prep.p90_minutes) + ' phút' : '—'}</div><span className="delta flat">90% đơn xong trước mốc này</span></div>
                                <div className="kpi"><div className="lb">Đơn vượt chuẩn {trimN(opsData.prep.standard_minutes)} phút</div><div className="v">{opsData.prep.over_standard_pct !== null ? trimN(opsData.prep.over_standard_pct) + '%' : '—'}</div><span className="delta flat">{fmtInt(opsData.prep.over_count)} đơn</span></div>
                                <div className="kpi"><div className="lb">Tỷ lệ phủ mốc</div><div className="v">{opsData.prep.coverage_pct !== null ? trimN(opsData.prep.coverage_pct) + '%' : '—'}</div><span className="delta flat">mẫu {fmtInt(opsData.prep.sample)}/{fmtInt(opsData.prep.completed)} đơn hoàn thành</span></div>
                            </div>
                            <div className="sub">Mẫu chỉ gồm đơn hoàn thành CÓ mốc bếp bấm sẵn sàng; {fmtInt(opsData.prep.missing_marks)} đơn thiếu mốc bị loại khỏi mẫu (không tính là 0 phút). Ngưỡng chuẩn cấu hình ở Thiết lập (prep_standard_minutes).</div>
                        </div>
                        )}
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

                    {/* Spec P4-C6: BÁO CÁO NHÂN SỰ */}
                    {tab === 'hr' && (<><HrTab branchId={branchId} /><HrMetricsBlock branchId={branchId} /></>)}

                    {/* Chỉ số 360 đợt 1: TAB KHÁCH HÀNG (gác lá reports.customers.view) */}
                    {tab === 'customers' && (
                    <section>
                        <CustomersTab data={custData} loading={custLoading} />
                    </section>
                    )}

                    {/* Chỉ số 360 đợt 2 — vòng nhỏ N-3 phương án (a): TAB MỤC TIÊU DOANH THU
                        (gác lá finance.targets.edit) — Chủ CN đọc/ghi mục tiêu khi không mở
                        được trang PNL; tái dùng nguyên RevenueTargetForm ở ReportsPnl.jsx. */}
                    {tab === 'targets' && (
                    <section className="card">
                        <h3>Mục tiêu doanh thu tháng</h3>
                        <p className="sub">Mục tiêu theo từng chi nhánh — dùng cho dự báo cuối tháng (TC-3) ở tab Tổng quan. Chủ Chi Nhánh chỉ thấy và ghi được mục tiêu của chi nhánh mình.</p>
                        {/* Vòng nhỏ N-3 §KP: tab Mục tiêu không gọi tải overview
                            (Chủ CN không có lá overview) — form đã hiện số vừa
                            lưu; TC-3 tải lại khi mở tab Tổng quan. */}
                        <RevenueTargetForm month={f.date.slice(0, 7)} branchId={branchId} branches={branches} canEdit={can('finance.targets.edit')} onSaved={() => {}} />
                    </section>
                    )}

                    {/* Ghi chú chung */}
                    <div className="foot">
                        <h4>Ghi chú về số liệu</h4>
                        <ul>
                            <li>Chỉ tính đơn đã thanh toán (<b>payment_status = paid</b>, chưa hủy) — khớp tab "Đã thanh toán" ở trang Hóa đơn.</li>
                            <li>VAT tính theo từng dòng món (thuế suất riêng của món, mặc định {meta?.vat_rate ?? '—'}% từ Thiết lập).</li>
                            <li>Vốn nguyên liệu ước tính từ định mức BOM × giá vốn bình quân các lô đang còn.</li>
                            <li>Chi phí ca lấy từ phiếu chi trong ca (shift_expenses); lý do chứa "lương" được xếp vào Lương.</li>
                            <li>Hao hụt = (Tồn đầu kỳ + Nhập trong kỳ − Tồn thực tế kiểm kê) − Tiêu thụ BOM. Dòng "⚠ ước tính" là chưa có phiếu kiểm kê.</li>
                        </ul>
                    </div>

                    </>}
                </main>
            </div>
        </AdminLayout>
    );
}

// Spec P4-C5: tổng hợp thu/chi theo danh mục + kỳ (dùng trong tab Thu-chi)
export function CashSummary({ branchId }) {
    const [data, setData] = useState(null);
    const [err, setErr] = useState(false); // UX 2026-10-26 (🟠T1): trước đây lỗi tải làm cả thẻ biến mất không dấu vết
    const [period, setPeriod] = useState('month');
    const loadCash = () => {
        axios.get(API + '/reports/cash-summary', { params: { branch_id: branchId, period } })
            .then((r) => { setData(r.data?.data); setErr(false); }).catch((e) => { noteExpired(e); setErr(true); });
    };
    useEffect(() => { loadCash(); }, [branchId, period]);
    if (err) return (<div className="card"><h3>Tổng hợp thu/chi theo danh mục</h3><p style={{ color: 'var(--m-danger)', fontSize: 13 }}>⚠ Không tải được dữ liệu thu/chi. <button onClick={loadCash} className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 8 }}>Thử lại</button></p></div>);
    if (!data) return null;
    const maxV = Math.max(1, ...data.buckets.map((b) => Math.max(b.income, b.expense)));
    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3>Tổng hợp thu/chi theo danh mục</h3>
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="m-select" style={{ width: 'auto' }}>
                    <option value="day">Ngày</option>
                    <option value="week">Tuần</option>
                    <option value="month">Tháng</option>
                </select>
            </div>
            <div className="kpis" style={{ marginBottom: 12 }}>
                <div className="kpi"><div className="lb">Tổng thu</div><div className="v" style={{ color: 'var(--green)' }}>{fmtVND(data.total_income)}</div></div>
                <div className="kpi"><div className="lb">Tổng chi</div><div className="v" style={{ color: 'var(--red)' }}>{fmtVND(data.total_expense)}</div></div>
                <div className="kpi"><div className="lb">Chênh lệch</div><div className="v">{fmtVND(data.net)}</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>Cơ cấu thu</div>
                    {(data.by_category || []).filter((c) => c.type === 'income').map((c, i) => (
                        <div className="ch-row" key={i}>
                            <div className="nm">{c.name}</div>
                            <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: '#16a34a' }} /></div>
                            <div className="ch-val"><b>{fmtVND(c.value)}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.share}%</div></div>
                        </div>
                    ))}
                </div>
                <div>
                    <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>Cơ cấu chi</div>
                    {(data.by_category || []).filter((c) => c.type === 'expense').map((c, i) => (
                        <div className="ch-row" key={i}>
                            <div className="nm">{c.name}</div>
                            <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: '#dc2626' }} /></div>
                            <div className="ch-val"><b>{fmtVND(c.value)}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.share}%</div></div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="sub" style={{ fontWeight: 700, margin: '12px 0 6px' }}>Thu/chi theo ngày</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                {data.buckets.map((b, i) => (
                    <div key={i} title={`${b.label}: thu ${fmtVND(b.income)}, chi ${fmtVND(b.expense)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', height: 100 }}>
                            <div style={{ flex: 1, background: '#16a34a', height: (b.income / maxV * 100) + '%' }} />
                            <div style={{ flex: 1, background: '#dc2626', height: (b.expense / maxV * 100) + '%' }} />
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>{b.label}</div>
                    </div>
                ))}
            </div>
            {/* TC-2 (chỉ số 360 đợt 1): dòng tiền theo ngày HIỆU LỰC TIỀN */}
            {data.tc2 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>Dòng tiền vận hành (TC-2) — cơ số ngày hiệu lực tiền</div>
                <div className="kpis" style={{ marginBottom: 8 }}>
                    <div className="kpi"><div className="lb">Tiền vào thực nhận</div><div className="v" style={{ color: 'var(--green)', fontSize: 19 }}>{fmtVND(data.tc2.cash_in)}</div></div>
                    <div className="kpi"><div className="lb">Tiền ra thực chi</div><div className="v" style={{ color: 'var(--red)', fontSize: 19 }}>{fmtVND(data.tc2.cash_out)}</div></div>
                    <div className="kpi"><div className="lb">Dòng tiền thuần</div><div className="v" style={{ fontSize: 19 }}>{fmtVND(data.tc2.net)}</div></div>
                </div>
                <div className="sub">Khác cơ số của sổ ở trên (ngày phát sinh): khối này tính theo ngày tiền thực sự vào/ra (paid_at) — phiếu công nợ chỉ vào sổ khi đã ghi thanh toán.</div>
                {data.tc2.platform_receivable && (
                <div style={{ marginTop: 10 }}>
                    <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>Tiền thực thu sàn theo kênh <EstTag note="Thực thu sàn tính theo mô hình %: doanh thu kênh trừ chiết khấu % cấu hình, giảm giá quán chịu và phí marketing nhập tay (cùng thành phần BH-1). Chưa phải số sàn trả thật — khi có file sàn (N-7) số thật sẽ thay thế." /></div>
                    <div className="tbl-wrap"><table className="tbl"><tbody>
                        <tr><th>Kênh sàn</th><th className="num">Doanh thu</th><th className="num">Chiết khấu</th><th className="num">Giảm giá quán chịu</th><th className="num">Phí marketing</th><th className="num">Thực thu</th></tr>
                        {(data.tc2.platform_receivable.channels || []).map((c) => (
                            <tr key={c.key}>
                                <td className="prod">{c.name}</td>
                                <td className="num">{fmtVND(c.revenue)}</td>
                                <td className="num">{fmtVND(c.commission)}</td>
                                <td className="num">{fmtVND(c.discount)}</td>
                                <td className="num">{c.incomplete ? '—' : fmtVND(c.marketing_fee)}</td>
                                <td className="num"><b>{c.incomplete ? '—' : fmtVND(c.estimated_received)}</b></td>
                            </tr>
                        ))}
                        <tr>
                            <td className="prod"><b>Tổng thực thu</b></td>
                            <td className="num" colSpan={4}></td>
                            <td className="num"><b>{fmtVND(data.tc2.platform_receivable.estimated_received)}</b></td>
                        </tr>
                    </tbody></table></div>
                    <div className="sub">{data.tc2.platform_receivable.note}{data.tc2.platform_receivable.has_incomplete ? ' Một số kênh chưa có phí marketing của kỳ (chưa đối soát trọn tháng) nên chưa tính được thực thu — hiện "—".' : ''}</div>
                </div>
                )}
            </div>
            )}
        </div>
    );
}

// Spec P4-C6: báo cáo nhân sự tổng hợp
function HrTab({ branchId }) {
    const [data, setData] = useState(null);
    const [hrErr, setHrErr] = useState(false); // UX 2026-10-26 (🟠T1): trước đây lỗi tải kẹt ở "Đang tải…" mãi
    const [hrTick, setHrTick] = useState(0);
    const [month, setMonth] = useState(() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); });
    useEffect(() => {
        axios.get(API + '/reports/hr-summary', { params: { month, branch_id: branchId } })
            .then((r) => { setData(r.data?.data); setHrErr(false); }).catch((e) => { noteExpired(e); setHrErr(true); });
    }, [month, branchId, hrTick]);
    if (hrErr) return <section><div className="card"><div className="sub" style={{ color: 'var(--m-danger)' }}>⚠ Không tải được báo cáo nhân sự. <button onClick={() => setHrTick((t) => t + 1)} className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 8 }}>Thử lại</button></div></div></section>;
    if (!data) return <section><div className="card"><div className="sub">Đang tải…</div></div></section>;
    return (
        <section>
            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3>Báo cáo nhân sự — tháng {month}</h3>
                    <MonthInput value={month} onChange={(v) => { if (validMonth(v)) setMonth(v); }} className="m-select" style={{ width: 120 }} />
                </div>
                {!data.locked && <div className="sub" style={{ color: '#b45309', marginBottom: 8 }}>⚠ Kỳ lương chưa chốt — cột lương thực nhận chưa có số liệu.</div>}
                {data.hours_source === 'attendance' && <div className="sub" style={{ color: '#b45309', marginBottom: 8 }}>ℹ Giờ công đang tạm tính từ chấm công — tháng này chưa "Đổ giờ công" vào bảng lương nên chưa có số chính thức.</div>}
                <div className="kpis" style={{ marginBottom: 12 }}>
                    <div className="kpi"><div className="lb">Tổng giờ công</div><div className="v">{data.total_hours}h</div></div>
                    <div className="kpi"><div className="lb">Tổng lương thực nhận</div><div className="v">{fmtVND(data.total_net)}</div></div>
                    <div className="kpi"><div className="lb">Số NV</div><div className="v">{data.rows.length}</div></div>
                </div>
                {data.warnings.length > 0 && (
                    <div style={{ border: '1px solid #f5c2c7', background: '#fff5f5', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#b42318', fontWeight: 600, fontSize: 13 }}>
                        ⚠ {data.warnings.length} NV vượt {data.over_hours_threshold}h/tháng: {data.warnings.map((w) => `${w.full_name} (${w.hours}h)`).join(', ')}
                    </div>
                )}
                <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>Top 5 NV giờ cao nhất</div>
                {(data.top_hours || []).map((r, i) => (
                    <div key={r.employee_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: i < (data.top_hours || []).length - 1 ? '1px solid var(--line)' : '0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{i + 1} {r.full_name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.branch_name}</div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <b style={{ color: 'var(--navy)', fontSize: 13 }}>{r.hours}h</b>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.workdays} ngày công{r.net != null && ' · ' + fmtVND(r.net)}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="card">
                <h3>Chi tiết theo nhân viên</h3>
                <div className="tbl-wrap"><table className="tbl"><tbody>
                    <tr><th>Nhân viên</th><th>Chi nhánh</th><th className="num">Giờ công</th><th className="num">Ngày công</th><th className="num">Lương thực nhận</th><th></th></tr>
                    {data.rows.map((r) => (
                        <tr key={r.employee_id} style={r.over_hours ? { background: '#fff5f5' } : undefined}>
                            <td className="prod">{r.full_name}</td>
                            <td>{r.branch_name}</td>
                            <td className="num">{r.hours}h</td>
                            <td className="num">{r.workdays}</td>
                            <td className="num"><b>{r.net != null ? fmtVND(r.net) : '—'}</b></td>
                            <td>{r.over_hours && <span style={{ color: '#b42318', fontWeight: 700, fontSize: 12 }}>⚠ Vượt giờ</span>}</td>
                        </tr>
                    ))}
                </tbody></table></div>
            </div>
        </section>
    );
}

// Chỉ số 360 đợt 1 — NS-1/NS-2: năng suất tuần + tuân thủ ca (endpoint riêng
// /reports/hr-metrics, tự quản kỳ tuần/tháng của chính nó).
function HrMetricsBlock({ branchId }) {
    const [data, setData] = useState(null);
    const [period, setPeriod] = useState('week');
    const [err, setErr] = useState(false);
    const load = useCallback(() => {
        axios.get(API + '/reports/hr-metrics', { params: { period, branch_id: branchId } })
            .then((r) => { setData(r.data?.data); setErr(false); })
            .catch((e) => { noteExpired(e); setErr(true); });
    }, [period, branchId]);
    useEffect(() => { load(); }, [load]);
    return (
        <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3>Năng suất theo tuần & tuân thủ ca (NS-1 · NS-2)</h3>
                <span className="seg">
                    <button className={period === 'week' ? 'on' : ''} onClick={() => setPeriod('week')}>4 tuần gần nhất</button>
                    <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Tháng hiện tại</button>
                </span>
            </div>
            {err && <div className="sub" style={{ color: 'var(--m-danger)' }}>⚠ Không tải được số liệu năng suất. <button onClick={load} className="m-btn m-btn-ghost m-btn-sm" style={{ marginLeft: 8 }}>Thử lại</button></div>}
            {!data && !err && <div className="sub">Đang tải…</div>}
            {data && (<>
                <div className="tbl-wrap"><table className="tbl"><tbody>
                    <tr><th>Tuần</th><th className="num">Doanh thu thuần</th><th className="num">Giờ công</th><th className="num">SPLH (doanh thu/giờ)</th><th className="num">Chi phí lương</th><th className="num">Labor %</th><th className="num">Quên chấm ra</th></tr>
                    {data.weeks.map((w) => (
                        <tr key={w.week_start}>
                            <td className="prod">{fmtD(w.week_start)} – {fmtD(w.week_end)} {w.is_estimate && <EstTag note="Chi phí lương tuần là ƯỚC TÍNH: giờ chấm công × đơn giá giờ. Chỉ tuần trùng trọn một tháng đã chốt lương mới dùng số đã chốt." />}</td>
                            <td className="num">{fmtVND(w.net)}</td>
                            <td className="num">{trimN(w.hours)}h</td>
                            <td className="num"><b>{w.splh !== null ? fmtVND(w.splh) : '—'}</b></td>
                            <td className="num">{fmtVND(w.labor_cost)}</td>
                            <td className="num">{w.labor_pct !== null ? trimN(w.labor_pct) + '%' : '—'}</td>
                            <td className="num">{fmtInt(w.missing_checkout)}</td>
                        </tr>
                    ))}
                </tbody></table></div>
                <div className="sub" style={{ fontWeight: 700, margin: '12px 0 6px' }}>Tuân thủ ca trong kỳ (NS-2)</div>
                <div className="kpis">
                    <div className="kpi"><div className="lb">Đi trễ &gt; 5 phút</div><div className="v">{fmtInt(data.compliance.late)}</div><span className="delta flat">trên {fmtInt(data.compliance.scheduled_shifts)} ca có lịch</span></div>
                    <div className="kpi"><div className="lb">Về sớm</div><div className="v">{fmtInt(data.compliance.early_leave)}</div><span className="delta flat">chấm ra trước giờ kết thúc</span></div>
                    <div className="kpi"><div className="lb">Vắng không phép</div><div className="v" style={data.compliance.no_show > 0 ? { color: 'var(--red)' } : undefined}>{fmtInt(data.compliance.no_show)}</div><span className="delta flat">có lịch nhưng không chấm công</span></div>
                    <div className="kpi"><div className="lb">Giờ tăng ca <EstTag note="Giờ tăng ca = phần giờ thực làm vượt lịch ca, định giá theo đơn giá giờ — số ước tính tới khi có quy chế hệ số tăng ca riêng." /></div><div className="v">{trimN(data.compliance.overtime_hours)}h</div><span className="delta flat">≈ {fmtVND(data.compliance.overtime_cost)}</span></div>
                </div>
                <div className="sub">Mốc lịch ca sửa gần nhất: {data.compliance.schedule_last_modified ? fmtD(data.compliance.schedule_last_modified) : '—'}. Sửa lịch SAU ngày công thì giờ công của ngày đó có thể đã khác lịch hiện tại.</div>
            </>)}
        </div>
    );
}

// Chỉ số 360 đợt 1 — tab Khách hàng (KH-1→KH-5 + Marketing MK-1→MK-3 + CL-1).
// Khối Marketing CHỈ có mặt khi backend trả marketing !== null (gác lá ở server).
function CustomersTab({ data, loading }) {
    if (loading && !data) return <div className="card">Đang tải số liệu khách hàng…</div>;
    if (!data) return <div className="card"><h3>Khách hàng</h3><div className="sub">Chưa tải được dữ liệu. Kiểm tra kết nối rồi bấm "Thử lại" ở đầu trang báo cáo.</div></div>;
    const cov = data.coverage || {};
    const kh1 = data.kh1 || {};
    const kh2 = data.kh2 || { matrix: [], frequency: [] };
    const kh3 = data.kh3 || {};
    const kh4 = data.kh4 || { top_clv: [], churn_risk: [] };
    const kh5 = data.kh5 || { cohorts: [] };
    const tierName = (id) => (kh2.tiers || []).find((t) => t.id === id)?.name || ('#' + id);
    const matrixMap = {};
    (kh2.matrix || []).forEach((c) => { matrixMap[c.from_tier_id + '>' + c.to_tier_id] = c; });
    const tierIds = (kh2.tiers || []).map((t) => t.id);
    return (<>
        <div className="card">
            <h3>Phương pháp & phạm vi</h3>
            <div className="sub">Mọi chỉ số khách chỉ tính trên <b>tập khách định danh</b> (đơn có gắn khách hàng). Kỳ này: <b>{fmtInt(cov.identified_orders)}/{fmtInt(cov.total_orders)} đơn định danh — tỷ lệ phủ {trimN(cov.pct)}%</b>. Đơn không định danh KHÔNG được suy đoán là khách vãng lai. Chỉ số chuyển hạng (KH-2) và nợ điểm (KH-3) là số <b>toàn hệ</b> — điểm và hạng không thuộc một chi nhánh nên không chia theo chi nhánh.{data.meta?.scope_note ? ' ' + data.meta.scope_note : ''}</div>
        </div>

        <div className="card">
            <h3>Mua lại & khách mới (KH-1)</h3>
            <div className="kpis">
                <div className="kpi"><div className="lb">Tỷ lệ mua lại 90 ngày</div><div className="v">{trimN(kh1.repeat_90?.rate)}%</div><span className="delta flat">{fmtInt(kh1.repeat_90?.repeat_customers)}/{fmtInt(kh1.repeat_90?.customers)} khách có ≥2 đơn</span></div>
                <div className="kpi"><div className="lb">Tỷ lệ mua lại 365 ngày</div><div className="v">{trimN(kh1.repeat_365?.rate)}%</div><span className="delta flat">{fmtInt(kh1.repeat_365?.repeat_customers)}/{fmtInt(kh1.repeat_365?.customers)} khách có ≥2 đơn</span></div>
                <div className="kpi"><div className="lb">Khách mới trong kỳ</div><div className="v">{fmtInt(kh1.new_customers)}</div><span className="delta flat">đơn hiệu lực đầu tiên rơi vào kỳ</span></div>
                <div className="kpi"><div className="lb">Khách quay lại trong kỳ</div><div className="v">{fmtInt(kh1.returning_customers)}</div><span className="delta flat">tổng khách hoạt động {fmtInt(kh1.active_customers)}</span></div>
            </div>
        </div>

        <div className="card">
            <h3>Chuyển hạng trong kỳ (KH-2) — số toàn hệ</h3>
            <div className="sub">Ô = số khách có hạng đầu kỳ → hạng cuối kỳ (hạng suy từ nhật ký chuyển hạng; khách chưa từng có log thì hạng hiện tại ở cả hai đầu). Lên/xuống tự nhiên theo điểm: <b>{fmtInt(kh2.natural_moves)} lượt</b> · gán tay: <b>{fmtInt(kh2.manual_moves)} lượt</b>. Cột doanh thu kỳ của nhóm khách trong ô nằm ở bảng chi tiết dưới ma trận.</div>
            <div className="tbl-wrap"><table className="tbl"><tbody>
                <tr><th>Đầu kỳ ↓ / Cuối kỳ →</th>{tierIds.map((id) => <th key={id} className="num">{tierName(id)}</th>)}<th className="num">Tổng</th></tr>
                {tierIds.map((from) => (
                    <tr key={from}>
                        <td className="prod">{tierName(from)}</td>
                        {tierIds.map((to) => { const c = matrixMap[from + '>' + to]; return <td key={to} className="num" style={from === to ? { fontWeight: 700 } : undefined}>{c ? fmtInt(c.customers) : '·'}</td>; })}
                        <td className="num"><b>{fmtInt(tierIds.reduce((s, to) => s + (matrixMap[from + '>' + to]?.customers || 0), 0))}</b></td>
                    </tr>
                ))}
            </tbody></table></div>
            {(kh2.matrix || []).length > 0 && (
            <div className="tbl-wrap" style={{ marginTop: 10 }}><table className="tbl"><tbody>
                <tr><th>Chuyển hạng</th><th className="num">Số khách</th><th className="num">Doanh thu kỳ của nhóm</th></tr>
                {kh2.matrix.map((c, i) => (<tr key={i}><td className="prod">{c.from_tier} → {c.to_tier}</td><td className="num">{fmtInt(c.customers)}</td><td className="num">{fmtVND(c.revenue)}</td></tr>))}
            </tbody></table></div>
            )}
            <div className="sub" style={{ fontWeight: 700, margin: '12px 0 6px' }}>Tần suất mua trong kỳ (toàn hệ — thuộc KH-2)</div>
            <div className="tbl-wrap"><table className="tbl"><tbody>
                <tr><th>Nhóm tần suất</th><th className="num">Số khách</th></tr>
                {(kh2.frequency || []).map((b) => (<tr key={b.bucket}><td className="prod">{b.bucket} đơn</td><td className="num">{fmtInt(b.customers)}</td></tr>))}
            </tbody></table></div>
            {/* N-5 (360 đợt 2): mốc đổi ngưỡng hạng trong kỳ — KH-2 đọc theo ngưỡng mới */}
            {(data.config_markers?.membership_tier || []).length > 0 && (
                <div className="sub" style={{ marginTop: 8 }}>
                    {(data.config_markers.membership_tier || []).map((m, i) => (
                        <div key={i}>📅 Cấu hình đổi {m.changed_at}: <b>{m.label}</b> — {CONFIG_FIELD_LABELS[m.field] || m.field}: {fmtConfigValue(m.field, m.old_value)} → {fmtConfigValue(m.field, m.new_value)}{m.changed_by_name ? ' (' + m.changed_by_name + ')' : ''}.</div>
                    ))}
                </div>
            )}
        </div>

        <div className="card">
            <h3>Nợ điểm & vòng đời điểm (KH-3) — số toàn hệ</h3>
            <div className="kpis">
                <div className="kpi"><div className="lb">Điểm đang nợ khách</div><div className="v">{fmtInt(kh3.liability_points)}</div><span className="delta flat">tại cuối kỳ</span></div>
                <div className="kpi"><div className="lb">Giá trị quy đổi</div><div className="v">{fmtVND(kh3.liability_value)}</div><span className="delta flat">{fmtVND(kh3.value_per_point)}/điểm</span></div>
                <div className="kpi"><div className="lb">Điểm phát hành trong kỳ</div><div className="v">{fmtInt(kh3.issued)}</div><span className="delta flat">mọi nguồn</span></div>
                <div className="kpi"><div className="lb">Điểm đã dùng trong kỳ</div><div className="v">{fmtInt(kh3.redeemed)}</div><span className="delta flat">giá trị {fmtVND(kh3.redeemed_value)}</span></div>
            </div>
            <div className="sub">Điểm hết hạn trong kỳ: <b>{fmtInt(kh3.expired)}</b> · Tỷ lệ dùng điểm lũy kế (đã dùng ÷ đã phát hành toàn thời gian): <b>{kh3.redeem_rate_cumulative !== null && kh3.redeem_rate_cumulative !== undefined ? trimN(kh3.redeem_rate_cumulative) + '%' : '—'}</b>. Tồn điểm cuối kỳ lấy theo tồn lô hiện tại (chưa có ảnh chụp tồn theo ngày lịch sử).</div>
            {/* N-5 (360 đợt 2): mốc đổi giá trị quy đổi điểm trong kỳ — KH-3 đọc theo giá mới */}
            {(data.config_markers?.point_value || []).length > 0 && (
                <div className="sub" style={{ marginTop: 8 }}>
                    {(data.config_markers.point_value || []).map((m, i) => (
                        <div key={i}>📅 Cấu hình đổi {m.changed_at}: <b>{m.label}</b> — {CONFIG_FIELD_LABELS[m.field] || m.field}: {fmtConfigValue(m.field, m.old_value)} → {fmtConfigValue(m.field, m.new_value)}{m.changed_by_name ? ' (' + m.changed_by_name + ')' : ''}.</div>
                    ))}
                </div>
            )}
        </div>

        <div className="two">
            <div className="card">
                <h3>Giá trị trọn đời — Top khách (KH-4)</h3>
                <div className="tbl-wrap"><table className="tbl"><tbody>
                    <tr><th>Khách</th><th className="num">Số đơn</th><th className="num">CLV (doanh thu lũy kế)</th></tr>
                    {(kh4.top_clv || []).map((c) => (<tr key={c.customer_id}><td className="prod">{c.name || c.code || ('#' + c.customer_id)}</td><td className="num">{fmtInt(c.orders)}</td><td className="num"><b>{fmtVND(c.lifetime_revenue)}</b></td></tr>))}
                </tbody></table></div>
            </div>
            <div className="card">
                <h3>Nguy cơ rời bỏ (KH-4)</h3>
                <div className="sub">Khách có ≥3 đơn nhưng đã quá 2× khoảng cách mua trung bình của chính họ mà chưa quay lại.</div>
                <div className="tbl-wrap"><table className="tbl"><tbody>
                    <tr><th>Khách</th><th className="num">Đơn</th><th className="num">CLV</th><th className="num">Ngày im lặng</th></tr>
                    {(kh4.churn_risk || []).map((c) => (<tr key={c.customer_id}><td className="prod">{c.name || c.code || ('#' + c.customer_id)}</td><td className="num">{fmtInt(c.orders)}</td><td className="num">{fmtVND(c.lifetime_revenue)}</td><td className="num" style={{ color: 'var(--red)', fontWeight: 700 }}>{fmtInt(c.days_since_last)} ngày</td></tr>))}
                </tbody></table></div>
            </div>
        </div>

        <div className="card">
            <h3>Cohort theo quý đăng ký (KH-5)</h3>
            <div className="sub">% khách của quý còn mua lại ở tháng +1/+2/+3 sau tháng đăng ký. Ô "—" = tháng đó chưa tới.</div>
            <div className="tbl-wrap"><table className="tbl"><tbody>
                <tr><th>Quý đăng ký</th><th className="num">Số khách</th><th className="num">Giữ chân M+1</th><th className="num">M+2</th><th className="num">M+3</th></tr>
                {(kh5.cohorts || []).map((c) => (<tr key={c.quarter}><td className="prod">{c.quarter}</td><td className="num">{fmtInt(c.customers)}</td><td className="num">{c.m1 === null ? '—' : trimN(c.m1) + '%'}</td><td className="num">{c.m2 === null ? '—' : trimN(c.m2) + '%'}</td><td className="num">{c.m3 === null ? '—' : trimN(c.m3) + '%'}</td></tr>))}
            </tbody></table></div>
        </div>

        {data.marketing && (
        <div className="card">
            <h3>Marketing — hiệu quả khuyến mãi (MK-1)</h3>
            <div className="explain">Đây là <b>hiệu quả quan sát</b> — doanh thu của đơn CÓ khuyến mãi, <b>không phải</b> toàn bộ là doanh thu tăng thêm do khuyến mãi tạo ra.</div>
            <div className="kpis">
                <div className="kpi"><div className="lb">AOV đơn có KM</div><div className="v">{data.marketing.mk1_summary?.aov_with !== null && data.marketing.mk1_summary?.aov_with !== undefined ? fmtVND(data.marketing.mk1_summary.aov_with) : '—'}</div><span className="delta flat">{fmtInt(data.marketing.mk1_summary?.orders_with)} đơn</span></div>
                <div className="kpi"><div className="lb">AOV đơn không KM</div><div className="v">{data.marketing.mk1_summary?.aov_without !== null && data.marketing.mk1_summary?.aov_without !== undefined ? fmtVND(data.marketing.mk1_summary.aov_without) : '—'}</div><span className="delta flat">{fmtInt(data.marketing.mk1_summary?.orders_without)} đơn</span></div>
            </div>
            <div className="sub" style={{ fontWeight: 700, margin: '10px 0 6px' }}>Theo chương trình khuyến mãi</div>
            <div className="tbl-wrap"><table className="tbl"><tbody>
                <tr><th>Chương trình</th><th className="num">Đơn dùng</th><th className="num">Tổng giảm</th><th className="num">Doanh thu đơn dùng</th><th className="num">AOV</th></tr>
                {(data.marketing.mk1?.promotion || []).map((p) => (<tr key={p.promotion_id}><td className="prod">{p.name}</td><td className="num">{fmtInt(p.used)}</td><td className="num">{fmtVND(p.discount)}</td><td className="num">{fmtVND(p.revenue)}</td><td className="num">{fmtVND(p.aov)}</td></tr>))}
            </tbody></table></div>
            <div className="sub" style={{ fontWeight: 700, margin: '12px 0 6px' }}>Theo coupon (ví khách)</div>
            <div className="tbl-wrap"><table className="tbl"><tbody>
                <tr><th>Chương trình nguồn</th><th className="num">Đã phát hành</th><th className="num">Đã dùng trong kỳ</th><th className="num">Tổng giảm</th><th className="num">Doanh thu đơn dùng</th><th className="num">AOV</th></tr>
                {(data.marketing.mk1?.coupon || []).map((p) => (<tr key={p.promotion_id}><td className="prod">{p.name}</td><td className="num">{fmtInt(p.issued)}</td><td className="num">{fmtInt(p.used)}</td><td className="num">{fmtVND(p.discount)}</td><td className="num">{fmtVND(p.revenue)}</td><td className="num">{fmtVND(p.aov)}</td></tr>))}
            </tbody></table></div>
            <div className="sub">Tổng giảm của coupon = phần giảm của đơn trừ phần giảm chương trình KM chính — đơn dùng đồng thời voucher gõ tay chưa tách được phần voucher. Tỷ lệ dùng coupon = đã dùng ÷ đã phát hành.</div>

            <div className="sub" style={{ fontWeight: 700, margin: '14px 0 6px' }}>Điểm theo nguồn phát hành (MK-2)</div>
            <div className="tbl-wrap"><table className="tbl"><tbody>
                <tr><th>Nguồn</th><th className="num">Điểm phát hành</th><th className="num">Giá trị quy đổi</th></tr>
                {(data.marketing.mk2 || []).map((s) => (<tr key={s.source}><td className="prod">{s.label}</td><td className="num">{fmtInt(s.points)}</td><td className="num">{fmtVND(s.value)}</td></tr>))}
            </tbody></table></div>

            <div className="sub" style={{ fontWeight: 700, margin: '14px 0 6px' }}>Giới thiệu bạn bè (MK-3)</div>
            <div className="kpis">
                <div className="kpi"><div className="lb">Người giới thiệu</div><div className="v">{fmtInt(data.marketing.mk3?.referrers)}</div><span className="delta flat">có khách đăng ký trong kỳ</span></div>
                <div className="kpi"><div className="lb">Khách được giới thiệu</div><div className="v">{fmtInt(data.marketing.mk3?.referrals)}</div><span className="delta flat">đăng ký trong kỳ</span></div>
                <div className="kpi"><div className="lb">Đã hoàn tất đơn đầu</div><div className="v">{fmtInt(data.marketing.mk3?.completed)}</div><span className="delta flat">tỷ lệ {trimN(data.marketing.mk3?.completion_rate)}%</span></div>
                <div className="kpi"><div className="lb">Doanh thu trọn đời nhóm này</div><div className="v">{fmtVND(data.marketing.mk3?.referred_lifetime_revenue)}</div><span className="delta flat">toàn thời gian</span></div>
            </div>
        </div>
        )}

        <div className="card">
            <h3>Đánh giá khách hàng (CL-1)</h3>
            <div className="sub">Hệ thống <b>chưa thu thập</b> đánh giá sao từ khách — chỉ số này sẽ có khi tính năng chấm sao trên Mini App (đợt 2) đi vào hoạt động. Không hiện số 0 giả.</div>
        </div>
    </>);
}
