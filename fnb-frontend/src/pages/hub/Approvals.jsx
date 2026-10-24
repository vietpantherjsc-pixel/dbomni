import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API } from '../../utils/api';

// =====================================================================
// Gói "Chờ duyệt trên Hub" (2026-10-21, spec ĐÃ CHỐT): cụm Chờ duyệt cho
// quản lý trực ca — danh sách chờ theo loại, chi tiết phiếu, hộp xác nhận
// duyệt/từ chối kèm nhập lại PIN + nhắc tên chi nhánh của phiếu.
// =====================================================================

const CSS = `
.ap-sec{background:#fff;border:1px solid #e3e8f2;border-radius:16px;padding:14px;margin:12px 12px 0;}
.ap-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#24305E;margin-bottom:10px;}
.ap-total{background:#F5A623;color:#3a2a00;font-size:12px;font-weight:800;border-radius:12px;padding:2px 10px;}
.ap-row{display:flex;align-items:center;gap:11px;width:100%;background:#fff;border:1px solid #eef1f6;border-radius:13px;padding:12px;margin-bottom:8px;min-height:60px;text-align:left;cursor:pointer;}
.ap-row:active{transform:scale(.99);}
.ap-ic{width:40px;height:40px;border-radius:11px;background:#eef1f8;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;}
.ap-inf{flex:1;min-width:0;}
.ap-inf b{font-size:13.5px;color:#24305E;display:block;}
.ap-inf span{font-size:11.5px;color:#8a93a6;display:block;}
.ap-n{background:#fdecec;color:#dc2626;font-weight:800;font-size:13px;border-radius:11px;min-width:30px;height:30px;display:flex;align-items:center;justify-content:center;padding:0 7px;}
.ap-chev{color:#8a93a6;font-weight:800;}
.ap-done{display:flex;justify-content:space-between;align-items:center;background:#f7f9fd;border:1px dashed #e3e8f2;border-radius:12px;padding:10px 13px;font-size:12.5px;color:#24305E;font-weight:700;width:100%;cursor:pointer;margin-top:2px;}
.ap-notice{background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;border-radius:12px;padding:12px;font-size:13px;font-weight:700;text-align:center;margin:0 12px 10px;}
.ap-empty{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:12px;padding:12px;font-size:13px;font-weight:700;text-align:center;}
.ap-card{background:#fff;border:1px solid #eef1f6;border-radius:13px;padding:12px 13px;margin:0 12px 9px;min-height:64px;width:calc(100% - 24px);text-align:left;cursor:pointer;}
.ap-card .r1{display:flex;justify-content:space-between;align-items:center;gap:8px;}
.ap-code{font-weight:800;color:#24305E;font-size:13.5px;}
.ap-wait{font-size:11px;background:#fff3d9;color:#8a5a00;border-radius:7px;padding:2px 7px;font-weight:800;white-space:nowrap;}
.ap-meta{font-size:12px;color:#1f2937;margin-top:4px;}
.ap-meta span{color:#8a93a6;}
.ap-creator{font-size:11.5px;color:#8a93a6;margin-top:2px;}
.ap-head{display:flex;align-items:center;gap:10px;padding:12px;}
.ap-back{border:1px solid #e3e8f2;background:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;color:#24305E;min-height:40px;}
.ap-hd-t{font-size:15px;font-weight:800;color:#24305E;flex:1;}
.ap-branch{font-size:11.5px;color:#8a93a6;}
.ap-kv{background:#fff;border:1px solid #eef1f6;border-radius:13px;padding:4px 13px;margin:0 12px 10px;}
.ap-kv .r{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #f1f4fa;font-size:12.5px;}
.ap-kv .r:last-child{border:0;}
.ap-k{color:#8a93a6;}
.ap-v{font-weight:700;color:#24305E;text-align:right;}
.ap-tbl{width:100%;border-collapse:collapse;background:#fff;font-size:12.5px;}
.ap-tbl th,.ap-tbl td{padding:8px 6px;border-bottom:1px solid #f1f4fa;text-align:left;}
.ap-tbl th{color:#8a93a6;font-size:11px;font-weight:700;}
.ap-tbl td.r,.ap-tbl th.r{text-align:right;}
.ap-tbl tr.tot td{font-weight:800;color:#24305E;}
.ap-sticky{display:flex;gap:9px;margin:12px;padding:0 0 8px;position:sticky;bottom:0;background:linear-gradient(transparent,#f1f4fa 30%);}
.ap-btn{flex:1;border-radius:13px;padding:15px 8px;font-size:14.5px;font-weight:800;border:0;min-height:52px;cursor:pointer;}
.ap-btn.go{background:#F5A623;color:#3a2a00;}
.ap-btn.rej{background:#fff;color:#dc2626;border:1.5px solid #f3c2c2;}
.ap-btn:disabled{opacity:.45;}
.ap-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:flex-end;justify-content:center;z-index:60;}
.ap-box{background:#fff;border-radius:18px 18px 0 0;padding:18px 16px 22px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;}
.ap-box h4{margin:0 0 6px;color:#24305E;font-size:15px;}
.ap-box p{margin:0 0 10px;font-size:13px;color:#1f2937;}
.ap-pinbranch{background:#fff7e6;border:1.5px solid #F5A623;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:800;color:#7c4a03;margin-bottom:10px;}
/* TESTER fix 🟡c: dòng chi nhánh nổi bật đầu màn chi tiết */
.ap-branchline{background:#fff7e6;border:1.5px solid #F5A623;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:800;color:#7c4a03;margin:0 12px 10px;}
.ap-pin{width:100%;border:1.5px solid #e3e8f2;border-radius:12px;padding:12px;font-size:22px;font-weight:800;letter-spacing:10px;text-align:center;color:#24305E;margin:6px 0;}
.ap-note{width:100%;border:1px solid #e3e8f2;border-radius:10px;padding:10px;font-size:13px;margin-top:6px;min-height:64px;}
.ap-err{background:#fdecec;color:#b91c1c;border-radius:10px;padding:9px 12px;font-size:12.5px;font-weight:700;margin:8px 0;}
.ap-warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:10px 12px;font-size:12.5px;margin:0 12px 10px;}
.ap-more{display:block;width:calc(100% - 24px);margin:2px 12px 16px;border:1px solid #e3e8f2;background:#fff;border-radius:12px;padding:12px;font-size:13px;font-weight:700;color:#24305E;}
.ap-note-lb{font-size:12.5px;font-weight:700;color:#24305E;margin-top:8px;display:block;}
.ap-req{color:#dc2626;}
`;

