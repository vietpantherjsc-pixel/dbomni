import React, { useState, useEffect, useCallback } from 'react';
import { rdGet } from './rdApi';
import { useBranch } from '../../contexts/BranchContext'; // C3: trạng thái CN dùng chung
import { fmtDate } from '../../utils/format';

// SPEC R&D — Tab 3: Điểm hòa vốn (công thức spec 5.2 — số BÁN THẬT, biến phí gồm
// giá vốn nguyên liệu + chiết khấu kênh; F lấy từ Tab Chi phí cố định cùng phạm vi).
const fmt = (n) => (n == null ? '—' : `${Math.round(Number(n)).toLocaleString('vi-VN')}đ`);

export default function RdBreakEven({ meta }) {
  // C3 (2026-10-21): phạm vi CN = TRẠNG THÁI CHUNG BranchContext, đồng bộ 2 chiều với
  // dropdown sidebar ('' tại tab này = '0' — Toàn hệ thống — ở context).
  const { branchId: ctxBranchId, setBranchId: setCtxBranchId } = useBranch();
  const branchId = ctxBranchId === '0' ? '' : ctxBranchId;
  const setBranchId = (v) => setCtxBranchId(v === '' || v === null || v === undefined ? '0' : String(v));
  const [months, setMonths] = useState(3);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await rdGet(`/rd/break-even`, {
        params: { branch_id: branchId || undefined, months },
      });
      setData(res.data?.data || null);
    } catch (e) { alert(e.response?.data?.message || 'Không tính được điểm hòa vốn.'); }
    finally { setLoading(false); }
  }, [branchId, months]);

  useEffect(() => { load(); }, [load]);

  const card = (label, value, sub) => (
    <div className="m-card p-4">
      <div className="text-xs font-semibold" style={{ color: 'var(--m-ink-soft)' }}>{label}</div>
      <div className="text-xl font-bold mt-1" style={{ color: 'var(--m-primary)' }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: 'var(--m-ink-faint)' }}>{sub}</div>}
    </div>
  );

  const pct = data?.current_month?.progress_pct;
  const barWidth = pct == null ? 0 : Math.min(100, Math.max(0, pct));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm font-semibold">Phạm vi:</span>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="m-input" style={{ width: 200 }}>
          <option value="">Toàn hệ thống</option>
          {meta.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <span className="text-sm font-semibold ml-2">Kỳ tính cơ cấu bán:</span>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="m-input" style={{ width: 130 }}>
          <option value={1}>1 tháng trọn</option>
          <option value={3}>3 tháng trọn</option>
          <option value={6}>6 tháng trọn</option>
        </select>
        {data && <span className="text-xs" style={{ color: 'var(--m-ink-faint)' }}>
          Kỳ: {fmtDate(data.period.from)} – {fmtDate(data.period.to)} · {data.orders_count.toLocaleString('vi-VN')} đơn đã trả tiền
        </span>}
      </div>

      {loading && <div className="p-8 text-center text-sm" style={{ color: 'var(--m-ink-faint)' }}>Đang tính...</div>}

      {data && !loading && (
        <>
          {data.low_data_warning && (
            <div className="m-card p-4 mb-4 text-sm" style={{ background: '#FFFBEB', color: '#92400E' }}>
              ⚠ Kỳ này chưa đủ dữ liệu bán ({data.orders_count} đơn — cần tối thiểu 30 đơn) nên tỷ lệ lãi gộp biên đang dùng
              <b> số thay thế</b>: tỷ suất lợi nhuận bình quân của các món đang bán (Menu Engineering). Số sẽ tự chuẩn lại khi đủ đơn.
            </div>
          )}
          {data.cm_pct == null && (
            <div className="m-card p-4 mb-4 text-sm" style={{ color: 'var(--m-danger)' }}>
              Chưa tính được điểm hòa vốn: phạm vi này chưa có dữ liệu bán để suy ra tỷ lệ lãi gộp biên.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            {card('Tổng chi phí cố định/tháng', fmt(data.fixed_total), 'Từ Tab Chi phí cố định, đúng phạm vi đang xem')}
            {card('Tỷ lệ lãi gộp biên (CM%)', data.cm_pct != null ? `${data.cm_pct}%` : '—',
              data.cm_source === 'menu_engineering_avg' ? 'Số thay thế — Menu Engineering' : `(DT − biến phí) ÷ DT của kỳ tính`)}
            {card('Doanh thu hòa vốn/tháng', fmt(data.breakeven_revenue), 'Doanh thu tiền hàng (sau giảm giá) cần đạt mỗi tháng')}
            {card('Số đơn cần/ngày', data.orders_per_day_needed != null ? `${data.orders_per_day_needed} đơn` : '—',
              `Tương đương ${fmt(data.revenue_per_day_needed)}/ngày`)}
          </div>

          <div className="m-card p-4 mb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-bold">So với thực tế tháng này</div>
              {data.current_month.verdict && (
                <div className="text-sm font-bold" style={{ color: pct >= 100 ? '#059669' : '#dc2626' }}>
                  {data.current_month.verdict}
                </div>
              )}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--m-ink-soft)' }}>
              Doanh thu đến hôm nay: <b>{fmt(data.current_month.actual_revenue)}</b> · Dự phóng hết tháng theo nhịp hiện tại:{' '}
              <b>{fmt(data.current_month.projected_revenue)}</b>
              {data.breakeven_revenue != null && <> · Điểm hòa vốn: <b>{fmt(data.breakeven_revenue)}</b></>}
            </div>
            <div className="mt-3" style={{ height: 12, borderRadius: 999, background: 'var(--m-line)', overflow: 'hidden' }}>
              <div style={{
                width: `${barWidth}%`, height: '100%', borderRadius: 999,
                background: pct >= 100 ? '#059669' : '#F5A623', transition: 'width .3s',
              }} />
            </div>
            <div className="text-xs mt-1 text-right" style={{ color: 'var(--m-ink-faint)' }}>
              {pct != null ? `Dự phóng đạt ${pct}% điểm hòa vốn` : 'Chưa tính được tiến độ'}
            </div>
          </div>

          <div className="m-card overflow-x-auto">
            <table className="m-table min-w-[640px]">
              <thead><tr><th>Thành phần kỳ tính</th><th className="text-right">Giá trị</th></tr></thead>
              <tbody>
                <tr><td>Doanh thu thuần kỳ (tiền hàng sau giảm giá, không gồm phí ship)</td><td className="text-right m-num font-semibold">{fmt(data.revenue)}</td></tr>
                <tr><td>Giá vốn nguyên liệu (ưu tiên giá vốn đã chốt lúc trừ kho)</td><td className="text-right m-num">{fmt(data.bom_cost)}</td></tr>
                <tr><td>Chiết khấu kênh (phí sàn đối tác)</td><td className="text-right m-num">{fmt(data.commission)}</td></tr>
                <tr><td>Tổng biến phí</td><td className="text-right m-num font-semibold">{fmt(data.variable_cost)}</td></tr>
                <tr><td>Số đơn trong kỳ</td><td className="text-right m-num">{data.orders_count.toLocaleString('vi-VN')}</td></tr>
                <tr><td>Giá trị đơn trung bình (AOV)</td><td className="text-right m-num">{fmt(data.aov)}</td></tr>
                <tr><td>Chi phí cố định/tháng (F)</td><td className="text-right m-num font-semibold">{fmt(data.fixed_total)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--m-ink-faint)' }}>
            Công thức: CM% = (Doanh thu − Biến phí) ÷ Doanh thu · Doanh thu hòa vốn = F ÷ CM% · Đơn/ngày = DT hòa vốn ÷ AOV ÷ số ngày của tháng hiện tại.
          </p>
        </>
      )}
    </div>
  );
}
