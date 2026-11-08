import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api';
import DateInput from '../components/DateInput';
import NhapKho from './NhapKho';
import XuatKho from './XuatKho';
import ChuyenKho from './ChuyenKho';
import { ApprovalCluster, ApprovalsFlow } from './hub/Approvals'; // Gói "Chờ duyệt trên Hub" (2026-10-21)
import { saveStaffSession, clearStaffSession } from '../utils/staffSession'; // Gói phiên Hub (2026-11-05)

// Gói 59: Hub nhân viên (/nhan-vien) — cổng chung cho NV.
// - Gói phiên Hub (2026-11-05, phán Đại Vương): đăng nhập SĐT+PIN 1 lần
//   duy nhất, chọn CN ngay lúc đăng nhập (staff_token/staff_emp/
//   staff_branch_id); mọi trang con đọc chung phiên này. Cổng QR Hub
//   (?t=/staff_hub_token) ĐÃ GỠ — đổi CN = đăng xuất rồi đăng nhập lại.
// - 4 cụm nút: Kho / Chế biến / Thu chi / Cá nhân
// - Nhập/Xuất/Chuyển kho: nhúng form có sẵn (embed prop)
// - Phiếu thu/chi: form rút gọn ngay trong hub → POST /api/employee/transactions (chờ duyệt)

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.sh-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.sh-wrap button{font-family:inherit;}
.sh-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 12px 12px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.sh-hd-user{display:flex;align-items:center;gap:10px;}
.sh-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.sh-name{font-size:15px;font-weight:700;line-height:1.25;}
.sh-sub{font-size:12px;opacity:.75;margin-top:1px;}
.sh-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.sh-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:44px;white-space:nowrap;}
.sh-logout:active{transform:scale(.95);}
.sh-branchsel{margin-top:4px;max-width:100%;background:#fff;border:none;color:${NAVY};font-size:13px;font-weight:700;padding:8px 28px 8px 12px;border-radius:10px;min-height:44px;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2324305E' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;cursor:pointer;}
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
.sh-back{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:13px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:44px;}
.sh-back:active{transform:scale(.95);}
.sh-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.sh-ok{margin:12px 16px 0;padding:14px;border-radius:12px;font-size:14px;background:#f0fdf4;border:1px solid #86efac;color:#15803d;line-height:1.6;}
.sh-2col{display:flex;gap:10px;}
.sh-2col>div{flex:1;min-width:0;}
.sh-submit{background:${ORANGE};color:#fff;width:100%;min-height:54px;border:none;border-radius:12px;font-size:16px;font-weight:800;margin-top:14px;}
.sh-submit:active{transform:scale(.97);}
.sh-submit:disabled{opacity:.45;}
`;

function auth(token) { // Gói phiên Hub 2026-11-05: bỏ tham số cổng ?t= — phiên Bearer là đủ
  return { headers: { Authorization: 'Bearer ' + token } };
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
function TxnForm({ token, emp, kind, onBack, onExpired, branchId, branchName }) {
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

  const [catErr, setCatErr] = useState(false); // UX 2026-10-26 (🟠T1 Hub)
  const loadCats = async () => {
    try {
      const r = await axios.get(API + '/transaction-categories', auth(token));
      const list = r.data && r.data.data ? r.data.data : [];
      setCats(list.filter((c) => c.type === (isIncome ? 'income' : 'expense')));
      setCatErr(false);
    } catch (e) {
      // S5: 401 = hết phiên → về đăng nhập kèm câu chuẩn, không hiện "Không tải được danh mục…"
      if (e && e.response && e.response.status === 401) { onExpired(); return; }
      setCatErr(true);
    }
  };

  useEffect(() => {
    (async () => {
      await loadCats();
      try {
        const r2 = await axios.get(API + '/accounts', auth(token));
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
      }, auth(token));
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
        <div className="sh-sub">{(emp && emp.full_name) || ''} · {branchName || (emp && emp.branch_name) || ''}</div>
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
          {catErr && (
            <div style={{ color: '#b42318', fontSize: 13, marginBottom: 8 }}>
              ⚠ Không tải được danh mục thu/chi. <button onClick={loadCats} style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', fontWeight: 700 }}>Thử lại</button>
            </div>
          )}
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
  const [token, setToken] = useState(() => localStorage.getItem('staff_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('staff_emp') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  // Gói #102: yếu tố mật khẩu ở cổng đăng nhập Hub + luồng ép đổi bằng vé
  const [password, setPassword] = useState('');
  const [changeFlow, setChangeFlow] = useState(null); // { ticket, info } khi server trả must_change_password
  const [changePw, setChangePw] = useState('');
  const [changePw2, setChangePw2] = useState('');
  const [changeBranch, setChangeBranch] = useState(0);
  // Gói #102 mục 5.2: thẻ tự đặt mật khẩu trong phiên (NV chưa có mật khẩu)
  const [setupPin, setSetupPin] = useState('');
  const [setupPw, setSetupPw] = useState('');
  const [setupPw2, setSetupPw2] = useState('');
  const [setupErr, setSetupErr] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [screen, setScreen] = useState('hub'); // hub | nhap | xuat | chuyen | thu | chi | choduyet
  const [approvalType, setApprovalType] = useState('inbound'); // loại phiếu mở từ cụm Chờ duyệt

  // Gói phiên Hub (2026-11-05): đăng nhập 2 pha trong cùng 1 luồng —
  // pha 1 SĐT+PIN lấy phiên + danh sách CN được phân công; NV nhiều CN thì
  // chọn CN ngay tại đây (server kiểm lại phân công qua branch_id), 1 CN
  // thì tự khóa luôn. CN là một phần của phiên: đổi CN = đăng xuất.
  const [pendingLogin, setPendingLogin] = useState(null); // { tk, info } chờ chọn CN
  const finishLogin = (tk, info, bid) => {
    saveStaffSession(tk, info, bid);
    setToken(tk); setEmp(info); setBranchId(bid || 0);
    setPendingLogin(null); setPhone(''); setPin(''); setPassword('');
    setChangeFlow(null); setChangePw(''); setChangePw2(''); setChangeBranch(0);
  };
  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    if (!p) { setErr('Vui lòng nhập số điện thoại.'); return; }
    if (!/^\d{6}$/.test(pin)) { setErr('Vui lòng nhập đủ 6 số PIN.'); return; }
    if (!password) { setErr('Vui lòng nhập mật khẩu.'); return; } // Gói #102
    setLoginBusy(true);
    try {
      const r = await axios.post(API + '/employee/phone-login', { phone: p, pin_code: pin, password, surface: 'hub' }); // S5: phiên riêng của Hub · #102: thêm mật khẩu
      // Gói #102 mục 2.3: đang giữ mật khẩu tạm → server không cấp phiên mà
      // trả vé đổi mật khẩu; sang màn ép đổi (chọn CN tại đó — Q4).
      if (r.data && r.data.must_change_password && r.data.change_ticket) {
        setChangeFlow({ ticket: r.data.change_ticket, info: r.data.employee || {} });
        return;
      }
      const tk = r.data.access_token;
      const info = r.data.employee || {};
      const list = info.branches || [];
      if (list.length > 1) { setPendingLogin({ tk, info }); return; }
      finishLogin(tk, info, (list[0] && (list[0].id || list[0])) || info.branch_id || 0);
    } catch (e2) {
      // Gói #102 (Q6): 403 code password_setup_required → message của server
      // đã là câu hướng dẫn đầy đủ, errMsg lấy nguyên message đó.
      setErr(errMsg(e2, 'Đăng nhập thất bại. Kiểm tra lại SĐT, mã PIN và mật khẩu.'));
    } finally { setLoginBusy(false); }
  };
  const pickBranch = async (bid) => {
    if (!pendingLogin) return;
    setErr('');
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    setLoginBusy(true);
    try {
      // Gọi lại phone-login kèm branch_id: server kiểm CN thuộc phân công
      // (422 nếu không) và cấp token mới của chính phiên này.
      const r = await axios.post(API + '/employee/phone-login', { phone: p, pin_code: pin, password, surface: 'hub', branch_id: bid });
      finishLogin(r.data.access_token, r.data.employee || pendingLogin.info, r.data.session_branch_id || bid);
    } catch (e2) {
      setErr(errMsg(e2, 'Không chọn được chi nhánh.'));
    } finally { setLoginBusy(false); }
  };
  // Gói #102 mục 2.3: nộp màn ép đổi — đặt mật khẩu mới bằng vé, nhận phiên.
  const submitChange = async (e) => {
    e.preventDefault();
    if (!changeFlow) return;
    setErr('');
    if (changePw.length < 8 || changePw.length > 72) { setErr('Mật khẩu mới phải từ 8 đến 72 ký tự.'); return; }
    if (changePw !== changePw2) { setErr('Mật khẩu nhập lại không khớp.'); return; }
    const list = (changeFlow.info && changeFlow.info.branches) || [];
    const bid = changeBranch || (list.length === 1 ? (list[0].id || list[0]) : 0) || changeFlow.info.branch_id || 0;
    if (list.length > 1 && !bid) { setErr('Vui lòng chọn chi nhánh làm việc.'); return; }
    setLoginBusy(true);
    try {
      const r = await axios.post(API + '/employee/password/change-with-ticket', { ticket: changeFlow.ticket, new_password: changePw, branch_id: bid || undefined });
      finishLogin(r.data.access_token, r.data.employee || changeFlow.info, r.data.session_branch_id || bid || 0);
    } catch (e2) {
      setErr(errMsg(e2, 'Đổi mật khẩu thất bại. Vui lòng đăng nhập lại.'));
    } finally { setLoginBusy(false); }
  };
  // Gói #102 mục 5.2: tự đặt mật khẩu trong phiên đang sống (PIN step-up).
  const submitSetup = async () => {
    setSetupErr('');
    if (!/^\d{6}$/.test(setupPin)) { setSetupErr('Vui lòng nhập đủ 6 số PIN.'); return; }
    if (setupPw.length < 8 || setupPw.length > 72) { setSetupErr('Mật khẩu phải từ 8 đến 72 ký tự.'); return; }
    if (setupPw !== setupPw2) { setSetupErr('Mật khẩu nhập lại không khớp.'); return; }
    setSetupBusy(true);
    try {
      await axios.post(API + '/employee/password/setup', { pin_code: setupPin, new_password: setupPw, new_password_confirmation: setupPw2 }, auth(token));
      const merged = { ...(emp || {}), has_password: true };
      setEmp(merged);
      try { localStorage.setItem('staff_emp', JSON.stringify(merged)); } catch (e) { /* ignore */ }
      setSetupDone(true); setSetupPin(''); setSetupPw(''); setSetupPw2('');
    } catch (e2) {
      if (e2 && e2.response && e2.response.status === 401 && !e2.response.data?.message?.includes('PIN')) { onExpired(); return; }
      setSetupErr(errMsg(e2, 'Thiết lập mật khẩu thất bại.'));
    } finally { setSetupBusy(false); }
  };

  const logout = () => { // Gói phiên Hub 2026-11-05: đăng xuất là lối duy nhất đổi CN
    clearStaffSession();
    setToken(''); setEmp(null); setScreen('hub'); setBranchId(0); setPendingLogin(null);
    setPassword(''); setChangeFlow(null); // Gói #102
  };
  // S5: hết phiên → về màn hình đăng nhập KÈM câu chuẩn (mẫu trang chấm công chi nhánh),
  // thay vì đăng xuất câm khiến NV tưởng lỗi tải. doLogin xóa err khi đăng nhập lại.
  const onExpired = () => { logout(); setErr('Phiên đăng nhập đã hết hạn. Vui lòng nhập PIN để đăng nhập lại.'); };
  const back = () => setScreen('hub');
  // Gói phiên Hub (2026-11-05): CN của phiên — khóa lúc đăng nhập, chỉ hiển
  // thị, KHÔNG đổi tại Hub (đổi CN = đăng xuất rồi đăng nhập lại).
  const empBranches = (emp && emp.branches) || [];
  const [branchId, setBranchId] = useState(() => parseInt(localStorage.getItem('staff_branch_id') || '0', 10) || 0);
  // Đồng bộ branchId khi emp thay đổi (đăng nhập mới / tải lại trang)
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
  const branchName = (() => {
    const b = empBranches.find((x) => (x.id || x) === branchId);
    return (b && b.name) || (emp && emp.branch_name) || '';
  })();
  // Gói #102 (Q7): phiên tạo TRƯỚC gói này chưa có has_password trong
  // staff_emp — tải lại /employee/me một lần khi mở Hub để biết có phải
  // hiện thẻ "Thiết lập mật khẩu" cho NV chưa có mật khẩu hay không.
  useEffect(() => {
    if (!token || !emp) return;
    let cancelled = false;
    axios.get(API + '/employee/me', auth(token)).then((r) => {
      const d = r.data && r.data.data;
      if (cancelled || !d || typeof d.has_password !== 'boolean') return;
      if (emp.has_password === d.has_password) return;
      const merged = { ...emp, has_password: d.has_password, must_change_password: !!d.must_change_password };
      setEmp(merged);
      try { localStorage.setItem('staff_emp', JSON.stringify(merged)); } catch (e) { /* ignore */ }
    }).catch(() => { /* im lặng — không phá phiên đang sống */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const embed = { token, emp, onBack: back, onExpired, branchId };

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

  const openBtn = (b) => { // Gói phiên Hub 2026-11-05: điều hướng không còn gắn ?t=
    if (b.href) { window.location.href = b.href; return; }
    setScreen(b.key);
  };

  // ---- Màn hình chọn chi nhánh (pha 2 của đăng nhập) ----
  if (!token && pendingLogin) {
    const list = pendingLogin.info.branches || [];
    return (
      <div className="sh-wrap">
        <style>{CSS}</style>
        <div className="sh-login">
          <div className="sh-hd" style={{ borderRadius: 12 }}>
            <div className="sh-title">🏬 Chọn chi nhánh làm việc</div>
            <div className="sh-sub">{pendingLogin.info.full_name || ''} — chọn 1 lần cho cả phiên, muốn đổi chi nhánh thì đăng xuất rồi đăng nhập lại</div>
          </div>
          <div className="sh-card">
            {list.map((b) => (
              <button key={b.id || b} className="sh-send" style={{ marginTop: 10 }} disabled={loginBusy}
                onClick={() => pickBranch(b.id || b)}>
                {b.name || b}
              </button>
            ))}
            {err && <div className="sh-msg">{err}</div>}
            <button className="sh-send" style={{ background: '#e5e7eb', color: '#24305E' }} disabled={loginBusy}
              onClick={() => { setPendingLogin(null); setPin(''); setErr(''); }}>
              ‹ Quay lại đăng nhập
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Màn hình ép đổi mật khẩu (gói #102 mục 2.3: đang giữ mật khẩu tạm) ----
  if (!token && changeFlow) {
    const list = (changeFlow.info && changeFlow.info.branches) || [];
    return (
      <div className="sh-wrap">
        <style>{CSS}</style>
        <div className="sh-login">
          <div className="sh-hd" style={{ borderRadius: 12 }}>
            <div className="sh-title">🔐 Đặt mật khẩu của riêng bạn</div>
            <div className="sh-sub">{changeFlow.info.full_name || ''} — bạn đang dùng mật khẩu tạm do quản lý cấp, hãy đặt mật khẩu mới để tiếp tục (vé đổi chỉ sống 10 phút)</div>
          </div>
          <form className="sh-card" onSubmit={submitChange}>
            <label className="sh-label" style={{ marginTop: 4 }}>Mật khẩu mới (8–72 ký tự)</label>
            <input className="sh-field" type="password" placeholder="Mật khẩu mới"
              value={changePw} onChange={(e) => setChangePw(e.target.value)} />
            <label className="sh-label">Nhập lại mật khẩu mới</label>
            <input className="sh-field" type="password" placeholder="Nhập lại mật khẩu mới"
              value={changePw2} onChange={(e) => setChangePw2(e.target.value)} />
            {list.length > 1 && (
              <>
                <label className="sh-label">Chi nhánh làm việc phiên này</label>
                {list.map((b) => {
                  const bid = b.id || b;
                  const active = changeBranch === bid;
                  return (
                    <button type="button" key={bid} className="sh-send" disabled={loginBusy}
                      style={active ? { marginTop: 10, background: ORANGE, color: NAVY } : { marginTop: 10 }}
                      onClick={() => setChangeBranch(bid)}>
                      {b.name || b}{active ? ' ✓' : ''}
                    </button>
                  );
                })}
              </>
            )}
            {err && <div className="sh-msg">{err}</div>}
            <button className="sh-send" disabled={loginBusy}>{loginBusy ? 'Đang đặt mật khẩu...' : 'Đặt mật khẩu & vào Hub'}</button>
            <button type="button" className="sh-send" style={{ background: '#e5e7eb', color: '#24305E' }} disabled={loginBusy}
              onClick={() => { setChangeFlow(null); setChangePw(''); setChangePw2(''); setErr(''); }}>
              ‹ Quay lại đăng nhập
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Màn hình đăng nhập ----
  if (!token) {
    return (
      <div className="sh-wrap">
        <style>{CSS}</style>
        <div className="sh-login">
          <div className="sh-hd" style={{ borderRadius: 12 }}>
            <div className="sh-title">👥 Cổng nhân viên</div>
            <div className="sh-sub">Nhập SĐT + PIN + mật khẩu để làm việc</div>
          </div>
          <form className="sh-card" onSubmit={doLogin}>
            <label className="sh-label" style={{ marginTop: 4 }}>Số điện thoại</label>
            <input className="sh-field" inputMode="tel" placeholder="VD: 0901234567"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
            <label className="sh-label">Mã PIN (6 số)</label>
            <input className="sh-field" type="password" inputMode="numeric" maxLength={6}
              placeholder="••••••" style={{ letterSpacing: 8, textAlign: 'center', fontSize: 22, fontWeight: 800 }}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <label className="sh-label">Mật khẩu</label>
            <input className="sh-field" type="password" placeholder="Mật khẩu đăng nhập"
              value={password} onChange={(e) => setPassword(e.target.value)} />
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
  if (screen === 'thu') return <TxnForm token={token} emp={emp} kind="income" onBack={back} onExpired={onExpired} branchId={branchId} branchName={branchName} />;
  if (screen === 'chi') return <TxnForm token={token} emp={emp} kind="expense" onBack={back} onExpired={onExpired} branchId={branchId} branchName={branchName} />;
  // Gói "Chờ duyệt trên Hub" (2026-10-21): luồng duyệt phiếu chờ
  if (screen === 'choduyet') return <ApprovalsFlow token={token} emp={emp} branchId={branchId} branchName={branchName} initialType={approvalType} onBack={back} onExpired={onExpired} />;

  // ---- Trang hub ----
  return (
    <div className="sh-wrap">
      <style>{CSS}</style>
      <header className="sh-hd">
        <div className="sh-hd-user">
          <div className="sh-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sh-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="sh-sub">🏬 {branchName}{empBranches.length > 1 ? ' · đổi CN: đăng xuất rồi đăng nhập lại' : ''}</div>
          </div>
          <button className="sh-logout" onClick={logout}>Đăng xuất</button>
        </div>
        <div className="sh-title">👥 Cổng nhân viên</div>
      </header>

      {/* Gói "Chờ duyệt trên Hub" (2026-10-21): cụm Chờ duyệt ngay dưới header, trên 4 cụm cũ */}
      <ApprovalCluster token={token} branchId={branchId} onExpired={onExpired}
        onOpen={(t) => { setApprovalType(t); setScreen('choduyet'); }} />

      {/* Gói #102 mục 5.2: thẻ tự đặt mật khẩu cho NV chưa có mật khẩu (van chuyển đổi trong phiên đang sống) */}
      {emp && emp.has_password === false && (
        <div className="sh-card">
          <h3>🔐 Thiết lập mật khẩu đăng nhập</h3>
          {setupDone ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#15803d' }}>
              ✅ Đã thiết lập mật khẩu. Từ lần đăng nhập sau, đăng nhập Hub bằng <b>SĐT + PIN + mật khẩu</b> này.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.55 }}>
                Tài khoản của bạn chưa có mật khẩu. Từ nay đăng nhập Hub cần thêm mật khẩu — hãy đặt ngay trong phiên này, nhập PIN để xác nhận chính chủ.
              </div>
              <label className="sh-label">Mã PIN (6 số)</label>
              <input className="sh-field" type="password" inputMode="numeric" maxLength={6}
                placeholder="••••••" style={{ letterSpacing: 8, textAlign: 'center', fontSize: 20, fontWeight: 800 }}
                value={setupPin} onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              <label className="sh-label">Mật khẩu mới (8–72 ký tự)</label>
              <input className="sh-field" type="password" placeholder="Mật khẩu mới"
                value={setupPw} onChange={(e) => setSetupPw(e.target.value)} />
              <label className="sh-label">Nhập lại mật khẩu mới</label>
              <input className="sh-field" type="password" placeholder="Nhập lại mật khẩu mới"
                value={setupPw2} onChange={(e) => setSetupPw2(e.target.value)} />
              {setupErr && <div className="sh-msg" style={{ margin: '12px 0 0' }}>{setupErr}</div>}
              <button className="sh-send" disabled={setupBusy} onClick={submitSetup}>{setupBusy ? 'Đang thiết lập...' : 'Thiết lập mật khẩu'}</button>
            </>
          )}
        </div>
      )}

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
