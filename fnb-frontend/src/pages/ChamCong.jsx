import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { fmtDate, fmtTime } from '../utils/format';
import { API } from '../utils/api'; // Gói 37e: API tương đối — chạy được trên điện thoại (IP LAN)
import DateInput from '../components/DateInput';

// Trang chấm công nhân viên (public, mở từ QR: /cham-cong?b=<id>&t=<token>)
// Gói 35 — dùng endpoint /api/employee/... với header Authorization: Bearer <emp_token>

const NAVY = '#24305E';
const ORANGE = '#F5A623';
const GREEN = '#157f3d';

const CSS = `
.cc-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;}
.cc-hd{background:${NAVY};color:#fff;padding:16px 16px 20px;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.cc-name{font-size:17px;font-weight:800;}
.cc-branch{font-size:13px;opacity:.75;margin-top:2px;}
.cc-title{font-size:19px;font-weight:800;margin-top:12px;}
.cc-body{padding:14px 16px 90px;}
.cc-card{background:#fff;border-radius:14px;padding:16px;margin-top:12px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.cc-status-dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px;}
.cc-big{min-height:60px;border-radius:14px;font-size:16px;font-weight:800;color:#fff;flex:1;display:flex;align-items:center;justify-content:center;min-width:44px;transition:transform .1s,opacity .15s;}
.cc-big:active{transform:scale(.97);}
.cc-big:disabled{opacity:.35;}
.cc-msg{margin-top:12px;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;}
.cc-msg.ok{background:#eef7ef;border:1px solid #c9e5cd;color:#14602f;}
.cc-msg.err{background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.cc-tabs{display:flex;gap:8px;margin-top:14px;}
.cc-tab{flex:1;min-height:48px;border-radius:12px;background:#fff;border:1.5px solid #e8e9ee;font-size:14px;font-weight:700;color:#6b7280;}
.cc-tab.on{border-color:${NAVY};color:${NAVY};background:rgba(36,48,94,.06);}
.cc-hist-row{display:flex;align-items:center;justify-content:space-between;padding:12px 2px;border-bottom:1px solid #f0f1f5;min-height:48px;}
.cc-hist-row:last-child{border-bottom:none;}
.cc-field{width:100%;min-height:48px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:8px;}
.cc-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.cc-btn{min-height:50px;border-radius:12px;font-size:15px;font-weight:800;background:${NAVY};color:#fff;width:100%;}
.cc-btn:disabled{opacity:.4;}
.cc-pin{font-size:32px;font-weight:800;letter-spacing:12px;text-align:center;min-height:64px;}
.cc-req{border:1px solid #e8e9ee;border-radius:12px;padding:12px;margin-top:10px;font-size:14px;}
.cc-badge{display:inline-block;font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;margin-top:6px;}
.cc-out{background:none;border:none;color:#6b7280;font-size:13.5px;font-weight:700;margin-top:18px;width:100%;min-height:44px;}
.cc-link{background:none;border:none;color:${NAVY};font-size:14.5px;font-weight:800;padding:14px;width:100%;min-height:44px;text-align:center;}
`;

function auth(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
// Gói 36: hiển thị ngày/giờ dùng fmtDate/fmtTime từ ../utils/format (dd/mm/yyyy, HH:MM 24h)
function workHours(inT, outT) {
  if (!inT || !outT) return '';
  const a = String(inT).match(/(\d{2}):(\d{2})/), b = String(outT).match(/(\d{2}):(\d{2})/);
  if (!a || !b) return '';
  const h = (parseInt(b[1], 10) * 60 + parseInt(b[2], 10) - parseInt(a[1], 10) * 60 - parseInt(a[2], 10)) / 60;
  if (h < 0) return '';
  return h.toFixed(1) + ' giờ';
}
function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}