function auth(token, hubT) {
  const h = { headers: { Authorization: 'Bearer ' + token } };
  if (hubT) h.params = { t: hubT };
  return h;
}
function cfg(token, hubT, params) {
  const h = auth(token, hubT);
  if (params) h.params = { ...(h.params || {}), ...params };
  return h;
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}
const fmtMoney = (n) => (Number(n) || 0).toLocaleString('vi-VN');
const fmtDateTime = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function waitLabel(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'vừa xong';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `lâu nhất ${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return `lâu nhất ${h} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
  return `lâu nhất ${Math.floor(h / 24)} ngày`;
}

const TYPES_META = {
  inbound: { label: 'Phiếu nhập kho', icon: '📥', rejectLabel: 'Hủy phiếu' },
  outbound: { label: 'Phiếu xuất kho', icon: '📤', rejectLabel: 'Hủy phiếu' },
  transfer: { label: 'Phiếu chuyển kho', icon: '🔄', rejectLabel: 'Hủy phiếu' },
  stocktake_adjustment: { label: 'Điều chỉnh kiểm kê', icon: '📋', rejectLabel: 'Từ chối' },
  transaction: { label: 'Phiếu thu/chi', icon: '🧾', rejectLabel: 'Từ chối' },
  shift_registration: { label: 'Đăng ký ca', icon: '📅', rejectLabel: 'Từ chối' },
  leave_request: { label: 'Xin nghỉ phép', icon: '🏖️', rejectLabel: 'Từ chối' },
};
// Lý do ở hộp xác nhận: bắt buộc / tùy chọn / không có — theo mục 4 spec
const REASON_MODE = { transaction: 'required', stocktake_adjustment: 'optional', shift_registration: 'optional' };

