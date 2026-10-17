import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api';
import DateInput from '../components/DateInput';
import NhapKho from './NhapKho';
import XuatKho from './XuatKho';
import ChuyenKho from './ChuyenKho';

// Gói 59: Hub nhân viên (/nhan-vien) — 1 link + QR chung cho NV.
// - Đăng nhập PIN 1 lần (lưu localStorage['staff_token'] / ['staff_emp'])
// - ?t= : mã QR hub, lưu localStorage['staff_hub_t'], gắn vào mọi API call
// - 4 cụm nút: Kho / Chế biến / Thu chi / Cá nhân
// - Nhập/Xuất/Chuyển kho: nhúng form có sẵn (embed prop)
// - Phiếu thu/chi: form rút gọn ngay trong hub → POST /api/employee/transactions (chờ duyệt)

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.sh-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.sh-wrap button{font-family:inherit;}
.sh-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.sh-hd-user{display:flex;align-items:center;gap:10px;}
.sh-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.sh-name{font-size:15px;font-weight:700;line-height:1.25;}
.sh-sub{font-size:12px;opacity:.75;margin-top:1px;}
.sh-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.sh-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:40px;white-space:nowrap;}
.sh-logout:active{transform:scale(.95);}
.sh-branchsel{margin-top:4px;max-width:100%;background:#fff;border:none;color:${NAVY};font-size:13px;font-weight:700;padding:8px 28px 8px 12px;border-radius:10px;min-height:38px;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2324305E' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;cursor:pointer;}
.sh-branchsel option{color:#1a1d26;background:#fff;font-weight:400;}
.sh-login{padding:40px 24px;}
.sh-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.sh-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.sh-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.sh-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;box-sizing:border-box;}
.sh-field:focus{outline:none;border-color:${ORANGE};}
.sh-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.sh-send:active{transform:scale(.97);}
.sh-send:disabled{opacity:.4;}
.sh-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.sh-group{margin:16px 16px 0;}
.sh-group-t{font-size:13px;font-weight:800;color:${NAVY};margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;}
.sh-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.sh-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:96px;border:none;border-radius:14px;background:#fff;color:${NAVY};font-size:14px;font-weight:700;box-shadow:0 1px 3px rgba(16,24,40,.06);padding:12px 8px;}
.sh-btn:active{transform:scale(.96);}
.sh-btn .ic{font-size:28px;line-height:1;}
.sh-btn small{font-size:11px;font-weight:600;color:#9ca3af;}
.sh-back{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:13px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:40px;}
.sh-back:active{transform:scale(.95);}
.sh-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.sh-ok{margin:12px 16px 0;padding:14px;border-radius:12px;font-size:14px;background:#f0fdf4;border:1px solid #86efac;color:#15803d;line-height:1.6;}
.sh-2col{display:flex;gap:10px;}
.sh-2col>div{flex:1;min-width:0;}
.sh-submit{background:${ORANGE};color:#fff;width:100%;min-height:54px;border:none;border-radius:12px;font-size:16px;font-weight:800;margin-top:14px;}
.sh-submit:active{transform:scale(.97);}
.sh-submit:disabled{opacity:.45;}
`;

function auth(token, hubT) {
  const h = { headers: { Authorization: 'Bearer ' + token } };
  if (hubT) h.params = { t: hubT };
  return h;
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}
function isoToday() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function fmtVND(n) {
  return (Math.round(Number(n) || 0)).toLocaleString('vi-VN') + 'đ';
}

// ---- Form phiếu thu/chi rút gọn (dùng trong hub) ----
function TxnForm({ token, hubT, emp, kind, onBack, onExpired, branchId }) {
  const isIncome = kind === 'income';
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [catId, setCatId] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(isoToday());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(API + '/transaction-categories', auth(token, hubT));
        const list = r.data && r.data.data ? r.data.data : [];
        setCats(list.filter((c) => c.type === (isIncome ? 'income' : 'expense')));
      } catch (e) { /* bỏ qua */ }
      try {
        const r2 = await axios.get(API + '/accounts', auth(token, hubT));
        const list2 = r2.data && r2.data.data ? r2.data.data : (Array.isArray(r2.data) ? r2.data : []);
        setAccounts(Array.isArray(list2) ? list2 : []);
      } catch (e) { setAccounts([]); /* NV không có quyền xem quỹ → ẩn field */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setErr('');
    const amt = parseFloat(String(amount).replace(/[^\d.]/g, ''));
    if (!catId) { setErr('Vui lòng chọn danh mục.'); return; }
    if (!amt || amt < 1) { setErr('Vui lòng nhập số tiền hợp lệ.'); return; }
    setSaving(true);
    try {
      const r = await axios.post(API + '/employee/transactions', {
        type: isIncome ? 'income' : 'expense',
        category_id: Number(catId),
        amount: amt,
        account_id: accountId ? Number(accountId) : null,
        occurred_at: date || null,
        note: note.trim() || null,
        branch_id: branchId || null, // Gói 60: CN đang thao tác
      }, auth(token, hubT));
      const d = r.data && r.data.data ? r.data.data : {};
      setDone({ code: d.code || '', amount: amt });
    } catch (e) {
      if (e && e.response && e.response.status === 401) { onExpired(); return; }
      setErr(errMsg(e, 'Tạo phiếu thất bại.'));
    } finally { setSaving(false); }
  };

  return (
    <div className="sh-wrap">
      <style>{CSS}</style>
      <header className="sh-hd">
        <div className="sh-hd-user">
          <button className="sh-back" onClick={onBack}>‹ Quay lại</button>
          <div style={{ flex: 1 }} />
        </div>
        <div className="sh-title">{isIncome ? '🧾 Tạo phiếu thu' : '💸 Tạo phiếu chi'}</div>
        <div className="sh-sub">{(emp && emp.full_name) || ''} · {(emp && emp.branch_name) || ''}</div>
      </header>

      {done ? (
        <div className="sh-ok">
          <div style={{ fontWeight: 800, fontSize: 16 }}>✅ Đã tạo phiếu {done.code}</div>
          <div>Số tiền: <b>{fmtVND(done.amount)}</b></div>
          <div style={{ marginTop: 8 }}>Phiếu ở trạng thái <b>Chờ duyệt</b> — quản lý xác nhận trong admin mới có hiệu lực.</div>
          <button className="sh-send" style={{ background: ORANGE, marginTop: 14 }} onClick={onBack}>Về trang chính</button>
        </div>
      ) : (
        <div className="sh-card">
          <label className="sh-label" style={{ marginTop: 0 }}>Danh mục *</label>
          <select className="sh-field" value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">— Chọn danh mục —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <label className="sh-label">Số tiền *</label>
          <input className="sh-field" type="number" min="1" inputMode="numeric" placeholder="VD: 500000"
            value={amount} onChange={(e) => setAmount(e.target.value)} />

          {accounts.length > 0 && (
            <>
              <label className="sh-label">Quỹ</label>
              <select className="sh-field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— Không chọn —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </>
          )}

          <label className="sh-label">Ngày thực {isIncome ? 'thu' : 'chi'}</label>
          <DateInput className="sh-field" value={date} onChange={setDate} />

          <label className="sh-label">Ghi chú</label>
          <input className="sh-field" placeholder="Nội dung phiếu..." value={note} onChange={(e) => setNote(e.target.value)} />

          {err && <div className="sh-msg">{err}</div>}
          <div className="sh-note">Phiếu ở trạng thái <b>Chờ duyệt</b> — quản lý xác nhận trong admin mới có hiệu lực.</div>
          <button className="sh-submit" disabled={saving} onClick={submit}>
            {saving ? 'Đang tạo...' : (isIncome ? 'Tạo phiếu thu' : 'Tạo phiếu chi')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Trang hub chính ----
export default function StaffHub() {
  const [hubT, setHubT] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const t = q.get('t') || '';
      if (t) localStorage.setItem('staff_hub_t', t);
      return t || localStorage.getItem('staff_hub_t') || '';
    } catch (e) { return ''; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('staff_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('staff_emp') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [screen, setScreen] = useState('hub'); // hub | nhap | xuat | chuyen | thu | chi

  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    if (!p) { setErr('Vui lòng nhập số điện thoại.'); return; }
    if (!/^\d{6}$/.test(pin)) { setErr('Vui lòng nhập đủ 6 số PIN.'); return; }
    setLoginBusy(true);
    try {
      const cfg = hubT ? { params: { t: hubT } } : {};
      const r = await axios.post(API + '/employee/phone-login', { phone: p, pin_code: pin }, cfg);
      const tk = r.data.access_token;
      const info = r.data.employee || {};
      localStorage.setItem('staff_token', tk);
      localStorage.setItem('staff_emp', JSON.stringify(info));
      setToken(tk); setEmp(info); setPhone(''); setPin('');
    } catch (e2) {
      setErr(errMsg(e2, 'Đăng nhập thất bại. Kiểm tra lại SĐT và mã PIN.'));
    } finally { setLoginBusy(false); }
  };

  const logout = () => {
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_emp');
    setToken(''); setEmp(null); setScreen('hub');
  };
  const onExpired = () => { logout(); };
  const back = () => setScreen('hub');
  // Gói 60: chi nhánh đang thao tác (NV nhiều CN được đổi)
  const empBranches = (emp && emp.branches) || [];
  const [branchId, setBranchId] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('staff_branch_id') || '0', 10);
      if (saved > 0 && empBranches.some((b) => (b.id || b) === saved) !== false) return saved;
    } catch (e) { /* ignore */ }
    return 0;
  });
  // Đồng bộ branchId khi emp thay đổi (đăng nhập mới)
  useEffect(() => {
    if (!emp) return;
    const list = (emp.branches) || [];
    const ids = list.map((b) => b.id || b);
    const saved = parseInt(localStorage.getItem('staff_branch_id') || '0', 10);
    if (saved > 0 && ids.includes(saved)) {
      setBranchId(saved);
    } else {
      const primary = parseInt(emp.branch_id, 10) || ids[0] || 0;
      setBranchId(primary);
      try { localStorage.setItem('staff_branch_id', String(primary)); } catch (e) { /* ignore */ }
    }
  }, [emp && emp.id]);
  const changeBranch = (id) => {
    const nid = parseInt(id, 10) || 0;
    setBranchId(nid);
    try { localStorage.setItem('staff_branch_id', String(nid)); } catch (e) { /* ignore */ }
  };
  const branchName = (() => {
    const b = empBranches.find((x) => (x.id || x) === branchId);
    return (b && b.name) || (emp && emp.branch_name) || '';
  })();
  const embed = { token, emp, hubT, onBack: back, onExpired, branchId };

  const avatarLetter = ((emp && emp.full_name) || 'N').trim().charAt(0).toUpperCase();

  const BTNS = [
    { group: 'Kho', items: [
      { key: 'nhap', icon: '📥', label: 'Nhập kho' },
      { key: 'xuat', icon: '📤', label: 'Xuất kho' },
      { key: 'chuyen', icon: '🔄', label: 'Chuyển kho' },
      { key: 'kiemke', icon: '📋', label: 'Kiểm kho', href: '/kiem-ke' },
    ]},
    { group: 'Chế biến', items: [
      { key: 'chebien', icon: '🍳', label: 'Chế biến', href: '/che-bien' },
    ]},
    { group: 'Thu chi', items: [
      { key: 'thu', icon: '🧾', label: 'Tạo phiếu thu' },
      { key: 'chi', icon: '💸', label: 'Tạo phiếu chi' },
    ]},
    { group: 'Cá nhân', items: [
      { key: 'dangkyca', icon: '📅', label: 'Đăng ký ca', href: '/dang-ky-ca' },
      { key: 'xinnghi', icon: '🏖️', label: 'Xin nghỉ phép', href: '/xin-nghi' },
      { key: 'baoloi', icon: '⚠️', label: 'Chấm 3 Chuyên', href: '/loi-3-chuyen' },
    ]},
  ];

  const openBtn = (b) => {
    if (b.href) { window.location.href = b.href + (hubT ? (b.href.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(hubT) : ''); return; }
    setScreen(b.key);
  };

  // ---- Màn hình đăng nhập ----
  if (!token) {
    return (
      <div className="sh-wrap">
        <style>{CSS}</style>
        <div className="sh-login">
          <div className="sh-hd" style={{ borderRadius: 18 }}>
            <div className="sh-title">👥 Cổng nhân viên</div>
            <div className="sh-sub">Quét QR tại quầy → nhập SĐT + PIN để làm việc</div>
          </div>
          <form className="sh-card" onSubmit={doLogin}>
            <label className="sh-label" style={{ marginTop: 4 }}>Số điện thoại</label>
            <input className="sh-field" inputMode="tel" placeholder="VD: 0901234567"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
            <label className="sh-label">Mã PIN (6 số)</label>
            <input className="sh-field" type="password" inputMode="numeric" maxLength={6}
              placeholder="••••••" style={{ letterSpacing: 8, textAlign: 'center', fontSize: 22, fontWeight: 800 }}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            {err && <div className="sh-msg">{err}</div>}
            <button className="sh-send" disabled={loginBusy}>{loginBusy ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Form nhúng ----
  if (screen === 'nhap') return <NhapKho embed={embed} />;
  if (screen === 'xuat') return <XuatKho embed={embed} />;
  if (screen === 'chuyen') return <ChuyenKho embed={embed} />;
  if (screen === 'thu') return <TxnForm token={token} hubT={hubT} emp={emp} kind="income" onBack={back} onExpired={onExpired} branchId={branchId} />;
  if (screen === 'chi') return <TxnForm token={token} hubT={hubT} emp={emp} kind="expense" onBack={back} onExpired={onExpired} branchId={branchId} />;

  // ---- Trang hub ----
  return (
    <div className="sh-wrap">
      <style>{CSS}</style>
      <header className="sh-hd">
        <div className="sh-hd-user">
          <div className="sh-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sh-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            {empBranches.length > 1 ? (
              <select className="sh-branchsel" value={branchId} onChange={(e) => changeBranch(e.target.value)}
                aria-label="Chi nhánh thao tác">
                {empBranches.map((b) => (
                  <option key={b.id || b} value={b.id || b}>{b.name || b}</option>
                ))}
              </select>
            ) : (
              <div className="sh-sub">{branchName}</div>
            )}
          </div>
          <button className="sh-logout" onClick={logout}>Đăng xuất</button>
        </div>
        <div className="sh-title">👥 Cổng nhân viên</div>
      </header>

      {BTNS.map((g) => (
        <div className="sh-group" key={g.group}>
          <div className="sh-group-t">{g.group}</div>
          <div className="sh-grid">
            {g.items.map((b) => (
              <button key={b.key} className="sh-btn" onClick={() => openBtn(b)}>
                <span className="ic">{b.icon}</span>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
