import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api'; // Gói 37e: API tương đối — chạy được trên điện thoại (IP LAN)
import DateInput from '../components/DateInput'; // Gói 36d: ô ngày dd/mm/yyyy

// Trang nhân viên tự báo lỗi 3 Chuyên (public, KHÔNG cần đăng nhập admin)
// Bám demo đã duyệt: ~/workspace/your_files/demo-loi-3-chuyen.html (tab "NV tự báo lỗi")
// Token riêng: localStorage['viol_token'] / ['viol_emp'] (không đụng emp_token của đăng ký ca)
// API: GET /employee/violation-types, GET /employee/my-violations?month=, POST /employee/my-violations

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.l3c-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.l3c-wrap button{font-family:inherit;}
.l3c-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.l3c-hd-user{display:flex;align-items:center;gap:10px;}
.l3c-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.l3c-name{font-size:15px;font-weight:700;line-height:1.25;}
.l3c-sub{font-size:12px;opacity:.75;margin-top:1px;}
.l3c-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.l3c-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:40px;white-space:nowrap;}
.l3c-logout:active{transform:scale(.95);}
.l3c-monthbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px 0;}
.l3c-mbtn{width:44px;height:44px;border-radius:12px;flex-shrink:0;background:#fff;border:1px solid #e8e9ee;font-size:20px;font-weight:700;color:${NAVY};display:flex;align-items:center;justify-content:center;}
.l3c-mbtn:active{transform:scale(.94);}
.l3c-mbtn:disabled{opacity:.3;}
.l3c-mlabel{flex:1;text-align:center;background:#fff;border:1px solid #e8e9ee;border-radius:12px;padding:11px 8px;font-size:15px;font-weight:700;color:${NAVY};}
.l3c-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.l3c-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.l3c-vrow{border:1px solid #e8e9ee;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;}
.l3c-vrow:last-child{margin-bottom:0;}
.l3c-vn{font-weight:600;font-size:13.5px;line-height:1.4;}
.l3c-vd{font-size:12px;color:#6b7280;margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.l3c-pts{font-weight:800;color:${NAVY};font-size:14px;white-space:nowrap;}
.l3c-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;}
.l3c-b-can{background:#dbeafe;color:#1d4ed8;}
.l3c-b-mon{background:#fef3c7;color:#b45309;}
.l3c-b-nghiep{background:#ede9fe;color:#6d28d9;}
.l3c-b-other{background:#f1f5f9;color:#475569;}
.l3c-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
.l3c-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;}
.l3c-field:focus{outline:none;border-color:${ORANGE};}
.l3c-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.l3c-2col{display:flex;gap:10px;}
.l3c-2col>div{flex:1;min-width:0;}
.l3c-confirm{background:${ORANGE};color:#fff;width:100%;min-height:52px;border:none;border-radius:12px;font-size:15.5px;font-weight:800;margin-top:14px;}
.l3c-confirm:active{transform:scale(.97);}
.l3c-confirm:disabled{opacity:.45;}
.l3c-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.l3c-privacy{margin:12px 16px 0;padding:10px 12px;background:#eef4ee;border:1px solid #cfe3cf;border-radius:12px;font-size:12.5px;color:#2c5f2d;font-weight:500;display:flex;align-items:center;gap:8px;line-height:1.45;}
.l3c-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:999px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;white-space:nowrap;max-width:92vw;}
.l3c-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.l3c-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.l3c-login{padding:40px 24px;}
.l3c-pin{font-size:30px;font-weight:800;letter-spacing:12px;text-align:center;}
.l3c-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.l3c-send:active{transform:scale(.97);}
.l3c-send:disabled{opacity:.4;}
`;

function auth(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
// "2026-10-03" -> "03/10/2026"
function fmtDMY(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(ymd || '');
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}
function badgeCls(category) {
  const c = String(category || '');
  if (c.includes('can') || c.includes('Can')) return 'l3c-b-can';
  if (c.includes('mon') || c.includes('Mon')) return 'l3c-b-mon';
  if (c.includes('nghiep') || c.includes('Nghiep')) return 'l3c-b-nghiep';
  return 'l3c-b-other';
}

export default function Loi3Chuyen() {
  const [token, setToken] = useState(() => localStorage.getItem('viol_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('viol_emp') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [types, setTypes] = useState([]); // [{id, category, category_name, name, default_points}]
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);

  // tháng xem/báo: mặc định tháng hiện tại, cho lùi (không cho tới tương lai)
  const [monthOff, setMonthOff] = useState(0);
  const monthStr = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + monthOff, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }, [monthOff]);
  const monthLabel = useMemo(() => {
    const [y, m] = monthStr.split('-');
    return 'Tháng ' + m + '/' + y;
  }, [monthStr]);
  const todayIso = useMemo(() => iso(new Date()), []);

  // form tự báo
  const [violId, setViolId] = useState('');
  const [date, setDate] = useState(todayIso);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');

  const toast = (m) => {
    setToastMsg(m); setToastOn(true);
    setTimeout(() => setToastOn(false), 2400);
  };

  const logout = () => {
    localStorage.removeItem('viol_token');
    localStorage.removeItem('viol_emp');
    setToken(''); setEmp(null); setPhone(''); setPin(''); setErr('');
    setTypes([]); setMine([]);
    setViolId(''); setDate(todayIso); setPoints(''); setNote('');
    setToastOn(false);
  };

  const expired = (e) => {
    if (e && e.response && e.response.status === 401) {
      logout();
      toast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return true;
    }
    return false;
  };

  const loadAll = async (tk, month) => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        axios.get(API + '/employee/violation-types', auth(tk)),
        axios.get(API + '/employee/my-violations', { ...auth(tk), params: { month } }),
      ]);
      setTypes((t.data && t.data.data) || []);
      setMine((m.data && m.data.data && m.data.data.items) || []);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Không tải được dữ liệu.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token) loadAll(token, monthStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, monthStr]);

  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
    // Chuẩn hóa SĐT: trim, bỏ khoảng trắng, +84xxxxxxxxx → 0xxxxxxxxx
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    if (!p) { setErr('Vui lòng nhập số điện thoại.'); return; }
    if (!/^\d{6}$/.test(pin)) { setErr('Vui lòng nhập đủ 6 số PIN.'); return; }
    setLoginBusy(true);
    try {
      const r = await axios.post(API + '/employee/phone-login', { phone: p, pin_code: pin });
      const tk = r.data.access_token;
      const info = r.data.employee || {};
      localStorage.setItem('viol_token', tk);
      localStorage.setItem('viol_emp', JSON.stringify(info));
      setToken(tk); setEmp(info); setPhone(''); setPin('');
    } catch (e) {
      setErr(errMsg(e, 'Đăng nhập thất bại. Kiểm tra lại SĐT và mã PIN.'));
    } finally { setLoginBusy(false); }
  };

  // nhóm loại lỗi theo category_name để render optgroup
  const typeGroups = useMemo(() => {
    const g = [];
    const idx = {};
    types.forEach((t) => {
      const key = t.category_name || t.category || 'Khác';
      if (!(key in idx)) { idx[key] = g.length; g.push({ name: key, cls: badgeCls(t.category), items: [] }); }
      g[idx[key]].items.push(t);
    });
    return g;
  }, [types]);

  const onPickType = (id) => {
    setViolId(id);
    const t = types.find((x) => String(x.id) === String(id));
    if (t) setPoints(String(t.default_points ?? 1));
  };

  const submit = async () => {
    if (!violId) { toast('Vui lòng chọn lỗi vi phạm.'); return; }
    if (!date) { toast('Vui lòng chọn ngày vi phạm.'); return; }
    const pts = parseInt(points, 10);
    if (!pts || pts < 1) { toast('Số lỗi phải từ 1 trở lên.'); return; }
    setSaving(true);
    try {
      await axios.post(API + '/employee/my-violations', {
        violation_type_id: parseInt(violId, 10),
        date,
        points: pts,
        note: note.trim() || null,
      }, auth(token));
      toast('Đã ghi nhận lỗi. Cảm ơn bạn đã tự giác! ✓');
      setViolId(''); setDate(todayIso); setPoints(''); setNote('');
      loadAll(token, monthStr);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Ghi nhận thất bại.'));
    } finally { setSaving(false); }
  };

  if (!token) {
    return (
      <div className="l3c-wrap">
        <style>{CSS}</style>
        <div className="l3c-login">
          <div className="l3c-hd" style={{ borderRadius: 18 }}>
            <div className="l3c-title">🚨 Tự báo lỗi 3 Chuyên</div>
            <div className="l3c-sub">Đăng nhập để tiếp tục</div>
          </div>
          <form className="l3c-card" onSubmit={doLogin}>
            <label className="l3c-label" style={{ marginTop: 4 }}>Số điện thoại</label>
            <input
              className="l3c-field"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              placeholder="09xxxxxxxx"
              autoComplete="tel"
            />
            <label className="l3c-label">Mã PIN 6 số</label>
            <input
              className="l3c-field l3c-pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              autoComplete="off"
            />
            {err && <div className="l3c-msg" style={{ margin: '12px 0 0' }}>{err}</div>}
            <button className="l3c-send" type="submit" disabled={loginBusy}>
              {loginBusy ? 'Đang xử lý...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const avatarLetter = ((emp && emp.full_name) || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="l3c-wrap">
      <style>{CSS}</style>

      <header className="l3c-hd">
        <div className="l3c-hd-user">
          <div className="l3c-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="l3c-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="l3c-sub">{(emp && emp.branch_name) || ''}</div>
          </div>
          <button className="l3c-logout" onClick={logout} aria-label="Đăng xuất">Đăng xuất</button>
        </div>
        <div className="l3c-title">🚨 Tự báo lỗi 3 Chuyên</div>
      </header>

      <div className="l3c-monthbar">
        <button className="l3c-mbtn" onClick={() => setMonthOff((o) => o - 1)} aria-label="Tháng trước">‹</button>
        <div className="l3c-mlabel">Xin chào, {(emp && emp.full_name) || 'bạn'} · {monthLabel}</div>
        <button className="l3c-mbtn" onClick={() => setMonthOff((o) => o + 1)} disabled={monthOff >= 0} aria-label="Tháng sau">›</button>
      </div>

      <div className="l3c-privacy">🔒 <span>Bạn chỉ thấy lỗi của <b>chính mình</b>. Quản lý thấy để tổng hợp cuối tháng.</span></div>

      <section className="l3c-card">
        <h3>Lỗi của bạn trong {monthLabel.toLowerCase()}</h3>
        {loading ? (
          <div className="l3c-empty">Đang tải...</div>
        ) : mine.length === 0 ? (
          <div className="l3c-empty">Chưa ghi nhận lỗi nào.<br />Giữ vững phong độ nhé! 🎉</div>
        ) : (
          mine.map((v) => (
            <div className="l3c-vrow" key={v.id}>
              <div>
                <div className="l3c-vn">{v.violation_name}</div>
                <div className="l3c-vd">
                  <span>{fmtDMY(v.date)}</span>
                  <span className={'l3c-badge ' + badgeCls(v.category || v.category_name)}>{v.category_name}</span>
                </div>
                {v.note && <div className="l3c-vd" style={{ fontStyle: 'italic' }}>{v.note}</div>}
              </div>
              <div className="l3c-pts">{v.points} lỗi</div>
            </div>
          ))
        )}
      </section>

      <section className="l3c-card">
        <h3>Lỗi của bạn hôm nay</h3>
        <label className="l3c-label" style={{ marginTop: 0 }}>Chọn lỗi vi phạm</label>
        <select className="l3c-field" value={violId} onChange={(e) => onPickType(e.target.value)}>
          <option value="">— Chọn lỗi —</option>
          {typeGroups.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.default_points} lỗi)</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="l3c-2col">
          <div>
            <label className="l3c-label">Ngày vi phạm</label>
            <DateInput value={date} onChange={setDate} className="l3c-field" />
          </div>
          <div>
            <label className="l3c-label">Số lỗi</label>
            <input
              className="l3c-field"
              type="number"
              min={1}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="Tự điền theo loại"
            />
          </div>
        </div>
        <label className="l3c-label">Ghi chú (không bắt buộc)</label>
        <input
          className="l3c-field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="VD: kẹt xe..."
        />
        <button className="l3c-confirm" onClick={submit} disabled={saving}>
          {saving ? 'Đang ghi nhận...' : '✓ Tôi xác nhận lỗi này'}
        </button>
      </section>

      <div className="l3c-note">
        📌 <b>Lưu ý:</b> NV phạm lỗi tự giác đánh dấu. Nếu quản lý kiểm tra phát hiện mà bạn <b>không tự báo</b>, số lỗi <b>tính thêm 2</b>.
      </div>

      <div className={'l3c-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}
