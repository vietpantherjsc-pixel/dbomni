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
import { useAuth } from '../../contexts/AuthContext'; // Cây phân quyền §2: cổng reports.pnl.view
import DateInput from '../../components/DateInput';
import MonthInput from '../../components/MonthInput'; // N-3 (360 đợt 2): chọn tháng mục tiêu
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { API } from '../../utils/api';
import {
    REPORT_CSS, kpi, fmtInt, fmtVND, trimN, fmtD, todayStr, deltaBadge,
    groupChart, donut, PERIOD_NAMES, COMPARE_NAMES, ReportNavTabs,
    CONFIG_FIELD_LABELS, fmtConfigValue,
} from './reportShared';

// =====================================================================
// Gói 17 (2026-10-09): Báo cáo thu chi / PNL — route /admin/reports/pnl.
// Dữ liệu: GET /api/reports/pnl (branch_id, period, date, compare, tax_included).
// Chi phí gồm: vốn NL + Lương + Chi khác + Chiết khấu kênh bán.
// =====================================================================

// N-3 (360 đợt 2): form nhập mục tiêu doanh thu tháng theo từng CN.
// Chỉ hiện ô nhập + nút Lưu khi có lá finance.targets.edit; không có lá
// thì chỉ hiện số mục tiêu đã đặt ở thẻ (đọc từ payload pnl).
// Vòng nhỏ phương án (a): export để tab "Mục tiêu doanh thu" trong
// Reports.jsx tái dùng nguyên form (Chủ CN không mở được trang PNL).
export function RevenueTargetForm({ month, branchId, branches, canEdit, onSaved }) {
    const [tMonth, setTMonth] = useState(month);
    const [tBranch, setTBranch] = useState(branchId !== '0' && branchId ? String(branchId) : '');
    const [amount, setAmount] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    // Vòng nhỏ N-3 §KQ: Chủ CN chỉ được ghi mục tiêu của CN mình (server đã
    // chặn CN khác, nhưng ô chọn vẫn liệt kê cả 2 CN khiến lỗi 403 báo sai
    // nguyên nhân) — khóa ô chọn về đúng CN của Chủ CN; Chủ Sở Hữu giữ nguyên.
    const { isBranchOwner, user } = useAuth();
    const lockedBranchId = isBranchOwner && user?.owner_branch_id != null ? String(user.owner_branch_id) : null;

    useEffect(() => { setTMonth(month); }, [month]);
    useEffect(() => {
        if (lockedBranchId) { setTBranch(lockedBranchId); return; }
        if (!tBranch && branches.length > 0) setTBranch(String(branches[0].id));
    }, [branches, lockedBranchId]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!tMonth || !tBranch) return;
        axios.get(API + '/reports/revenue-targets', { params: { month: tMonth, branch_id: 0 } })
            .then((r) => {
                const rows = r.data?.data?.targets || [];
                const row = rows.find((x) => String(x.branch_id) === String(tBranch));
                setAmount(row ? String(row.target_amount) : '');
            })
            .catch((e) => noteExpired(e));
    }, [tMonth, tBranch]);

    if (!canEdit) return (<div className="sub" style={{ marginTop: 8 }}>Bạn không có quyền ghi mục tiêu (cần lá finance.targets.edit).</div>);

    const save = async () => {
        if (!tBranch) return setMsg('Chọn chi nhánh.');
        const v = Number(amount);
        if (!Number.isFinite(v) || v < 0) return setMsg('Nhập mục tiêu là số tiền ≥ 0.');
        setSaving(true); setMsg('');
        try {
            await axios.post(API + '/reports/revenue-targets', { branch_id: Number(tBranch), month: tMonth, target_amount: v });
            setMsg('Đã lưu mục tiêu tháng ' + tMonth + '.');
            onSaved();
        } catch (e) {
            setMsg(e?.response?.status === 403 ? 'Không có quyền ghi mục tiêu (cần lá finance.targets.edit).' : (e?.response?.data?.message || 'Lưu thất bại.'));
        }
        setSaving(false);
    };

    return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
            <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Tháng</label>
                <MonthInput value={tMonth} onChange={setTMonth} />
            </div>
            <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Chi nhánh</label>
                <select value={tBranch} onChange={(e) => setTBranch(e.target.value)} disabled={!!lockedBranchId} style={{ height: 38, border: '1px solid #d9d9d9', borderRadius: 8, padding: '0 8px' }}>
                    {branches.filter((b) => !lockedBranchId || String(b.id) === lockedBranchId).map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                </select>
            </div>
            <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Mục tiêu doanh thu (đ)</label>
                <input type="number" min="0" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="VD: 150000000" style={{ height: 38, width: 180, border: '1px solid #d9d9d9', borderRadius: 8, padding: '0 8px' }} />
            </div>
            <button type="button" onClick={save} disabled={saving} className="m-btn m-btn-primary" style={{ height: 38, padding: '0 16px' }}>{saving ? 'Đang lưu…' : 'Lưu mục tiêu'}</button>
            {msg && <span style={{ fontSize: 13, color: msg.startsWith('Đã lưu') ? 'var(--green)' : 'var(--red)' }}>{msg}</span>}
        </div>
    );
}


