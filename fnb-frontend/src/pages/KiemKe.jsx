import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api';
import SearchIcon from '../components/SearchIcon'; // Gói 55 p11x

// Trang nhân viên kiểm kê kho bằng điện thoại (public, KHÔNG cần đăng nhập admin)
// Token riêng: localStorage['kiemke_token'] / ['kiemke_emp']
// API (base /api, header Authorization: Bearer <token>):
// - POST /employee/phone-login {phone, pin_code}
// - GET  /employee/me
// - GET  /employee/stocktakes
// - POST /employee/stocktakes {type:'daily', note?}  -> {data:{id, items}, resumed?}
// - GET  /employee/stocktakes/{id}
// - PATCH /employee/stocktakes/{id}/counts {items:[{stocktake_item_id, counted_qty}]}
// - POST /employee/stocktakes/{id}/confirm {}

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.kk-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.kk-wrap button{font-family:inherit;}
.kk-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.kk-hd-user{display:flex;align-items:center;gap:10px;}
.kk-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.kk-name{font-size:15px;font-weight:700;line-height:1.25;}
.kk-sub{font-size:12px;opacity:.75;margin-top:1px;}
.kk-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.kk-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:40px;white-space:nowrap;}
.kk-logout:active{transform:scale(.95);}
.kk-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.kk-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.kk-bigbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:60px;border:none;border-radius:14px;background:${NAVY};color:#fff;font-size:17px;font-weight:800;}
.kk-bigbtn:active{transform:scale(.97);}
.kk-bigbtn:disabled{opacity:.45;}
.kk-green{background:#16a34a;}
.kk-orange{background:${ORANGE};}
.kk-outline{background:#fff;border:1.5px solid #e8e9ee;color:${NAVY};}
.kk-srow{display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid #e8e9ee;border-radius:10px;padding:11px 12px;margin-bottom:8px;min-height:48px;}
.kk-srow:last-child{margin-bottom:0;}
.kk-sn{font-weight:600;font-size:13.5px;line-height:1.4;}
.kk-sd{font-size:12px;color:#6b7280;margin-top:3px;}
.kk-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;}
.kk-b-draft{background:#fef3c7;color:#b45309;}
.kk-b-done{background:#dcfce7;color:#15803d;}
.kk-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
.kk-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;}
.kk-field:focus{outline:none;border-color:${ORANGE};}
.kk-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.kk-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.kk-login{padding:40px 24px;}
.kk-pin{font-size:30px;font-weight:800;letter-spacing:12px;text-align:center;}
.kk-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.kk-send:active{transform:scale(.97);}
.kk-send:disabled{opacity:.4;}
.kk-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:999px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;white-space:nowrap;max-width:92vw;}
.kk-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.kk-note{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.kk-searchbar{position:sticky;top:0;z-index:10;background:#f4f5f7;padding:12px 16px 8px;}
.kk-cat{margin:12px 16px 0;}
.kk-cat-t{font-size:13px;font-weight:800;color:${NAVY};margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;}
.kk-item{background:#fff;border-radius:12px;padding:12px;box-shadow:0 1px 3px rgba(16,24,40,.06);margin-bottom:8px;display:flex;align-items:center;gap:10px;}
.kk-item-n{flex:1;min-width:0;}
.kk-item-name{font-size:14px;font-weight:600;line-height:1.4;}
.kk-item-sub{font-size:12px;color:#9ca3af;margin-top:2px;}
.kk-qty{width:96px;flex-shrink:0;min-height:48px;border:1.5px solid #e8e9ee;border-radius:10px;padding:8px;font-size:16px;font-weight:700;text-align:right;font-family:inherit;}
.kk-qty:focus{outline:none;border-color:${ORANGE};}
.kk-qty.done{background:#f0fdf4;border-color:#86efac;}
.kk-foot{position:sticky;bottom:0;z-index:10;background:#f4f5f7;padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;gap:8px;}
.kk-foot button{flex:1;min-height:52px;border-radius:12px;font-size:15px;font-weight:800;border:none;color:#fff;}
.kk-foot button:active{transform:scale(.97);}
.kk-foot button:disabled{opacity:.45;}
.kk-modal-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:20px;}
.kk-modal{background:#fff;border-radius:16px;max-width:380px;width:100%;padding:20px;}
.kk-modal h3{font-size:16px;font-weight:800;color:${NAVY};margin-bottom:10px;}
.kk-modal p{font-size:14px;line-height:1.6;color:#374151;margin-bottom:14px;}
.kk-modal-btns{display:flex;gap:8px;}
.kk-modal-btns button{flex:1;min-height:48px;border-radius:12px;font-size:15px;font-weight:700;border:none;}
.kk-sum{background:#fff;border-radius:12px;margin:12px 16px 0;padding:16px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.kk-sum-row{display:flex;justify-content:space-between;font-size:14px;padding:7px 0;border-bottom:1px dashed #eee;}
.kk-sum-row:last-child{border-bottom:none;}
.kk-sum-row b{font-size:16px;color:${NAVY};}
`;

function auth(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}
// "2026-10-03 10:00:00" -> "03/10/2026 10:00"
function fmtDT(dt) {
  const m = String(dt || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : String(dt || '');
}
function parseQty(v) {
  const s = String(v || '').trim().replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function statusLabel(st) {
  return String(st || '').toLowerCase() === 'draft' ? 'Nháp' : 'Đã chốt';
}

export default function KiemKe() {
  const goHub = () => { let t = ''; try { t = new URLSearchParams(window.location.search).get('t') || localStorage.getItem('staff_hub_t') || ''; } catch (e) {} window.location.href = '/nhan-vien' + (t ? '?t=' + encodeURIComponent(t) : ''); };
  const [token, setToken] = useState(() => localStorage.getItem('kiemke_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kiemke_emp') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [screen, setScreen] = useState('home'); // home | count | done
  const [sheets, setSheets] = useState([]); // phiếu gần đây
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);

  const [sheetId, setSheetId] = useState(null);
  const [items, setItems] = useState([]); // [{id, material_id, material:{...}, system_qty, counted_qty}]
  const [counts, setCounts] = useState({}); // {stocktake_item_id: 'chuỗi số đếm'}
  const [search, setSearch] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [summary, setSummary] = useState(null); // {total, diff}
  // Gói 55 p11t: chọn chi nhánh + lọc loại NL
  const [branches, setBranches] = useState([]);
  const [selBranch, setSelBranch] = useState('');
  const [categories, setCategories] = useState([]);
  const [selCats, setSelCats] = useState(new Set());
  const [showNewSheet, setShowNewSheet] = useState(false);
  // Gói 55 p11w: thêm/xóa nguyên liệu trong phiếu
  const [allMaterials, setAllMaterials] = useState([]);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [addSearch, setAddSearch] = useState('');

  const toast = (m) => {
    setToastMsg(m); setToastOn(true);
    setTimeout(() => setToastOn(false), 2400);
  };

  const logout = () => {
    localStorage.removeItem('kiemke_token');
    localStorage.removeItem('kiemke_emp');
    setToken(''); setEmp(null); setPhone(''); setPin(''); setErr('');
    setSheets([]); setScreen('home');
    setSheetId(null); setItems([]); setCounts({}); setSearch('');
    setShowConfirm(false); setSummary(null); setToastOn(false);
  };

  const expired = (e) => {
    if (e && e.response && e.response.status === 401) {
      logout();
      toast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return true;
    }
    return false;
  };

  const doLogin = async (e) => {
    e.preventDefault();
    setErr('');
    let p = phone.trim().replace(/\s+/g, '');
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    if (!p) { setErr('Vui lòng nhập số điện thoại.'); return; }
    if (!/^\d{6}$/.test(pin)) { setErr('Vui lòng nhập đủ 6 số PIN.'); return; }
    setLoginBusy(true);
    try {
      const r = await axios.post(API + '/employee/phone-login', { phone: p, pin_code: pin });
      const tk = r.data.access_token;
      const info = r.data.employee || {};
      localStorage.setItem('kiemke_token', tk);
      localStorage.setItem('kiemke_emp', JSON.stringify(info));
      setToken(tk); setEmp(info); setPhone(''); setPin('');
    } catch (e) {
      setErr(errMsg(e, 'Đăng nhập thất bại. Kiểm tra lại SĐT và mã PIN.'));
    } finally { setLoginBusy(false); }
  };

  const loadSheets = async (tk) => {
    setLoading(true);
    try {
      const r = await axios.get(API + '/employee/stocktakes', auth(tk));
      setSheets((r.data && r.data.data) || []);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Không tải được danh sách phiếu.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token) {
      loadSheets(token);
      // Gói 55 p11t: nạp chi nhánh + loại NL
      axios.get(API + '/employee/stocktake-meta', auth(token)).then((r) => {
        const d = r.data?.data || {};
        setBranches(d.branches || []);
        setSelBranch(String(d.current_branch_id || ''));
        setCategories(d.categories || []);
      }).catch(() => {});
      // Gói 55 p11w: nạp tất cả nguyên liệu để thêm vào phiếu
      axios.get(API + '/employee/materials', auth(token)).then((r) => {
        if (r.data?.success) setAllMaterials(r.data.data || []);
      }).catch(() => {});
      // khôi phục thông tin NV nếu thiếu
      if (!emp) {
        axios.get(API + '/employee/me', auth(token))
          .then((r) => {
            const info = (r.data && (r.data.data || r.data.employee)) || null;
            if (info) {
              localStorage.setItem('kiemke_emp', JSON.stringify(info));
              setEmp(info);
            }
          })
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const openSheet = async (id, tk) => {
    setBusy(true);
    try {
      const r = await axios.get(API + '/employee/stocktakes/' + id, auth(tk));
      const d = (r.data && r.data.data) || {};
      const list = d.items || [];
      setSheetId(d.id);
      setItems(list);
      const c = {};
      list.forEach((it) => {
        if (it.counted_qty !== null && it.counted_qty !== undefined && it.counted_qty !== '') {
          c[String(it.id)] = String(it.counted_qty);
        }
      });
      setCounts(c);
      setSearch('');
      setScreen('count');
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Không mở được phiếu.'));
    } finally { setBusy(false); }
  };

  const startToday = async () => {
    setBusy(true);
    try {
      // Gói 55 p11t: gửi chi nhánh + loại NL đã chọn
      const r = await axios.post(API + '/employee/stocktakes', {
        type: 'daily',
        branch_id: selBranch ? Number(selBranch) : undefined,
        category_ids: selCats.size > 0 ? [...selCats] : undefined,
      }, auth(token));
      const d = (r.data && r.data.data) || {};
      toast(r.data && r.data.resumed ? 'Tiếp tục phiếu nháp hôm nay 📝' : 'Đã tạo phiếu kiểm kê mới 📋');
      await openSheet(d.id, token);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Không tạo được phiếu.'));
    } finally { setBusy(false); }
  };

  // Gói 55 p11w: xóa dòng khỏi phiếu
  const removeItem = async (itemId) => {
    // Gói 55 p11ac: chặn xóa dòng cuối — phiếu phải có ít nhất 1 nguyên liệu
    if (items.length <= 1) { alert('Phiếu phải có ít nhất 1 nguyên liệu. Muốn bỏ hết thì dùng nút "Hủy phiếu".'); return; }
    if (!window.confirm('Xóa nguyên liệu này khỏi phiếu?')) return;
    try {
      await axios.delete(API + '/employee/stocktakes/' + sheetId + '/items/' + itemId, auth(token));
      setItems(items.filter((it) => it.id !== itemId));
      const c = { ...counts };
      delete c[String(itemId)];
      setCounts(c);
      toast('Đã xóa khỏi phiếu.');
    } catch (e) { toast(errMsg(e, 'Xóa thất bại.')); }
  };

  // Gói 55 p11w: hủy phiếu nháp
  const cancelDraft = async () => {
    if (!window.confirm('Hủy phiếu kiểm kê này? Dữ liệu đã nhập sẽ mất.')) return;
    try {
      await axios.delete(API + '/employee/stocktakes/' + sheetId, auth(token));
      toast('Đã hủy phiếu.');
      setScreen('home'); setSheetId(null); setItems([]); setCounts({});
      loadSheets(token);
    } catch (e) { toast(errMsg(e, 'Hủy thất bại.')); }
  };

  // Gói 55 p11w: thêm nguyên liệu vào phiếu
  const addMaterials = async (materialIds) => {
    if (!materialIds.length) return;
    try {
      const r = await axios.post(API + '/employee/stocktakes/' + sheetId + '/items',
        { material_ids: materialIds }, auth(token));
      if (r.data?.success) {
        const d = r.data.data || {};
        setItems(d.items || items);
        setShowAddPicker(false); setAddSearch('');
        toast(r.data.message);
      }
    } catch (e) { toast(errMsg(e, 'Thêm thất bại.')); }
  };

  const saveDraft = async () => {
    const payload = [];
    items.forEach((it) => {
      const raw = counts[String(it.id)];
      const n = parseQty(raw);
      if (n !== null) payload.push({ stocktake_item_id: it.id, counted_qty: n });
    });
    if (!payload.length) { toast('Chưa nhập số liệu dòng nào.'); return; }
    setBusy(true);
    try {
      await axios.patch(API + '/employee/stocktakes/' + sheetId + '/counts', { items: payload }, auth(token));
      toast('Đã lưu nháp ✓ (' + payload.length + ' dòng)');
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Lưu nháp thất bại.'));
    } finally { setBusy(false); }
  };

  const doConfirm = async () => {
    setShowConfirm(false);
    setBusy(true);
    try {
      await axios.post(API + '/employee/stocktakes/' + sheetId + '/confirm', {}, auth(token));
      const total = items.length;
      let diff = 0;
      items.forEach((it) => {
        const n = parseQty(counts[String(it.id)]);
        if (n !== null && Math.abs(n - parseFloat(it.system_qty || 0)) > 0.000001) diff += 1;
      });
      setSummary({ total, diff });
      setScreen('done');
      loadSheets(token);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Chốt kiểm kê thất bại.'));
    } finally { setBusy(false); }
  };

  const goHome = () => {
    setScreen('home');
    setSheetId(null); setItems([]); setCounts({}); setSearch('');
    setSummary(null);
  };

  // nhóm theo loại nguyên liệu + lọc tìm kiếm
  // Gói 55 p11x: ô tìm kiếm giờ mở popup thêm NL, không lọc danh sách nữa
  const groups = useMemo(() => {
    const g = [];
    const idx = {};
    items.forEach((it) => {
      const catObj = (it.material || {}).category || {};
      const cat = catObj.name || 'Khác';
      const sort = catObj.sort_order ?? 999; // Gói 55 p11g: thứ tự từ admin
      if (!(cat in idx)) { idx[cat] = g.length; g.push({ name: cat, sort, items: [] }); }
      g[idx[cat]].items.push(it);
    });
    // Sắp xếp nhóm theo thứ tự admin cấu hình
    g.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    return g;
  }, [items, search]);

  const countedCount = useMemo(
    () => Object.keys(counts).filter((k) => parseQty(counts[k]) !== null).length,
    [counts]
  );

  if (!token) {
    return (
      <div className="kk-wrap">
        <style>{CSS}</style>
        <div className="kk-login">
          <div className="kk-hd" style={{ borderRadius: 18 }}>
            <button onClick={goHub} aria-label="Quay lại hub"
              style={{ background: 'rgba(255,255,255,.16)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 10, minHeight: 36, marginBottom: 8 }}>&#8249; Hub</button>
            <div className="kk-title">📦 Kiểm kê kho</div>
            <div className="kk-sub">Đăng nhập để tiếp tục</div>
          </div>
          <form className="kk-card" onSubmit={doLogin}>
            <label className="kk-label" style={{ marginTop: 4 }}>Số điện thoại</label>
            <input
              className="kk-field"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              placeholder="09xxxxxxxx"
              autoComplete="tel"
            />
            <label className="kk-label">Mã PIN 6 số</label>
            <input
              className="kk-field kk-pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              autoComplete="off"
            />
            {err && <div className="kk-msg" style={{ margin: '12px 0 0' }}>{err}</div>}
            <button className="kk-send" type="submit" disabled={loginBusy}>
              {loginBusy ? 'Đang xử lý...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const avatarLetter = ((emp && emp.full_name) || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="kk-wrap">
      <style>{CSS}</style>

      <header className="kk-hd">
        <div className="kk-hd-user">
          <div className="kk-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="kk-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="kk-sub">{(emp && emp.branch_name) || ''}</div>
          </div>
          <button className="kk-logout" onClick={goHub} aria-label="Quay lại hub">‹ Hub</button>
          <button className="kk-logout" onClick={logout} aria-label="Đăng xuất">Đăng xuất</button>
        </div>
        <div className="kk-title">📦 Kiểm kê kho</div>
      </header>

      {screen === 'home' && (
        <React.Fragment>
          <section className="kk-card">
            {/* Gói 55 p11t: chọn chi nhánh kiểm kê */}
            {branches.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Chi nhánh kiểm kê</div>
                <select value={selBranch} onChange={(e) => setSelBranch(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #ddd', borderRadius: 10 }}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            {/* Gói 55 p11t: tích chọn loại nguyên liệu */}
            {categories.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
                  Loại nguyên liệu {selCats.size > 0 ? `(${selCats.size} đã chọn)` : '(tất cả)'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {categories.map((c) => {
                    const on = selCats.has(c.id);
                    return (
                      <button key={c.id}
                        onClick={() => {
                          const next = new Set(selCats);
                          if (on) next.delete(c.id); else next.add(c.id);
                          setSelCats(next);
                        }}
                        style={{
                          padding: '8px 14px', fontSize: 13, borderRadius: 20, border: '1px solid',
                          borderColor: on ? '#24305E' : '#ddd',
                          background: on ? '#24305E' : '#fff',
                          color: on ? '#fff' : '#333',
                        }}>
                        {on ? '✓ ' : ''}{c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <button className="kk-bigbtn" onClick={startToday} disabled={busy}>
              {busy ? 'Đang xử lý...' : '📋 Kiểm kê hôm nay'}
            </button>
          </section>

          <section className="kk-card">
            <h3>Phiếu gần đây</h3>
            {loading ? (
              <div className="kk-empty">Đang tải...</div>
            ) : sheets.length === 0 ? (
              <div className="kk-empty">Chưa có phiếu kiểm kê nào.</div>
            ) : (
              sheets.map((s) => {
                const isDraft = String(s.status || '').toLowerCase() === 'draft';
                return (
                  <div
                    className="kk-srow"
                    key={s.id}
                    onClick={() => { if (isDraft && !busy) openSheet(s.id, token); }}
                    style={isDraft ? { cursor: 'pointer' } : undefined}
                  >
                    <div>
                      <div className="kk-sn">
                        {fmtDT(s.checked_at || s.created_at)}
                        {s.note ? ' · ' + s.note : ''}
                      </div>
                      <div className="kk-sd">
                        Đã đếm {s.counted_items ?? 0}/{s.total_items ?? 0} dòng
                        <span className={'kk-badge ' + (isDraft ? 'kk-b-draft' : 'kk-b-done')} style={{ marginLeft: 8 }}>
                          {statusLabel(s.status)}
                        </span>
                      </div>
                    </div>
                    {isDraft && <div style={{ fontSize: 20, color: NAVY }}>›</div>}
                  </div>
                );
              })
            )}
          </section>

          <div className="kk-note">
            📌 Chốt kiểm kê chỉ <b>ghi nhận chênh lệch</b>, không tự trừ kho. Quản lý sẽ đối chiếu sau.
          </div>
        </React.Fragment>
      )}

      {screen === 'count' && (
        <React.Fragment>
          {/* Gói 55 p11w: nút quay lại + hủy nháp */}
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
            <button onClick={() => { setScreen('home'); loadSheets(token); }}
              style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: 10, background: '#fff', fontSize: 14 }}>
              ‹ Quay lại
            </button>
            <button onClick={cancelDraft}
              style={{ flex: 1, padding: '10px', border: '1px solid #dc3545', borderRadius: 10, background: '#fff', color: '#dc3545', fontSize: 14 }}>
              Hủy phiếu
            </button>
          </div>
          {/* Gói 55 p11x: ô tìm kiếm mở popup thêm NL khi chạm — không còn nút riêng */}
          <div className="kk-searchbar">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#999', display: 'flex' }}>
                  <SearchIcon size={16} />
                </span>
                <input
                  className="kk-field"
                  style={{ marginTop: 0, width: '100%', paddingLeft: 36 }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={(e) => { e.target.blur(); setShowAddPicker(true); }}
                  placeholder="Tìm & thêm nguyên liệu..."
                  readOnly
                />
              </div>
            </div>
            <div className="kk-sd" style={{ marginTop: 6 }}>
              Đã nhập {countedCount}/{items.length} dòng
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="kk-card"><div className="kk-empty">Không tìm thấy nguyên liệu nào.</div></div>
          ) : (
            groups.map((g) => (
              <div className="kk-cat" key={g.name}>
                <div className="kk-cat-t">{g.name} ({g.items.length})</div>
                {g.items.map((it) => {
                  const key = String(it.id);
                  const val = counts[key] || '';
                  const entered = parseQty(val) !== null;
                  return (
                    <div className="kk-item" key={it.id}>
                      <div className="kk-item-n">
                        <div className="kk-item-name">{(it.material || {}).name}</div>
                        {/* Gói 56: blind count — trang này chỉ dành cho NV (đăng nhập PIN),
                            luôn ẩn tồn hệ thống để NV đếm khách quan. Admin xem tồn ở trang kho. */}
                      </div>
                      <input
                        className={'kk-qty' + (entered ? ' done' : '')}
                        type="text"
                        inputMode="decimal"
                        value={val}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.,]/g, '');
                          setCounts((c) => ({ ...c, [key]: v }));
                        }}
                        placeholder="0"
                        aria-label={'Số đếm ' + ((it.material || {}).name || '')}
                      />
                      {/* Gói 55 p11w: nút xóa dòng */}
                      <button onClick={() => removeItem(it.id)}
                        style={{ marginLeft: 8, color: '#dc3545', fontSize: 20, background: 'none', border: 'none', cursor: 'pointer' }}
                        title="Xóa khỏi phiếu">×</button>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          <div className="kk-foot">
            <button className="kk-orange" onClick={saveDraft} disabled={busy}>💾 Lưu nháp</button>
            <button className="kk-green" onClick={() => setShowConfirm(true)} disabled={busy || countedCount !== items.length}>
              ✓ Chốt kiểm kê{countedCount !== items.length ? ` (${countedCount}/${items.length})` : ''}
            </button>
          </div>

          {/* Gói 55 p11w: popup thêm nguyên liệu */}
          {showAddPicker && (
            <AddMaterialPicker
              allMaterials={allMaterials}
              existingIds={items.map((it) => it.material_id)}
              categories={categories}
              onClose={() => { setShowAddPicker(false); setAddSearch(''); }}
              onAdd={addMaterials}
              search={addSearch}
              setSearch={setAddSearch}
            />
          )}

          {showConfirm && (
            <div className="kk-modal-ov" onClick={() => setShowConfirm(false)}>
              <div className="kk-modal" onClick={(e) => e.stopPropagation()}>
                <h3>✋ Chốt kiểm kê?</h3>
                <p>
                  Đã nhập <b>{countedCount}/{items.length}</b> dòng.<br />
                  Sau khi chốt, phiếu sẽ chuyển sang trạng thái <b>đã chốt</b> và không sửa được nữa.
                  Chênh lệch chỉ được <b>ghi nhận</b>, không tự trừ kho.
                </p>
                <div className="kk-modal-btns">
                  <button className="kk-outline" onClick={() => setShowConfirm(false)}>← Quay lại</button>
                  <button className="kk-green" onClick={doConfirm} disabled={busy}>
                    {busy ? 'Đang chốt...' : 'Xác nhận chốt'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </React.Fragment>
      )}

      {screen === 'done' && summary && (
        <React.Fragment>
          <section className="kk-sum">
            <h3 style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginBottom: 8 }}>✓ Đã chốt kiểm kê</h3>
            <div className="kk-sum-row"><span>Tổng số dòng</span><b>{summary.total}</b></div>
            <div className="kk-sum-row"><span>Số dòng chênh lệch</span><b>{summary.diff}</b></div>
            <button className="kk-bigbtn" style={{ marginTop: 14 }} onClick={goHome}>← Về trang chính</button>
          </section>
        </React.Fragment>
      )}

      <div className={'kk-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}

// Gói 55 p11w: popup chọn nguyên liệu để thêm vào phiếu
function AddMaterialPicker({ allMaterials, existingIds, categories, onClose, onAdd, search, setSearch }) {
  const [picked, setPicked] = useState(new Set());

  const groups = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const available = (allMaterials || []).filter((m) =>
      !existingIds.includes(m.id) &&
      m.is_active !== false &&
      (!q || m.name.toLowerCase().includes(q))
    );
    const sorted = (categories || []).slice()
      .sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.id - b.id));
    const result = [];
    const byCat = {};
    const uncat = [];
    available.forEach((m) => {
      const cid = m.material_category_id;
      if (!cid) { uncat.push(m); return; }
      if (!byCat[cid]) byCat[cid] = [];
      byCat[cid].push(m);
    });
    sorted.forEach((c) => {
      if (byCat[c.id]?.length) result.push({ name: c.name, items: byCat[c.id] });
    });
    if (uncat.length) result.push({ name: 'Chưa phân loại', items: uncat });
    return result;
  }, [allMaterials, existingIds, categories, search]);

  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  return (
    <div className="kk-modal-ov" onClick={onClose}>
      <div className="kk-modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <h3>Thêm nguyên liệu</h3>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#999', display: 'flex' }}>
            <SearchIcon size={16} />
          </span>
          <input
            className="kk-field"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm nguyên liệu chưa có trong phiếu..."
            autoFocus
            style={{ paddingLeft: 36 }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {groups.length === 0 && <div className="kk-empty">Không có nguyên liệu nào để thêm.</div>}
          {groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#666', textTransform: 'uppercase', marginBottom: 6 }}>
                {g.name} ({g.items.length})
              </div>
              {g.items.map((m) => (
                <button key={m.id} onClick={() => toggle(m.id)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid',
                    borderColor: picked.has(m.id) ? '#24305E' : '#eee',
                    background: picked.has(m.id) ? '#eef2ff' : '#fff',
                    fontSize: 14, textAlign: 'left',
                  }}>
                  <span>{m.name} <span style={{ color: '#999', fontSize: 12 }}>({m.unit})</span></span>
                  {picked.has(m.id) && <span style={{ color: '#24305E', fontWeight: 800 }}>✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="kk-modal-btns">
          <button className="kk-outline" onClick={onClose}>Hủy</button>
          <button className="kk-green" onClick={() => onAdd([...picked])} disabled={picked.size === 0}>
            Thêm ({picked.size})
          </button>
        </div>
      </div>
    </div>
  );
}
