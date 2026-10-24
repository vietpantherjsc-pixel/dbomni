import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import DateInput from '../../components/DateInput';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { API } from '../../utils/api';
import {
    REPORT_CSS, fmtInt, fmtVND, trimN, fmtD, todayStr, deltaBadge,
    PERIOD_NAMES,
} from './reportShared';

// =====================================================================
// Gói 17 (2026-10-09): Báo cáo kho — route /admin/reports/inventory.
// Dữ liệu: GET /api/reports/inventory (branch_id, period, date).
// 3 block: Xuất–Nhập nguyên liệu / Hao hụt nguyên liệu / Hạn tồn kho.
// =====================================================================


const EXP_STATUS = {
    expired: { label: 'Đã hết hạn', cls: 'r' },
    expiring_7: { label: 'Sắp hết (≤7 ngày)', cls: 'r' }, // TESTER P4: đúng spec — đỏ
    expiring_30: { label: 'Sắp hết (≤30 ngày)', cls: 'o' }, // TESTER P4: đúng spec — cam
};

const wastePill = (pct, threshold, overThreshold) => {
    // Gói 55 p11ag: đỏ khi vượt ngưỡng hao hụt cho phép của từng NL (mặc định 5%)
    const th = threshold === null || threshold === undefined ? 5 : Number(threshold);
    const cls = pct === null || pct === undefined ? 'y' : (overThreshold ? 'r' : (pct < 2 ? 'g' : 'y'));
    const txt = pct === null || pct === undefined ? '—' : trimN(pct) + '%';
    return '<span class="pill ' + cls + '" title="Ngưỡng: ' + trimN(th) + '%">' + txt + '</span>';
};