export default function ReportsPnl() {
    const { can } = useAuth();
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
            .catch((e) => noteExpired(e));
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
            console.error('Chi tiết lỗi báo cáo:', e?.response?.data?.message || e?.message || '');
            setErrMsg('Không tải được số liệu báo cáo. Kiểm tra kết nối mạng rồi bấm Thử tải lại.');
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
    // PNL theo kênh (2026-11-15): cột phí marketing chỉ hiện khi payload có
    // ít nhất 1 kênh mang marketing_fee (kỳ có tháng trọn + đã đối soát sàn)
    // — cùng cách xử lý với thẻ kênh ở trang Báo cáo chính.
    const hasMkt = (data?.income_channels || []).some((c) => c.marketing_fee !== undefined && c.marketing_fee !== null);

    // Cây phân quyền §2: cổng trang reports.pnl.view.
    if (!can('reports.pnl.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem báo cáo P&L.</div></AdminLayout>);

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

                {/* Dải tab điều hướng danh mục dùng chung (Phương án B, 2026-11-15) */}
                <ReportNavTabs active="pnl" can={can} />

                <main className="wrap" style={{ paddingTop: 12 }}>
                    {loading && !data && <div className="card">Đang tải số liệu…</div>}
                    {!loading && errMsg && !data && (
                        <div className="card" style={{ border: '1px solid #f5c2c7', background: '#fff5f5' }}>
                            <div style={{ color: '#b42318', fontWeight: 600, marginBottom: 6 }}>{errMsg}</div>
                            <button onClick={load} className="m-btn m-btn-primary" style={{ marginTop: 4 }}>Thử tải lại</button>
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
                        <div className="sub">Thuế GTGT {meta.vat_rate}% · Tổng thuế GTGT: <b>{fmtVND(rev.vat)}</b> · {fmtInt(rev.orders)} đơn trong kỳ.{Number(rev.other_income) > 0 && <> Trong đó thu khác (phiếu thu tay): <b>{fmtVND(rev.other_income)}</b>.</>}</div>
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
                                <div dangerouslySetInnerHTML={{ __html: donut(data.costs, data.cost_total, data.revenue?.net) }} />
                                <ul className="cost-legend">
                                    {data.costs.map((c, i) => (
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
                    </div>

                    {/* PNL THEO KÊNH (2026-11-15): lãi gộp từng kênh — dùng nguyên
                        trường income_channels backend đã trả, trình bày cùng mẫu
                        thẻ kênh ở trang Báo cáo chính để số không lệch nhau. */}
                    <div className="card">
                        <h3>PNL theo kênh — lãi gộp</h3>
                        <div className="sub">Lãi gộp theo kênh = Doanh thu − Giá vốn − Chiết khấu{hasMkt ? ' − Phí marketing' : ''}. Lương, mặt bằng và chi phí chung KHÔNG phân bổ xuống kênh — các khoản đó chỉ tính ở PNL toàn chuỗi.{hasMkt ? ' Kỳ này có tháng trọn đã nhập đối soát sàn: cột Phí marketing hiện và Lãi gộp là số sau phí marketing.' : ''}</div>
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Kênh</th><th className="num">Doanh thu</th><th className="num">Giá vốn</th><th className="num">Chiết khấu</th>{hasMkt && <th className="num">Phí marketing</th>}<th className="num">Lãi gộp</th><th className="num">Biên %</th><th className="num">Giảm giá quán chịu</th><th className="num">Gánh nặng kênh</th><th className="num">Biên đóng góp</th></tr>
                            {(data.income_channels || []).map((c) => {
                                const after = c.gross_profit_after_marketing !== undefined && c.gross_profit_after_marketing !== null;
                                const gp = after ? c.gross_profit_after_marketing : c.gross_profit;
                                const mg = after ? c.margin_after_pct : c.margin_pct;
                                return (
                                    <tr key={c.key}>
                                        <td className="prod">{c.name}</td>
                                        <td className="num">{fmtVND(c.value)}</td>
                                        <td className="num">{fmtVND(c.cogs)}</td>
                                        <td className="num">{fmtVND(c.commission)}</td>
                                        {hasMkt && <td className="num">{c.marketing_fee !== undefined && c.marketing_fee !== null ? fmtVND(c.marketing_fee) : '—'}</td>}
                                        <td className="num" style={{ color: Number(gp) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{fmtVND(gp)}</td>
                                        <td className="num">{trimN(mg)}%</td>
                                        <td className="num">{fmtVND(c.discount || 0)}</td>
                                        <td className="num">{c.burden_incomplete ? <span title="Chưa gồm phí marketing sàn — kỳ chưa đối soát trọn tháng">—</span> : trimN(c.burden_pct) + '%'}</td>
                                        <td className="num" style={{ fontWeight: 700, color: c.contribution === null || c.contribution === undefined ? undefined : (Number(c.contribution) >= 0 ? 'var(--green)' : 'var(--red)') }}>{c.burden_incomplete ? '—' : fmtVND(c.contribution)}</td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table></div>
                        <div className="sub" style={{ marginTop: 8 }}>BH-1: Gánh nặng kênh = (Chiết khấu + Phí marketing + Giảm giá quán chịu) ÷ Doanh thu kênh · Biên đóng góp = Doanh thu − Giá vốn − toàn bộ chi phí kênh trực tiếp. Kênh chưa có phí marketing (kỳ chưa đối soát) hiện "—" ở 2 cột cuối, không tính thiếu như đã đủ.</div>
                        {/* N-5 (360 đợt 2): mốc đổi cấu hình chiết khấu/phí marketing trong kỳ */}
                        {(data.income_channels || []).some((c) => (c.config_markers || []).length > 0) && (
                            <div className="sub" style={{ marginTop: 8 }}>
                                {(data.income_channels || []).flatMap((c) => (c.config_markers || []).map((m, i) => (
                                    <div key={c.key + '-' + i}>📅 Cấu hình đổi {m.changed_at}: <b>{m.label}</b> — {CONFIG_FIELD_LABELS[m.field] || m.field}: {fmtConfigValue(m.field, m.old_value)} → {fmtConfigValue(m.field, m.new_value)}{m.changed_by_name ? ' (' + m.changed_by_name + ')' : ''}.</div>
                                )))}
                            </div>
                        )}
                    </div>

                    {/* TC-1 (chỉ số 360 đợt 1): điểm hòa vốn tháng */}
                    {data.breakeven && (
                    <div className="card">
                        <h3>Điểm hòa vốn — tháng {data.breakeven.month}</h3>
                        {data.breakeven.status === 'unconfigured' ? (
                            <div className="explain" style={{ marginBottom: 0 }}>
                                <b>Chưa đủ cấu hình:</b> còn danh mục chi chưa phân loại Cố định/Biến đổi nên chưa tính được hòa vốn: {(data.breakeven.unconfigured || []).map((u) => u.name).join(' · ')}. Vào <b>Danh mục thu-chi</b> để phân loại — hệ thống không tự đoán.
                            </div>
                        ) : (
                            <>
                            <div className="kpis">
                                {kpi('Doanh thu hòa vốn tháng', data.breakeven.breakeven_revenue !== null ? fmtVND(data.breakeven.breakeven_revenue) : '—', '<span class="delta flat">—</span>')}
                                {kpi('Doanh thu hòa vốn / ngày', data.breakeven.daily_breakeven_revenue !== null ? fmtVND(data.breakeven.daily_breakeven_revenue) : '—', '<span class="delta flat">' + (data.breakeven.open_days || 0) + ' ngày mở cửa</span>')}
                                {kpi('Đơn hòa vốn / ngày', data.breakeven.daily_breakeven_orders !== null ? trimN(data.breakeven.daily_breakeven_orders) + ' đơn' : '—', '<span class="delta flat">AOV ' + fmtVND(data.breakeven.aov || 0) + '</span>')}
                                {kpi('Chi phí cố định tháng', fmtVND(data.breakeven.fixed_costs), '<span class="delta flat">biến đổi ' + trimN(data.breakeven.variable_ratio) + '% doanh thu</span>')}
                            </div>
                            <div className="sub">Cố định gồm: phiếu chi danh mục Cố định {fmtVND(data.breakeven.fixed_parts?.transactions || 0)} · lương cứng + BHXH {fmtVND(data.breakeven.fixed_parts?.salary_fixed || 0)}{data.breakeven.salary_is_estimate ? ' (ước tính — chưa chốt lương)' : ''} · chi phí phân bổ {fmtVND(data.breakeven.fixed_parts?.allocated || 0)}. Quy ước: lương cứng + BHXH vào Cố định, lương giờ theo ca vào Biến đổi (cùng giá vốn + chiết khấu kênh + phiếu chi Biến đổi).{data.breakeven.rd_fixed_reference !== null && data.breakeven.rd_fixed_reference !== undefined ? ' Đối chiếu: chi phí cố định khai ở R&D = ' + fmtVND(data.breakeven.rd_fixed_reference) + ' (chỉ tham chiếu — chuẩn tính là phân loại danh mục).' : ''} Chi phí chung toàn chuỗi chỉ tính ở góc toàn chuỗi.</div>
                            </>
                        )}
                    </div>
                    )}

                    {/* N-3 (360 đợt 2): mục tiêu doanh thu tháng — phục vụ TC-3 */}
                    {data.revenue_target && (
                    <div className="card">
                        <h3>Mục tiêu doanh thu — tháng {data.revenue_target.month}</h3>
                        <div className="sub">Mục tiêu theo từng chi nhánh (không nhập cho "Tất cả" — góc toàn chuỗi cộng các mục tiêu CN). {data.revenue_target.has_target ? (<>Mục tiêu tháng: <b>{fmtVND(data.revenue_target.target)}</b>.</>) : 'Chưa đặt mục tiêu tháng này — dự báo TC-3 sẽ không có số lệch.'}</div>
                        <RevenueTargetForm month={data.revenue_target.month} branchId={f.branch_id} branches={branches} canEdit={can('finance.targets.edit')} onSaved={load} />
                    </div>
                    )}

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

                    {/* Gói PNL kênh sàn (2026-10-31): CHI TIẾT PHÍ MARKETING KÊNH SÀN */}
                    {data.marketing && ((data.marketing.items || []).length > 0 || (data.marketing.full_months || []).length > 0 || (data.marketing.partial_months || []).length > 0) && (
                    <div className="card">
                        <h3>Chi tiết phí marketing kênh bán</h3>
                        <div className="sub">Phí quảng cáo + marketing sàn tính cho quán, nhập theo đối soát sàn từng tháng tại trang Kênh bán hàng (tab Đối soát sàn theo tháng) — số theo đối soát sàn, đã gồm mọi thuế phí phía sàn nếu có.</div>
                        {(data.marketing.items || []).length > 0 && (
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Kênh</th><th>Chi nhánh</th><th>Tháng</th><th className="num">Phí marketing</th></tr>
                            {(data.marketing.items || []).map((m, i) => (
                                <tr key={i}>
                                    <td className="prod">{m.channel}</td>
                                    <td>{m.branch}</td>
                                    <td>{String(m.month).slice(5)}/{String(m.month).slice(0, 4)}</td>
                                    <td className="num" style={{ color: 'var(--red)', fontWeight: 700 }}>{fmtVND(m.amount)}</td>
                                </tr>
                            ))}
                            <tr>
                                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Tổng (đã trừ vào lợi nhuận kỳ này)</td>
                                <td className="num" style={{ color: 'var(--red)', fontWeight: 700 }}>{fmtVND(data.marketing.total)}</td>
                            </tr>
                            </tbody>
                        </table></div>
                        )}
                        {(data.marketing.missing_months || []).length > 0 && (
                            <div className="sub" style={{ marginTop: 8 }}>⚠ Chưa nhập phí marketing cho tháng {(data.marketing.missing_months).map((m) => `${String(m).slice(5)}/${String(m).slice(0, 4)}`).join(', ')} — báo cáo chưa gồm khoản phí của tháng này (không phải bằng 0).</div>
                        )}
                        {(data.marketing.partial_months || []).length > 0 && (
                            <div className="sub" style={{ marginTop: 8 }}>Phí marketing sàn tính theo tháng trọn — kỳ đang xem cắt ngang tháng {(data.marketing.partial_months).map((m) => `${String(m).slice(5)}/${String(m).slice(0, 4)}`).join(', ')} nên chưa gồm phí marketing của tháng bị cắt.</div>
                        )}
                    </div>
                    )}

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
                        <div className="sub" style={{ marginTop: 8 }}>Lưu ý: <b>chi phí lương được tính trọn theo kỳ lương tháng</b> và không phân bổ vào từng cột — khi xem theo tuần/ngày, cột Chi của từng cột <b>chưa gồm lương kỳ lương</b>. Muốn xem đủ chi phí lương, chọn kỳ <b>Tháng</b>.</div>
                    </div>

                    <div className="foot">
                        <h4>📖 Chú thích thuật ngữ</h4>
                        <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 0 }}>
                            <tbody>
                            <tr><th>Thuật ngữ</th><th>Ý nghĩa</th></tr>
                            <tr><td><b>Net Revenue (Doanh thu thuần)</b></td><td>Gross − VAT. Mốc 100% để tính mọi tỷ trọng chi phí. Thu khác (phiếu thu tay) để riêng — vẫn tính vào Lợi nhuận nhưng KHÔNG nằm trong Doanh thu thuần. Giảm giá và phí sàn KHÔNG trừ vào chỉ số này (phí sàn nằm ở phía chi phí). Cùng cơ số với thẻ Doanh thu thuần ở tab Tổng quan của trang Báo cáo.</td></tr>
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
                            <li><b>Chi</b> = vốn nguyên liệu (BOM × giá vốn BQ lô) + lương &amp; chi khác (phiếu chi trong ca) + <b>chiết khấu kênh</b> (doanh thu kênh × % cấu hình). Riêng <b>lương kỳ lương chỉ hiện đủ khi kỳ xem là trọn tháng</b> — kỳ tuần/ngày không gồm khoản này (xem lưu ý dưới biểu đồ Thu – Chi theo kỳ).</li>
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
