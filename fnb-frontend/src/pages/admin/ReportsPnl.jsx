import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import DateInput from '../../components/DateInput';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { API } from '../../utils/api';
import {
    REPORT_CSS, kpi, fmtInt, fmtVND, trimN, fmtD, todayStr, deltaBadge,
    groupChart, donut, PERIOD_NAMES, COMPARE_NAMES,
} from './reportShared';

// =====================================================================
// Gói 17 (2026-10-09): Báo cáo thu chi / PNL — route /admin/reports/pnl.
// Dữ liệu: GET /api/reports/pnl (branch_id, period, date, compare, tax_included).
// Chi phí gồm: vốn NL + Lương + Chi khác + Chiết khấu kênh bán.
// =====================================================================


export default function ReportsPnl() {
    const [branches, setBranches] = useState([]);
    // C3 (2026-10-21): CN của báo cáo = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều
    // với dropdown sidebar ('0' = Tất cả ở cả hai nơi).
    const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
    const [f, setF] = useState({
        branch_id: ctxBranchId, period: 'week', date: todayStr(),
        compare: 'previous', compare_from: '', compare_to: '', tax_included: '1',
    });
    useEffect(() => {
        setF((prev) => (prev.branch_id === ctxBranchId ? prev : { ...prev, branch_id: ctxBranchId }));
    }, [ctxBranchId]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errMsg, setErrMsg] = useState('');

    useEffect(() => {
        axios.get(API + '/branches')
            .then((r) => { if (r.data?.success) setBranches(r.data.data || []); })
            .catch(() => {});
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setErrMsg('');
        try {
            const res = await axios.get(API + '/reports/pnl', {
                params: {
                    branch_id: f.branch_id, period: f.period, date: f.date,
                    compare: f.compare,
                    compare_from: f.compare_from || undefined,
                    compare_to: f.compare_to || undefined,
                    tax_included: f.tax_included,
                },
            });
            if (res.data?.success) setData(res.data.data);
        } catch (e) {
            console.error('Lỗi tải báo cáo PNL:', e);
            const detail = e?.response?.data?.message || e?.message || '';
            setErrMsg('Không tải được số liệu báo cáo.' + (detail ? ' Chi tiết: ' + detail : ''));
        }
        setLoading(false);
    }, [f]);

    useEffect(() => { load(); }, [load]);

    const set = (k, v) => {
        if (k === 'branch_id') setCtxBranchId(v); // C3: đổi CN trong trang = đổi trạng thái chung
        setF((prev) => ({ ...prev, [k]: v }));
    };
    const meta = data?.meta;
    const rev = data?.revenue;
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
            <style>{REPORT_CSS}</style>
            <div className="rpt">
                <div style={{ padding: '20px 20px 0' }}>
                    <h1 className="text-xl font-semibold text-gray-800">Báo cáo thu – chi / PNL</h1>
                    <p className="text-[13px] text-gray-500">Lợi nhuận = Thu − Chi (chi gồm vốn nguyên liệu, lương, chi khác và chiết khấu kênh bán)</p>
                </div>

                <div className="filters">
                    <div className="in">
                        <div className="f-item">
                            <label>Chi nhánh</label>
                            <select value={f.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
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
                        {/* C5 (2026-10-21): ghi chú phạm vi chi phí chung khi xem 1 CN */}
                        {f.branch_id !== '0' && (
                            <div style={{ marginTop: 4, color: '#92400E' }}>
                                Lưu ý: số của chi nhánh này <b>chưa gồm chi phí chung toàn chuỗi</b> (phiếu không gắn chi nhánh + chi phí trả trước chung) — các khoản đó chỉ tính ở view "Tất cả chi nhánh".
                            </div>
                        )}
                    </div>
                )}

                <main className="wrap" style={{ paddingTop: 12 }}>
                    {loading && !data && <div className="card">Đang tải số liệu…</div>}
                    {!loading && errMsg && !data && (
                        <div className="card" style={{ border: '1px solid #f5c2c7', background: '#fff5f5' }}>
                            <div style={{ color: '#b42318', fontWeight: 600, marginBottom: 6 }}>{errMsg}</div>
                            <button onClick={load} className="btn btn-navy" style={{ marginTop: 4 }}>Thử tải lại</button>
                        </div>
                    )}
                    {data && (<>

                    {/* KPI */}
                    <div className="card">
                        <h3>Tổng quan
                            <span className="seg">
                                <button className={f.tax_included === '1' ? 'on' : ''} onClick={() => set('tax_included', '1')}>Đã gồm thuế</button>
                                <button className={f.tax_included === '0' ? 'on' : ''} onClick={() => set('tax_included', '0')}>Chưa gồm thuế</button>
                            </span>
                        </h3>
                        <div className="kpis">
                            {kpi('Thu (doanh thu)', fmtVND(rev.displayed), deltaBadge(data.delta_revenue))}
                            {kpi('Chi phí', fmtVND(data.cost_total), deltaBadge(data.delta_cost, false))}
                            <div className="kpi hero">
                                <div className="lb">Lợi nhuận = Thu − Chi</div>
                                <div className="v">{fmtVND(data.profit)}</div>
                                <span dangerouslySetInnerHTML={{ __html: deltaBadge(data.delta_profit) }} />
                            </div>
                            {kpi('Biên lợi nhuận', trimN(data.margin) + '%', '<span class="delta flat">—</span>')}
                        </div>
                        <div className="sub">Thuế GTGT {meta.vat_rate}% · {fmtInt(rev.orders)} đơn trong kỳ.{Number(rev.other_income) > 0 && <> Trong đó thu khác (phiếu thu tay): <b>{fmtVND(rev.other_income)}</b>.</>}</div>
                    </div>

                    <div className="two">
                        {/* THU THEO KÊNH */}
                        <div className="card">
                            <h3>Báo cáo thu theo kênh</h3>
                            {data.income_channels.map((c) => (
                                <div className="ch-row" key={c.key}>
                                    <div className="nm">{c.name}</div>
                                    <div className="ch-bar"><div className="ch-fill" style={{ width: c.share + '%', background: c.color }} /></div>
                                    <div className="ch-val"><b>{fmtVND(c.value)}</b><span dangerouslySetInnerHTML={{ __html: deltaBadge(c.delta) }} /></div>
                                </div>
                            ))}
                        </div>
                        {/* CƠ CẤU CHI PHÍ */}
                        <div className="card">
                            <h3>Báo cáo chi — cơ cấu chi phí</h3>
                            <div className="donut-wrap">
                                <div dangerouslySetInnerHTML={{ __html: donut(data.costs, data.cost_total) }} />
                                <ul className="cost-legend">
                                    {data.costs.map((c, i) => (
                                        <li key={i}>
                                            <span className="dot" style={{ background: c.color }} />
                                            <span className="nm">{c.name}{c.note ? <span style={{ color: '#999', fontSize: 11 }}> ({c.note})</span> : null}</span>
                                            <span className="pc">{trimN(data.cost_total > 0 ? c.value / data.cost_total * 100 : 0)}%</span>
                                            <span className="am">{fmtVND(c.value)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* CHI TIẾT CHIẾT KHẤU KÊNH */}
                    <div className="card">
                        <h3>Chi tiết chiết khấu kênh bán</h3>                        <div className="sub">Chiết khấu nền tảng thu trên doanh thu từng kênh — cấu hình tại trang Kênh bán hàng.</div>
                        {(data.commissions || []).length === 0 ? (
                            <div className="sub">Chưa cấu hình chiết khấu cho kênh nào (vào Kênh bán hàng → Sửa → nhập % chiết khấu).</div>
                        ) : (
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Kênh</th><th>Bảng giá áp dụng</th><th className="num">% chiết khấu</th><th className="num">Doanh thu kênh</th><th className="num">Chi phí CK</th></tr>
                            {(data.commissions || []).map((c, i) => (
                                <tr key={i}>
                                    <td className="prod">{c.channel}</td>
                                    <td>{c.price_list}</td>
                                    <td className="num"><b>{trimN(c.rate)}%</b> <span style={{ color: 'var(--muted)', fontSize: 11 }}>({c.tax_note})</span></td>
                                    <td className="num">{fmtVND(c.revenue)}</td>
                                    <td className="num" style={{ color: 'var(--red)', fontWeight: 700 }}>{fmtVND(c.cost)}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table></div>
                        )}
                    </div>

                    {/* Gói 58: CHI PHÍ PHÂN BỔ (thuê trả trước / CAPEX) — chỉ hiện khi API trả về */}
                    {Array.isArray(data.allocated_expenses) && data.allocated_expenses.length > 0 && (
                    <div className="card">
                        <h3>Chi phí phân bổ theo kỳ</h3>
                        <div className="sub">Tiền thuê trả trước &amp; CAPEX được phân bổ đều vào từng kỳ kế toán (thay vì ghi 1 cục lúc chi tiền).</div>
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Khoản mục</th><th>Loại</th><th className="num">Tổng giá trị</th><th className="num">Số kỳ</th><th className="num">Phân bổ kỳ này</th></tr>
                            {(data.allocated_expenses || []).map((c, i) => (
                                <tr key={i}>
                                    <td className="prod">{c.name}</td>
                                    <td>{c.type === 'capex' ? 'CAPEX' : 'Trả trước'}</td>
                                    <td className="num">{fmtVND(c.total_amount)}</td>
                                    <td className="num">{fmtInt(c.periods)} tháng</td>
                                    <td className="num"><b>{fmtVND(c.allocated_amount)}</b></td>
                                </tr>
                            ))}
                            </tbody>
                        </table></div>
                    </div>
                    )}

                    {/* THU CHI THEO KỲ */}
                    <div className="card">
                        <h3>Thu – Chi – Lợi nhuận theo kỳ <span dangerouslySetInnerHTML={{ __html: deltaBadge(data.delta_profit) }} /></h3>
                        <div dangerouslySetInnerHTML={{ __html: groupChart(data.groups) }} />
                        <div className="legend">
                            <span><span className="dot" style={{ background: '#24305E' }} />Thu</span>
                            <span><span className="dot" style={{ background: '#D64545' }} />Chi</span>
                            <span><span className="dot" style={{ background: '#1E9E5A' }} />Lợi nhuận</span>
                        </div>
                    </div>

                    <div className="foot">
                        <h4>📖 Chú thích thuật ngữ</h4>
                        <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}>
                            <tbody>
                            <tr><th>Thuật ngữ</th><th>Ý nghĩa</th></tr>
                            <tr><td><b>Net Revenue (Doanh thu thuần)</b></td><td>Gross − Giảm giá − Phí sàn. Mốc 100% để tính mọi tỷ trọng chi phí.</td></tr>
                            <tr><td><b>COGS (Cost of Goods Sold)</b></td><td>Giá vốn hàng bán — tính theo FIFO từ snapshot lúc bán.</td></tr>
                            <tr><td><b>Prime Cost</b></td><td>COGS + Chi phí nhân sự. "Chỉ số sống còn" — phải dưới 55%.</td></tr>
                            <tr><td><b>EBITDA</b></td><td>Lợi nhuận vận hành = Lợi nhuận gộp − Nhân sự − Chi phí vận hành (chưa trừ khấu hao, thuế).</td></tr>
                            <tr><td><b>Commission</b></td><td>Phí chiết khấu sàn (GrabFood/ShopeeFood ~20–25%) trích trên mỗi đơn.</td></tr>
                            </tbody>
                        </table></div>
                    </div>

                    <div className="foot" style={{ marginTop: 12 }}>
                        <h4>Ghi chú về số liệu</h4>
                        <ul>
                            <li><b>Thu</b> = doanh thu đơn đã thanh toán (payment_status = paid, chưa hủy) + <b>thu khác</b> (phiếu thu tay trong Sổ thu-chi).</li>
                            <li><b>Chi</b> = vốn nguyên liệu (BOM × giá vốn BQ lô) + lương &amp; chi khác (phiếu chi trong ca) + <b>chiết khấu kênh</b> (doanh thu kênh × % cấu hình).</li>
                            <li>Chiết khấu tính trên <b>doanh thu gồm VAT</b> của kênh; nếu cấu hình “chưa gồm thuế” thì cộng thêm thuế suất đã nhập.</li>
                            <li>Map kênh → bảng giá: Tại quầy → <b>nha_hang</b>; Zalo Mini App → <b>online</b> (hoặc zalo); GrabFood → <b>grabfood</b>.</li>
                        </ul>
                    </div>

                    </>)}
                </main>
            </div>
        </AdminLayout>
    );
}