export default function ChamCong() {
  const [params] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return { b: q.get('b') || '', t: q.get('t') || '' };
  });
  const [token, setToken] = useState(() => localStorage.getItem('emp_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('emp_info') || 'null'); } catch (e) { return null; }
  });
  const [pin, setPin] = useState('');
  const [tab, setTab] = useState('today');
  const [today, setToday] = useState(null);
  const [msg, setMsg] = useState(null); // {ok:true,text}
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [requests, setRequests] = useState([]);
  const [reqLoaded, setReqLoaded] = useState(false);
  const [fType, setFType] = useState('nghi');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fReason, setFReason] = useState('');

  const loadToday = async (tk) => {
    try {
      const r = await axios.get(API + '/employee/attendance/today', {
        ...auth(tk),
        params: { branch_id: (emp && emp.branch_id) || params.b || undefined },
      });
      setToday(r.data && r.data.data ? r.data.data : null);
    } catch (e) { /* giữ nguyên trạng thái cũ */ }
  };

  const loadMe = async (tk) => {
    try {
      const r = await axios.get(API + '/employee/me', auth(tk));
      const info = r.data && r.data.data ? r.data.data : null;
      if (info) {
        setEmp(info);
        localStorage.setItem('emp_info', JSON.stringify(info));
        return info;
      }
    } catch (e) { /* token cũ */ }
    return emp;
  };

  useEffect(() => {
    if (!token) return;
    (async () => {
      const info = await loadMe(token);
      await loadToday(token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogin = async (e) => {
    e.preventDefault();
    if (!params.b || !params.t) {
      setMsg({ ok: false, text: 'Link QR không hợp lệ (thiếu mã chi nhánh hoặc token). Hãy quét lại QR tại quán.' });
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setMsg({ ok: false, text: 'Vui lòng nhập đủ 6 số PIN.' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post(API + '/employee/qr-login', {
        branch_id: params.b, token: params.t, pin_code: pin,
      });
      const tk = r.data.access_token;
      const info = r.data.employee || {};
      localStorage.setItem('emp_token', tk);
      localStorage.setItem('emp_info', JSON.stringify(info));
      setToken(tk); setEmp(info); setPin('');
      setMsg({ ok: true, text: 'Đăng nhập thành công. Chào ' + (info.full_name || 'bạn') + '!' });
      await loadToday(tk);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'Đăng nhập thất bại. Kiểm tra lại mã PIN.') });
    } finally { setBusy(false); }
  };

  const doCheck = async (kind) => {
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post(
        API + '/employee/attendance/check-' + kind,
        { branch_id: (emp && emp.branch_id) || params.b, token: params.t },
        auth(token)
      );
      setMsg({ ok: true, text: (r.data && r.data.message) || (kind === 'in' ? 'Đã chấm công vào.' : 'Đã chấm công ra.') });
      await loadToday(token);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'Chấm công thất bại. Vui lòng thử lại.') });
    } finally { setBusy(false); }
  };

  const openHistory = async () => {
    setTab('history');
    if (!historyLoaded) {
      try {
        const r = await axios.get(API + '/employee/attendance/history', {
          ...auth(token), params: { month: currentMonth() },
        });
        setHistory(r.data && r.data.data ? r.data.data : []);
        setHistoryLoaded(true);
      } catch (e) {
        setMsg({ ok: false, text: errMsg(e, 'Không tải được lịch sử chấm công.') });
      }
    }
  };

  const openRequests = async () => {
    setTab('requests');
    if (!reqLoaded) {
      try {
        const r = await axios.get(API + '/employee/leave-requests', auth(token));
        setRequests(r.data && r.data.data ? r.data.data : []);
        setReqLoaded(true);
      } catch (e) {
        setMsg({ ok: false, text: errMsg(e, 'Không tải được danh sách yêu cầu.') });
      }
    }
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!fFrom) { setMsg({ ok: false, text: 'Vui lòng chọn ngày bắt đầu.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post(API + '/employee/leave-requests', {
        type: fType, date_from: fFrom, date_to: fTo || undefined, reason: fReason || undefined,
      }, auth(token));
      const created = r.data && r.data.data ? r.data.data : null;
      if (created) setRequests([created, ...requests]);
      else setReqLoaded(false);
      setFType('nghi'); setFFrom(''); setFTo(''); setFReason('');
      setMsg({ ok: true, text: 'Đã gửi yêu cầu. Quản lý sẽ duyệt sau.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'Gửi yêu cầu thất bại. Vui lòng thử lại.') });
    } finally { setBusy(false); }
  };

  const logout = () => {
    localStorage.removeItem('emp_token');
    localStorage.removeItem('emp_info');
    setToken(''); setEmp(null); setPin(''); setMsg(null); setTab('today'); setToday(null);
  };

  const statusBadge = (st) => {
    if (st === 'approved' || st === 'duyet') return { txt: 'Đã duyệt', bg: '#eef7ef', fg: '#14602f' };
    if (st === 'rejected' || st === 'tuchoi') return { txt: 'Từ chối', bg: '#fdeeee', fg: '#a12b2b' };
    return { txt: 'Chờ duyệt', bg: '#fff8ec', fg: '#8a5a00' };
  };

  return (
    <div className="cc-wrap">
      <style>{CSS}</style>

      {!token && (
        <div className="cc-body" style={{ paddingTop: 40 }}>
          <div className="cc-hd" style={{ borderRadius: 18 }}>
            <div className="cc-title">Chấm công nhân viên</div>
            <div className="cc-branch">Quét QR tại quán để mở trang này</div>
          </div>
          <form className="cc-card" onSubmit={doLogin}>
            <label className="cc-label" style={{ marginTop: 0 }}>Nhập mã PIN 6 số của bạn</label>
            <input
              className="cc-field cc-pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              autoComplete="off"
            />
            {msg && <div className={'cc-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
            <div style={{ marginTop: 14 }}>
              <button className="cc-btn" type="submit" disabled={busy || pin.length !== 6}>
                {busy ? 'Đang xử lý...' : 'Đăng nhập'}
              </button>
            </div>
          </form>
        </div>
      )}

      {token && (
        <React.Fragment>
          <header className="cc-hd">
            <div className="cc-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="cc-branch">{(emp && emp.branch_name) || 'Chi nhánh'}</div>
            <div className="cc-title">Chấm công</div>
          </header>

          <div className="cc-body">
            <div className="cc-tabs">
              <button className={'cc-tab' + (tab === 'today' ? ' on' : '')} onClick={() => setTab('today')}>Hôm nay</button>
              <button className={'cc-tab' + (tab === 'history' ? ' on' : '')} onClick={openHistory}>Lịch sử</button>
              <button className={'cc-tab' + (tab === 'requests' ? ' on' : '')} onClick={openRequests}>Yêu cầu</button>
            </div>

            {tab === 'today' && (
              <div className="cc-card">
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Trạng thái hôm nay</div>
                {today && today.check_in ? (
                  <div style={{ fontSize: 14.5 }}>
                    <span className="cc-status-dot" style={{ background: today.check_out ? GREEN : ORANGE }} />
                    {today.check_out
                      ? 'Đã chấm ra lúc ' + fmtTime(today.check_out) + ' (vào ' + fmtTime(today.check_in) + ')'
                      : 'Đã vào lúc ' + fmtTime(today.check_in) + ' — chưa chấm công ra'}
                  </div>
                ) : (
                  <div style={{ fontSize: 14.5, color: '#6b7280' }}>
                    <span className="cc-status-dot" style={{ background: '#c9ccd6' }} />
                    Chưa chấm công hôm nay
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button
                    className="cc-big"
                    style={{ background: GREEN }}
                    disabled={busy || (today && today.check_in)}
                    onClick={() => doCheck('in')}
                  >Chấm công vào</button>
                  <button
                    className="cc-big"
                    style={{ background: ORANGE, color: NAVY }}
                    disabled={busy || !(today && today.check_in) || (today && today.check_out)}
                    onClick={() => doCheck('out')}
                  >Chấm công ra</button>
                </div>
                {msg && <div className={'cc-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
              </div>
            )}

            {tab === 'history' && (
              <div className="cc-card">
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 6 }}>
                  Lịch sử tháng {currentMonth().split('-')[1]}/{currentMonth().split('-')[0]}
                </div>
                {history.length === 0 ? (
                  <div style={{ fontSize: 14, color: '#6b7280', padding: '12px 0' }}>Chưa có dữ liệu tháng này.</div>
                ) : history.map((h, i) => (
                  <div className="cc-hist-row" key={i}>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{fmtDate(h.date)}</div>
                      <div style={{ fontSize: 12.5, color: '#6b7280' }}>{(h.branch && h.branch.name) || ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 13.5 }}>
                      <div>{fmtTime(h.check_in) || '--:--'} → {fmtTime(h.check_out) || '--:--'}</div>
                      {h.check_in && h.check_out && (
                        <div style={{ fontWeight: 700, color: NAVY }}>{workHours(h.check_in, h.check_out)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'requests' && (
              <React.Fragment>
                <form className="cc-card" onSubmit={submitRequest}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Gửi yêu cầu</div>
                  <label className="cc-label">Loại yêu cầu</label>
                  <select className="cc-field" value={fType} onChange={(e) => setFType(e.target.value)}>
                    <option value="nghi">Xin nghỉ</option>
                    <option value="doica">Đổi ca</option>
                    <option value="khac">Khác</option>
                  </select>
                  <label className="cc-label">Từ ngày</label>
                  <DateInput className="cc-field" value={fFrom} onChange={setFFrom} placeholder="dd/mm/yyyy" />
                  <label className="cc-label">Đến ngày (nếu có)</label>
                  <DateInput className="cc-field" value={fTo} min={fFrom} onChange={setFTo} placeholder="dd/mm/yyyy" />
                  <label className="cc-label">Lý do</label>
                  <textarea
                    className="cc-field"
                    rows={2}
                    value={fReason}
                    onChange={(e) => setFReason(e.target.value)}
                    placeholder="Ghi ngắn gọn lý do..."
                  />
                  <div style={{ marginTop: 14 }}>
                    <button className="cc-btn" type="submit" disabled={busy}>
                      {busy ? 'Đang gửi...' : 'Gửi yêu cầu'}
                    </button>
                  </div>
                  {msg && <div className={'cc-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
                </form>
                <div className="cc-card">
                  <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Yêu cầu đã gửi</div>
                  {requests.length === 0 ? (
                    <div style={{ fontSize: 14, color: '#6b7280', padding: '12px 0' }}>Chưa có yêu cầu nào.</div>
                  ) : requests.map((rq, i) => {
                    const b = statusBadge(rq.status);
                    return (
                      <div className="cc-req" key={rq.id || i}>
                        <div style={{ fontWeight: 700 }}>
                          {rq.type === 'doica' ? 'Đổi ca' : rq.type === 'khac' ? 'Khác' : 'Xin nghỉ'}
                          {' · '}{fmtDate(rq.date_from)}{rq.date_to ? ' → ' + fmtDate(rq.date_to) : ''}
                        </div>
                        {rq.reason && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{rq.reason}</div>}
                        <span className="cc-badge" style={{ background: b.bg, color: b.fg }}>{b.txt}</span>
                      </div>
                    );
                  })}
                </div>
              </React.Fragment>
            )}

            <button className="cc-out" onClick={logout}>Đăng xuất</button>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