// Cache approval_token 5 phút phía client (miễn nhập lại PIN — mục 5b spec)
let approvalTokenCache = { token: '', ts: 0, empId: 0 };
async function ensureApprovalToken(authCfg, empId, pin) {
  const now = Date.now();
  if (approvalTokenCache.token && approvalTokenCache.empId === empId && now - approvalTokenCache.ts < 4.5 * 60 * 1000) {
    return approvalTokenCache.token;
  }
  if (!pin || pin.length !== 6) { const e = new Error('NEED_PIN'); throw e; }
  try {
    const r = await axios.post(API + '/employee/pin-verify', { pin_code: pin, purpose: 'approval' }, authCfg);
    const t = r.data && r.data.data && r.data.data.approval_token;
    if (!t) throw new Error('Không lấy được mã xác nhận.');
    approvalTokenCache = { token: t, ts: now, empId };
    return t;
  } catch (e) {
    approvalTokenCache = { token: '', ts: 0, empId: 0 };
    throw e;
  }
}

// ---------------- Cụm "Chờ duyệt" trên trang chủ Hub (mục 6.1 spec) ----------------
export function ApprovalCluster({ token, hubT, branchId, onOpen }) {
  const [counts, setCounts] = useState(null);
  const [processedCount, setProcessedCount] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await axios.get(API + '/employee/approvals/counts', cfg(token, hubT, { branch_id: branchId }));
        if (!alive) return;
        setCounts(r.data && r.data.data ? r.data.data : { types: {}, total: 0 });
        setHidden(false);
      } catch (e) {
        if (alive && e && e.response && e.response.status === 403) setHidden(true);
      }
      try {
        const r2 = await axios.get(API + '/employee/approvals/processed-today', cfg(token, hubT, { branch_id: branchId }));
        if (alive && r2.data && r2.data.success) setProcessedCount((r2.data.data || []).length);
      } catch (e) { /* bỏ qua */ }
    })();
    return () => { alive = false; };
  }, [branchId, token]);

  if (hidden || !counts) return null;
  const types = counts.types || {};
  const keys = Object.keys(types);
  if (keys.length === 0) return null; // không có khóa quyền duyệt nào → không thấy cụm

  return (
    <div className="ap-sec">
      <style>{CSS}</style>
      <div className="ap-title">⏳ Chờ duyệt <span className="ap-total">{counts.total || 0}</span></div>
      {keys.filter((k) => (types[k].count || 0) > 0).map((k) => (
        <button key={k} className="ap-row" onClick={() => onOpen(k)}>
          <span className="ap-ic">{types[k].icon}</span>
          <span className="ap-inf"><b>{types[k].label}</b><span>{waitLabel(types[k].oldest_at)}</span></span>
          <span className="ap-n">{types[k].count}</span>
          <span className="ap-chev">›</span>
        </button>
      ))}
      {(counts.total || 0) === 0 && <div className="ap-empty">Không có phiếu chờ duyệt 🎉</div>}
      <button className="ap-done" onClick={() => onOpen('__processed')}>
        <span>Đã xử lý hôm nay</span><span>({processedCount}) ›</span>
      </button>
    </div>
  );
}