export default function ReportsInventory() {
    const [branches, setBranches] = useState([]);
    // C3 (2026-10-21): CN của báo cáo = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều
    // với dropdown sidebar ('0' = Tất cả ở cả hai nơi).
    const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
    const [f, setF] = useState({ branch_id: ctxBranchId, period: 'week', date: todayStr() });
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
            const res = await axios.get(API + '/reports/inventory', {
                params: { branch_id: f.branch_id, period: f.period, date: f.date },
            });
            if (res.data?.success) setData(res.data.data);
        } catch (e) {
            console.error('Lỗi tải báo cáo kho:', e);
            const detail = e?.response?.data?.message || e?.message || '';
            setErrMsg('Không tải được số liệu báo cáo kho.' + (detail ? ' Chi tiết: ' + detail : ''));
        }
        setLoading(false);
    }, [f]);

    useEffect(() => { load(); }, [load]);

    const set = (k, v) => {
        if (k === 'branch_id') setCtxBranchId(v); // C3: đổi CN trong trang = đổi trạng thái chung
        setF((prev) => ({ ...prev, [k]: v }));
    };
    const meta = data?.meta;
    const mats = data?.materials || [];
    const expiry = data?.expiry || [];
    const rangeTxt = meta
        ? (meta.from.slice(0, 10) === meta.to.slice(0, 10)
            ? fmtD(meta.from)
            : fmtD(meta.from) + ' – ' + fmtD(meta.to))
        : '';

    return (
        <AdminLayout>
            <style>{REPORT_CSS}</style>
            <div className="rpt">
                <div style={{ padding: '20px 20px 0' }}>
                    <h1 className="text-xl font-semibold text-gray-800">Báo cáo kho</h1>
                    <p className="text-[13px] text-gray-500">Xuất – nhập, hao hụt và hạn tồn kho nguyên liệu</p>
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
                    </div>
                </div>
                {meta && (
                    <div className="period-line">
                        <b>{meta.branch_name}</b> · Kỳ {PERIOD_NAMES[meta.period]}: <b>{rangeTxt}</b>
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

                    {/* Spec P4-C3: GIÁ TRỊ TỒN KHO */}
                    {sv && (
                    <div className="card">
                        <h3>Giá trị tồn kho</h3>
                        <div className="explain"><b>Cách tính:</b> tồn hiện tại × giá vốn từng lô (nhập trước tính trước). Đối chiếu với số kiểm kê gần nhất.</div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 18px' }}>
                                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tổng giá trị tồn</div>
                                <div style={{ fontSize: 22, fontWeight: 800, color: '#24305E' }}>{fmtVND(sv.total)}</div>
                            </div>
                            {(sv.by_group || []).map((g) => (
                                <div key={g.key} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 18px' }}>
                                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{g.name}</div>
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtVND(g.value)}</div>
                                </div>
                            ))}
                        </div>
                        {(sv.by_branch || []).length > 0 && (
                        <div className="tbl-wrap"><table className="tbl"><tbody>
                            <tr><th>Chi nhánh</th><th className="num">Giá trị tồn</th></tr>
                            {(sv.by_branch || []).map((b) => (
                                <tr key={b.branch_id}><td className="prod">{b.branch_name}</td><td className="num"><b>{fmtVND(b.value)}</b></td></tr>
                            ))}
                        </tbody></table></div>
                        )}
                    </div>
                    )}

                    {/* 1. XUẤT – NHẬP */}
                    <div className="card">
                        <h3>Báo cáo nguyên liệu xuất – nhập</h3>
                        <div className="explain">
                            <b>Cách tính:</b> “Nhập” = tổng lượng nhập kho trong kỳ (các lô batches tạo trong kỳ).
                            “Xuất theo BOM” = lượng phải dùng theo định mức, suy từ số món đã bán.
                            <b>Chênh lệch = Nhập − Xuất BOM</b> (dương = nhập dư so với bán).
                        </div>
                        {mats.length === 0 ? (
                            <div className="sub">Chưa có định mức (BOM) hoặc chưa có đơn bán trong kỳ.</div>
                        ) : (
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Nguyên liệu</th><th>ĐVT</th><th className="num">Nhập trong kỳ</th><th className="num">Xuất theo BOM</th><th className="num">Chênh lệch</th></tr>
                            {mats.map((m) => (
                                <tr key={m.material_id}>
                                    <td className="prod">{m.material}</td>
                                    <td>{m.unit}</td>
                                    <td className="num">{fmtInt(m.imported_qty)}</td>
                                    <td className="num">{fmtInt(m.exported_bom_qty)}</td>
                                    <td className="num" style={{ color: m.diff > 0 ? 'var(--green)' : (m.diff < 0 ? 'var(--red)' : 'var(--muted)'), fontWeight: 700 }}>
                                        {(m.diff > 0 ? '+' : '') + fmtInt(m.diff)}
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table></div>
                        )}
                    </div>

                    {/* 2. HAO HỤT — Gói 55 p11ag: từ số kiểm kê thực tế (phát hiện bán chui) */}
                    <div className="card">
                        <h3>Báo cáo hao hụt nguyên liệu</h3>
                        <div className="explain">
                            <b>Công thức:</b> Hao hụt = (Tồn đầu kỳ + Nhập trong kỳ − Tồn thực tế kiểm kê) − Tiêu thụ theo BOM.
                            Dòng có <b>⚠ ước tính</b> là chưa có phiếu kiểm kê → dùng công thức cũ (Nhập − BOM), độ tin cậy thấp.
                            <b style={{ color: 'var(--red)' }}>% đỏ</b> = vượt ngưỡng hao hụt cho phép → nghi ngờ bán chui/thất thoát.
                        </div>
                        {data.has_stocktake === false && (
                            <div style={{ border: '1px solid #f5c2c7', background: '#fff5f5', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#b42318', fontWeight: 600 }}>
                                ⚠ Chưa có số kiểm kê trong kỳ — số liệu dưới đây chỉ là ước tính. Hãy kiểm kê kho để có số liệu chính xác.
                            </div>
                        )}
                        {mats.length === 0 ? (
                            <div className="sub">Chưa có số liệu.</div>
                        ) : (
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Nguyên liệu</th><th className="num">Tồn đầu kỳ</th><th className="num">Nhập trong kỳ</th><th className="num">Xuất theo BOM</th><th className="num">Tồn thực tế (kiểm kê)</th><th className="num">Hao hụt</th><th className="num">% hao hụt</th></tr>
                            {mats.map((m) => (
                                <tr key={m.material_id} style={m.over_threshold ? { background: '#fff5f5' } : undefined}>
                                    <td className="prod">{m.material} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({m.unit})</span>
                                        {m.is_estimate && <span className="pill y" style={{ marginLeft: 6 }} title="Chưa có phiếu kiểm kê — số liệu chỉ là ước tính">⚠ ước tính</span>}
                                    </td>
                                    <td className="num">{m.opening_qty === null || m.opening_qty === undefined ? '—' : fmtInt(m.opening_qty)}</td>
                                    <td className="num">{fmtInt(m.imported_qty)}</td>
                                    <td className="num">{fmtInt(m.exported_bom_qty)}</td>
                                    <td className="num">{m.actual_qty === null || m.actual_qty === undefined ? '—' : fmtInt(m.actual_qty)}</td>
                                    <td className="num" style={{ color: m.diff > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                                        {(m.diff > 0 ? '+' : '') + fmtInt(m.diff)}
                                    </td>
                                    <td className="num"><span dangerouslySetInnerHTML={{ __html: wastePill(m.waste_pct, m.threshold_pct, m.over_threshold) }} /></td>
                                </tr>
                            ))}
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

                    {/* 3. HẠN TỒN KHO */}
                    <div className="card">
                        <h3>Hạn tồn kho nguyên liệu</h3>
                        <div className="sub">Các lô còn tồn có hạn sử dụng trong 30 ngày tới hoặc đã hết hạn — ưu tiên xử lý trước.</div>
                        {expiry.length === 0 ? (
                            <div className="sub">Không có lô nào sắp hết hạn trong 30 ngày tới.</div>
                        ) : (
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Mã lô</th><th>Nguyên liệu</th><th className="num">Tồn</th><th>Hạn sử dụng</th><th className="num">Còn lại</th><th>Trạng thái</th></tr>
                            {expiry.map((b) => {
                                const st = EXP_STATUS[b.status] || EXP_STATUS.expiring_30;
                                const left = b.days_left < 0 ? 'Quá ' + fmtInt(-b.days_left) + ' ngày' : b.days_left + ' ngày';
                                return (
                                <tr key={b.batch_id}>
                                    <td><b>{b.batch_code}</b></td>
                                    <td className="prod">{b.material}</td>
                                    <td className="num">{fmtInt(b.quantity)} {b.unit}</td>
                                    <td>{fmtD(b.expired_at)}</td>
                                    <td className="num" style={{ color: b.days_left < 0 ? 'var(--red)' : 'inherit', fontWeight: b.days_left < 0 ? 700 : 400 }}>{left}</td>
                                    <td><span className={'pill ' + st.cls}>{st.label}</span></td>
                                </tr>
                                );
                            })}
                            </tbody>
                        </table></div>
                        )}
                    </div>

                    <div className="foot">
                        <h4>Ghi chú về số liệu</h4>
                        <ul>
                            <li>Hao hụt = (Tồn đầu kỳ + Nhập trong kỳ − Tồn thực tế kiểm kê) − Tiêu thụ BOM. Dòng “⚠ ước tính” là chưa có phiếu kiểm kê.</li>
                            <li>Hạn tồn kho chỉ liệt kê lô còn tồn (số lượng &gt; 0) có hạn SD trong 30 ngày tới hoặc đã quá hạn.</li>
                        </ul>
                    </div>

                    </>)}
                </main>
            </div>
        </AdminLayout>
    );
}
