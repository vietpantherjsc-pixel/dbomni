import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import {
    REPORT_CSS, fmtInt, fmtVND, trimN, fmtD, todayStr, deltaBadge,
    PERIOD_NAMES,
} from './reportShared';

// =====================================================================
// Gói 17 (2026-10-09): Báo cáo kho — route /admin/reports/inventory.
// Dữ liệu: GET /api/reports/inventory (branch_id, period, date).
// 3 block: Xuất–Nhập nguyên liệu / Hao hụt nguyên liệu / Hạn tồn kho.
// =====================================================================

const API = 'http://localhost/api';

const EXP_STATUS = {
    expired: { label: 'Đã hết hạn', cls: 'r' },
    expiring_7: { label: 'Sắp hết (≤7 ngày)', cls: 'y' },
    expiring_30: { label: 'Sắp hết (≤30 ngày)', cls: 'g' },
};

const wastePill = (pct) => {
    const cls = pct === null || pct === undefined ? 'y' : (pct < 2 ? 'g' : (pct <= 5 ? 'y' : 'r'));
    const txt = pct === null || pct === undefined ? '—' : trimN(pct) + '%';
    return '<span class="pill ' + cls + '">' + txt + '</span>';
};

export default function ReportsInventory() {
    const [branches, setBranches] = useState([]);
    const [f, setF] = useState({ branch_id: '0', period: 'week', date: todayStr() });
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

    const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
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
                            <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
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

                    {/* 2. HAO HỤT */}
                    <div className="card">
                        <h3>Báo cáo hao hụt nguyên liệu</h3>
                        <div className="explain">
                            Tỷ lệ hao hụt = Chênh lệch / Xuất theo BOM. “Thực tế tiêu hao” hiện ước tính bằng
                            lượng <b>nhập kho trong kỳ</b> (giả định tồn đầu ≈ tồn cuối).
                        </div>
                        {mats.length === 0 ? (
                            <div className="sub">Chưa có số liệu.</div>
                        ) : (
                        <div className="tbl-wrap"><table className="tbl">
                            <tbody>
                            <tr><th>Nguyên liệu</th><th className="num">Xuất theo BOM</th><th className="num">Thực tế (nhập)</th><th className="num">Chênh lệch</th><th className="num">% hao hụt</th></tr>
                            {mats.map((m) => (
                                <tr key={m.material_id}>
                                    <td className="prod">{m.material} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({m.unit})</span></td>
                                    <td className="num">{fmtInt(m.exported_bom_qty)}</td>
                                    <td className="num">{fmtInt(m.imported_qty)}</td>
                                    <td className="num" style={{ color: m.diff > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                                        {(m.diff > 0 ? '+' : '') + fmtInt(m.diff)}
                                    </td>
                                    <td className="num"><span dangerouslySetInnerHTML={{ __html: wastePill(m.waste_pct) }} /></td>
                                </tr>
                            ))}
                            </tbody>
                        </table></div>
                        )}
                        <div className="legend" style={{ marginTop: 10 }}>
                            <span><span className="pill g">&lt; 2%</span> Tốt</span>
                            <span><span className="pill y">2–5%</span> Cần theo dõi</span>
                            <span><span className="pill r">&gt; 5%</span> Cảnh báo</span>
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
                            <li>“Thực tế tiêu hao” hiện dùng lượng nhập kho trong kỳ làm ước tính (giả định tồn đầu ≈ tồn cuối) — sẽ chính xác khi có lịch sử kiểm kho.</li>
                            <li>Hạn tồn kho chỉ liệt kê lô còn tồn (số lượng &gt; 0) có hạn SD trong 30 ngày tới hoặc đã quá hạn.</li>
                        </ul>
                    </div>

                    </>)}
                </main>
            </div>
        </AdminLayout>
    );
}