// ---------------- Luồng duyệt: danh sách / chi tiết / đã xử lý ----------------
export function ApprovalsFlow({ token, hubT, emp, branchId, branchName, initialType, onBack }) {
  const [route, setRoute] = useState(
    initialType === '__processed' ? { v: 'processed' } : { v: 'list', type: initialType || 'inbound' }
  );
  const A = cfg(token, hubT, { branch_id: branchId });
  const [notice, setNotice] = useState('');
  // Sau duyệt/từ chối thành công: thông báo kết quả + quay về danh sách, phiếu biến mất (mục 6.3 spec)
  const backToList = (type, msg) => {
    setRoute({ v: 'list', type });
    if (msg) { setNotice(msg); setTimeout(() => setNotice(''), 4000); }
  };

  return (
    <div className="sh-wrap">
      <style>{CSS}</style>
      {notice && <div className="ap-notice">{notice}</div>}

      {route.v === 'list' && (
        <ListView key={'l' + route.type + branchId} A={A} type={route.type} branchName={branchName}
          onBack={onBack} onOpen={(id) => setRoute({ v: 'detail', type: route.type, id })} />
      )}
      {route.v === 'detail' && (
        <DetailView key={'d' + route.type + route.id} A={A} token={token} hubT={hubT} emp={emp}
          type={route.type} id={route.id} onBack={() => setRoute({ v: 'list', type: route.type })}
          onActed={(msg) => backToList(route.type, msg)} />
      )}
      {route.v === 'processed' && (
        <ProcessedView key={'p' + branchId} A={A} onBack={onBack}
          onOpen={(type, id) => setRoute({ v: 'detail', type, id })} />
      )}
    </div>
  );
}

function ListView({ A, type, branchName, onBack, onOpen }) {
  const meta = TYPES_META[type] || {};
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = async (p) => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/employee/approvals/${type}`, { ...A, params: { ...(A.params || {}), page: p } });
      const d = (r.data && r.data.data) || [];
      setItems((prev) => (p === 1 ? d : [...prev, ...d]));
      setLastPage((r.data && r.data.pagination && r.data.pagination.last_page) || 1);
      setPage(p);
    } catch (e) { /* giữ danh sách cũ */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div>
      <div className="ap-head">
        <button className="ap-back" onClick={onBack}>‹ Quay lại</button>
        <div className="ap-hd-t">{meta.icon} {meta.label}</div>
      </div>
      <div className="ap-branch" style={{ padding: '0 12px 8px' }}>Chi nhánh: <b>{branchName}</b></div>
      {items.map((it) => (
        <button key={it.id} className="ap-card" onClick={() => onOpen(it.id)}>
          <div className="r1"><span className="ap-code">{it.title}</span><span className="ap-wait">{waitLabel(it.created_at)}</span></div>
          <div className="ap-meta">{it.meta}</div>
          {it.creator && <div className="ap-creator">Người tạo: {it.creator}</div>}
        </button>
      ))}
      {!loading && items.length === 0 && <div className="ap-empty" style={{ margin: '0 12px' }}>Không có phiếu chờ 🎉</div>}
      {loading && items.length === 0 && <div className="ap-empty" style={{ margin: '0 12px' }}>Đang tải...</div>}
      {page < lastPage && (
        <button className="ap-more" onClick={() => load(page + 1)} disabled={loading}>
          {loading ? 'Đang tải...' : 'Tải thêm'}
        </button>
      )}
    </div>
  );
}

function ProcessedView({ A, onBack, onOpen }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(API + '/employee/approvals/processed-today', A);
        setItems((r.data && r.data.data) || []);
      } catch (e) { /* bỏ qua */ }
      finally { setLoading(false); }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  return (
    <div>
      <div className="ap-head">
        <button className="ap-back" onClick={onBack}>‹ Quay lại</button>
        <div className="ap-hd-t">Đã xử lý hôm nay</div>
      </div>
      {items.map((it) => (
        <button key={it.type + it.id} className="ap-card" onClick={() => onOpen(it.type, it.id)}>
          <div className="r1">
            <span className="ap-code">{(TYPES_META[it.type] || {}).icon} {it.title}</span>
            <span className="ap-wait" style={
              it.result === 'rejected' ? { background: '#fdecec', color: '#b91c1c' }
              : it.result === 'cancelled' ? { background: '#fef3c7', color: '#92400e' }
              : { background: '#f0fdf4', color: '#15803d' }}>
              {it.result === 'rejected' ? 'Đã từ chối' : it.result === 'cancelled' ? 'Đã hủy' : 'Đã duyệt'}
            </span>
          </div>
          <div className="ap-meta">{(TYPES_META[it.type] || {}).label} · {it.meta}</div>
        </button>
      ))}
      {!loading && items.length === 0 && <div className="ap-empty" style={{ margin: '0 12px' }}>Hôm nay bạn chưa xử lý phiếu nào.</div>}
    </div>
  );
}

// ---------------- Chi tiết phiếu ----------------
function DetailView({ A, token, hubT, emp, type, id, onBack, onActed }) {
  const meta = TYPES_META[type] || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null); // 'approve' | 'reject'

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await axios.get(`${API}/employee/approvals/${type}/${id}`, A);
      setData(r.data && r.data.data ? r.data.data : null);
    } catch (e) { setErr(errMsg(e, 'Không tải được chi tiết phiếu.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const doneAction = (msg) => { setConfirm(null); if (onActed) onActed(msg); else load(); };

  if (loading) return (<div><div className="ap-head"><button className="ap-back" onClick={onBack}>‹ Quay lại</button></div><div className="ap-empty" style={{ margin: '0 12px' }}>Đang tải...</div></div>);
  if (err || !data) return (<div><div className="ap-head"><button className="ap-back" onClick={onBack}>‹ Quay lại</button></div><div className="ap-err" style={{ margin: '0 12px' }}>{err}</div></div>);

  const rec = data.record || {};
  const branchNames = data.branch_names || [];
  const canAct = !!data.can_act;

  return (
    <div>
      <div className="ap-head">
        <button className="ap-back" onClick={onBack}>‹ Quay lại</button>
        <div className="ap-hd-t">{meta.icon} {meta.label}</div>
      </div>
      {/* TESTER fix 🟡c: dòng chi nhánh nổi bật ngay đầu màn chi tiết (quyết định chốt 5b của Đại Vương) */}
      <div className="ap-branchline">
        {type === 'transfer'
          ? `📍 Chi nhánh của phiếu: ${branchNames[0] || ''} → ${branchNames[1] || ''}`
          : `📍 Chi nhánh của phiếu: ${branchNames[0] || ''}`}
      </div>
      <DetailBody type={type} rec={rec} />
      {canAct && (
        <div className="ap-sticky">
          <button className="ap-btn go" onClick={() => setConfirm('approve')}>Duyệt</button>
          <button className="ap-btn rej" onClick={() => setConfirm('reject')}>{data.reject_label || meta.rejectLabel}</button>
        </div>
      )}
      {!canAct && (
        <div className="ap-warn">Phiếu này đã được xử lý — chỉ xem lại, không thể duyệt/từ chối lại.</div>
      )}
      {confirm && (
        <ConfirmDialog A={A} token={token} hubT={hubT} emp={emp} type={type} id={id}
          action={confirm} rec={rec} branchNames={branchNames}
          onClose={() => setConfirm(null)} onDone={doneAction} />
      )}
    </div>
  );
}

function kv(rows) {
  return (
    <div className="ap-kv">
      {rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v], i) => (
        <div className="r" key={i}><span className="ap-k">{k}</span><span className="ap-v">{v}</span></div>
      ))}
    </div>
  );
}

function DetailBody({ type, rec }) {
  const creator = (rec.createdByEmployee && rec.createdByEmployee.full_name)
    || (rec.createdByUser && rec.createdByUser.name)
    || (rec.employee && rec.employee.full_name) || '';
  switch (type) {
    case 'inbound': {
      const items = rec.items || [];
      return (
        <div>
          {kv([
            ['Mã phiếu', rec.code], ['Chi nhánh', rec.branch && rec.branch.name],
            ['Nhà cung cấp', rec.partner && rec.partner.name], ['Người tạo', creator],
            ['Ngày phiếu', rec.receipt_date], ['Ghi chú', rec.note],
          ])}
          <div className="ap-kv"><table className="ap-tbl">
            <thead><tr><th>Nguyên liệu</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}><td>{(l.material && l.material.name) || ''}<br /><span style={{ color: '#8a93a6', fontSize: 11 }}>{l.purchase_unit || ''}</span></td>
                  <td className="r">{l.purchase_quantity}</td><td className="r">{fmtMoney(l.unit_cost)}</td><td className="r">{fmtMoney(l.line_total)}</td></tr>
              ))}
              <tr className="tot"><td colSpan={3}>Tổng cộng</td><td className="r">{fmtMoney(rec.grand_total)}đ</td></tr>
            </tbody>
          </table></div>
          <div className="ap-warn">Duyệt phiếu này sẽ <b>tạo lô kho</b> và <b>sinh phiếu chi</b> tương ứng.</div>
        </div>
      );
    }
    case 'outbound': {
      const items = rec.items || [];
      return (
        <div>
          {kv([
            ['Mã phiếu', rec.code], ['Chi nhánh', rec.branch && rec.branch.name],
            ['Lý do', (rec.reason_label || rec.reason)], ['Người tạo', creator || (rec.employee && rec.employee.full_name)],
            ['Ghi chú', rec.note],
          ])}
          <div className="ap-kv"><table className="ap-tbl">
            <thead><tr><th>Nguyên liệu</th><th className="r">SL</th><th>ĐVT</th></tr></thead>
            <tbody>{items.map((l) => (
              <tr key={l.id}><td>{(l.material && l.material.name) || ''}</td><td className="r">{l.quantity}</td><td>{l.unit || ''}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="ap-warn">Chốt phiếu này sẽ <b>trừ kho theo FIFO</b> tại chi nhánh.</div>
        </div>
      );
    }
    case 'transfer': {
      const items = rec.items || [];
      return (
        <div>
          {kv([
            ['Mã phiếu', rec.code],
            ['Từ chi nhánh', rec.fromBranch && rec.fromBranch.name],
            ['Đến chi nhánh', rec.toBranch && rec.toBranch.name],
            ['Người tạo', creator], ['Ghi chú', rec.note],
          ])}
          <div className="ap-kv"><table className="ap-tbl">
            <thead><tr><th>Nguyên liệu</th><th className="r">SL</th><th>ĐVT</th></tr></thead>
            <tbody>{items.map((l) => (
              <tr key={l.id}><td>{(l.material && l.material.name) || ''}</td><td className="r">{l.quantity}</td><td>{l.unit || ''}</td></tr>
            ))}</tbody>
          </table></div>
          <div className="ap-warn">Xác nhận sẽ <b>trừ kho chi nhánh nguồn</b> và <b>cộng kho chi nhánh đích</b>.</div>
        </div>
      );
    }
    case 'stocktake_adjustment': {
      const diff = Number(rec.diff_qty) || 0;
      const sys = Number(rec.system_qty) || 0;
      const big = sys !== 0 && Math.abs(diff / sys) >= 0.2; // ngưỡng cảnh báo chênh lệch lớn: 20%
      return (
        <div>
          {kv([
            ['Nguyên liệu', rec.material && rec.material.name],
            ['Chi nhánh', rec.branch && rec.branch.name],
            ['Tồn sổ sách', `${sys} ${(rec.material && rec.material.unit) || ''}`],
            ['Thực kiểm', `${Number(rec.counted_qty) || 0} ${(rec.material && rec.material.unit) || ''}`],
            ['Người đề xuất', (rec.requestedBy && rec.requestedBy.full_name) || ''],
            ['Thời gian', fmtDateTime(rec.created_at)],
          ])}
          <div className="ap-kv"><div className="r"><span className="ap-k">Chênh lệch</span>
            <span className="ap-v" style={{ color: diff > 0 ? '#15803d' : diff < 0 ? '#b91c1c' : '#24305E' }}>
              {diff > 0 ? '+' : ''}{diff} {(rec.material && rec.material.unit) || ''}
            </span></div></div>
          {big && <div className="ap-warn">⚠️ Chênh lệch lớn (≥ 20% tồn sổ) — kiểm tra kỹ trước khi duyệt.</div>}
        </div>
      );
    }
    case 'transaction': {
      return (
        <div>
          {kv([
            ['Mã phiếu', rec.code],
            ['Loại', rec.type === 'income' ? 'Phiếu thu' : 'Phiếu chi'],
            ['Số tiền', <b key="a">{fmtMoney(rec.amount)}đ</b>],
            ['Danh mục', rec.category && rec.category.name],
            ['Quỹ', rec.account && rec.account.name],
            ['Đối tác', rec.partner && rec.partner.name],
            ['Chi nhánh', rec.branch && rec.branch.name],
            ['Người tạo', creator],
            ['Ghi chú', rec.note],
          ])}
        </div>
      );
    }
    case 'shift_registration': {
      const ws = rec.workShift || {};
      return (
        <div>
          {kv([
            ['Nhân viên', rec.employee && rec.employee.full_name],
            ['Ca', ws.name || ''],
            ['Ngày', rec.date],
            ...(ws.start_time ? [['Giờ ca', `${ws.start_time} – ${ws.end_time || ''}`]] : []),
            ['Chi nhánh NV', rec.employee && rec.employee.branch && rec.employee.branch.name],
          ])}
          <div className="ap-warn">Duyệt ở đây chỉ <b>xác nhận đăng ký</b>; việc xếp ca chính thức thực hiện ở trang <b>Xếp ca (Admin)</b>.</div>
        </div>
      );
    }
    case 'leave_request': {
      const typeLabel = rec.type === 'doica' ? 'Đổi ca' : rec.type === 'khac' ? 'Nghỉ khác' : 'Nghỉ phép';
      return (
        <div>
          {kv([
            ['Nhân viên', rec.employee && rec.employee.full_name],
            ['Loại', typeLabel],
            ['Từ ngày', rec.date_from], ['Đến ngày', rec.date_to || rec.date_from],
            ['Lý do NV', rec.reason],
            ['Chi nhánh NV', rec.employee && rec.employee.branch && rec.employee.branch.name],
          ])}
        </div>
      );
    }
    default:
      return null;
  }
}

// ---------------- Hộp xác nhận duyệt/từ chối (mục 4.4 + 5b spec) ----------------
function ConfirmDialog({ A, token, hubT, emp, type, id, action, rec, branchNames, onClose, onDone }) {
  const meta = TYPES_META[type] || {};
  const reasonMode = REASON_MODE[type] || 'none';
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const authCfg = cfg(token, hubT);

  const branchLine = type === 'transfer'
    ? `📍 Chi nhánh của phiếu: ${(branchNames[0] || '')} → ${(branchNames[1] || '')}`
    : `📍 Chi nhánh của phiếu: ${branchNames[0] || ''}`;
  const title = action === 'approve' ? `Duyệt ${meta.label}` : `${meta.rejectLabel} ${meta.label}`;
  const summaryLine = (() => {
    switch (type) {
      case 'inbound': return `${rec.code}: ${(rec.items || []).length} dòng, tổng ${fmtMoney(rec.grand_total)}đ — sẽ tạo lô kho và phiếu chi.`;
      case 'outbound': return `${rec.code}: ${(rec.items || []).length} dòng — sẽ trừ kho theo FIFO.`;
      case 'transfer': return `${rec.code}: ${(rec.items || []).length} dòng — trừ nguồn, cộng đích.`;
      case 'stocktake_adjustment': return `Chênh lệch ${(Number(rec.diff_qty) || 0) > 0 ? '+' : ''}${rec.diff_qty} ${((rec.material || {}).unit) || ''} — sẽ điều chỉnh tồn kho.`;
      case 'transaction': return `${rec.code}: ${(rec.type === 'income' ? 'thu' : 'chi')} ${fmtMoney(rec.amount)}đ.`;
      case 'shift_registration': return `${(rec.employee || {}).full_name || ''} — ${(rec.workShift || {}).name || ''} ngày ${rec.date}.`;
      case 'leave_request': return `${(rec.employee || {}).full_name || ''} — nghỉ từ ${rec.date_from}${rec.date_to ? ' đến ' + rec.date_to : ''}.`;
      default: return rec.code || '';
    }
  })();
  // TESTER fix 🟡b: lý do chỉ BẮT BUỘC khi Từ chối — hộp lý do không hiện/không khóa nút Duyệt
  const showReason = reasonMode !== 'none' && (action === 'reject' || reasonMode === 'optional');
  const reasonOk = action !== 'reject' || reasonMode !== 'required' || reason.trim().length > 0;

  const submit = async () => {
    if (!reasonOk || busy) return;
    setBusy(true); setErr('');
    try {
      let approvalToken;
      try {
        approvalToken = await ensureApprovalToken(authCfg, emp && emp.id, pin);
      } catch (e2) {
        if (e2 && e2.message === 'NEED_PIN') { setErr('Nhập mã PIN 6 số của bạn để xác nhận.'); setBusy(false); return; }
        setErr(errMsg(e2, 'Mã PIN không đúng.')); setBusy(false); return;
      }
      const body = { branch_id: Number((A.params || {}).branch_id) || undefined, approval_token: approvalToken };
      if (reasonMode !== 'none' && reason.trim()) body.reason = reason.trim();
      const url = `${API}/employee/approvals/${type}/${id}/${action}`;
      const r = await axios.post(url, body, authCfg);
      if (r.data && r.data.success) {
        // Thông báo kết quả cho màn danh sách (mục 6.3 spec)
        onDone(action === 'approve' ? 'Đã duyệt phiếu thành công ✅'
          : ((TYPES_META[type] || {}).rejectLabel === 'Hủy phiếu' ? 'Đã hủy phiếu ✅' : 'Đã từ chối phiếu ✅'));
      }
      else { setErr(errMsg(r, 'Thao tác thất bại.')); }
    } catch (e) {
      if (e && e.response && e.response.data && e.response.data.code === 'PIN_REQUIRED') {
        approvalTokenCache = { token: '', ts: 0, empId: 0 };
        setErr('Phiên xác nhận PIN đã hết hạn — nhập lại PIN.');
      } else {
        setErr(errMsg(e, 'Thao tác thất bại.'));
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="ap-modal" onClick={onClose}>
      <div className="ap-box" onClick={(e) => e.stopPropagation()}>
        <h4>{title}</h4>
        <p>{summaryLine}</p>
        <div className="ap-pinbranch">{branchLine}</div>
        {showReason && (
          <div>
            <label className="ap-note-lb">Lý do {action === 'reject' && reasonMode === 'required' && <span className="ap-req">(bắt buộc)</span>}</label>
            <textarea className="ap-note" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={type === 'transaction' ? 'Nhập lý do từ chối...' : 'Lý do (tùy chọn)...'} maxLength={500} />
          </div>
        )}
        <label className="ap-note-lb">Mã PIN của bạn <span className="ap-req">(xác nhận lại)</span></label>
        <input className="ap-pin" type="password" inputMode="numeric" maxLength={6}
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••" autoComplete="off" />
        <div style={{ fontSize: 11.5, color: '#8a93a6', marginBottom: 4 }}>Nhập 1 lần, miễn nhắc lại trong 5 phút.</div>
        {err && <div className="ap-err">{err}</div>}
        <div style={{ display: 'flex', gap: 9, marginTop: 10 }}>
          <button className="ap-btn rej" style={{ borderColor: '#e3e8f2', color: '#24305E' }} onClick={onClose} disabled={busy}>Hủy bỏ</button>
          <button className="ap-btn go" onClick={submit} disabled={busy || !reasonOk}>
            {busy ? 'Đang xử lý...' : `Xác nhận ${action === 'approve' ? 'duyệt' : meta.rejectLabel.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApprovalsFlow;
