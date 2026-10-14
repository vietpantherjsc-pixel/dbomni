import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API } from '../utils/api'; // base API tương đối — chạy được trên điện thoại (IP LAN)
import DateInput from '../components/DateInput'; // ô ngày dd/mm/yyyy

// Trang nhân viên nhập hàng bằng điện thoại (public, KHÔNG cần đăng nhập admin)
// Token riêng: localStorage['nhapkho_token'] / ['nhapkho_emp']
// API: POST /employee/phone-login, GET /employee/me,
//      GET /employee/suppliers, GET /employee/materials,
//      POST /employee/inbound-receipts

const NAVY = '#24305E';
const ORANGE = '#F5A623';

const CSS = `
.nk-wrap{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;min-height:100vh;background:#f4f5f7;color:#1a1d26;padding-bottom:calc(24px + env(safe-area-inset-bottom));}
.nk-wrap button{font-family:inherit;}
.nk-hd{background:${NAVY};color:#fff;padding:14px 16px;position:sticky;top:0;z-index:20;border-radius:0 0 18px 18px;box-shadow:0 2px 12px rgba(36,48,94,.25);}
.nk-hd-user{display:flex;align-items:center;gap:10px;}
.nk-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;background:${ORANGE};color:${NAVY};font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;}
.nk-name{font-size:15px;font-weight:700;line-height:1.25;}
.nk-sub{font-size:12px;opacity:.75;margin-top:1px;}
.nk-title{font-size:20px;font-weight:800;margin-top:12px;letter-spacing:-.2px;}
.nk-logout{background:rgba(255,255,255,.16);border:none;color:#fff;font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:10px;min-height:40px;white-space:nowrap;}
.nk-logout:active{transform:scale(.95);}
.nk-card{background:#fff;border-radius:12px;margin:12px 16px 0;padding:14px;box-shadow:0 1px 3px rgba(16,24,40,.06);}
.nk-card h3{font-size:15px;font-weight:700;color:${NAVY};margin-bottom:10px;}
.nk-label{font-size:13px;font-weight:700;color:#6b7280;margin-top:12px;display:block;}
.nk-field{width:100%;min-height:50px;border:1.5px solid #e8e9ee;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fbfbfc;margin-top:6px;box-sizing:border-box;}
.nk-field:focus{outline:none;border-color:${ORANGE};}
.nk-2col{display:flex;gap:10px;}
.nk-2col>div{flex:1;min-width:0;}
.nk-3col{display:flex;gap:8px;}
.nk-seg{flex:1;min-height:48px;border:1.5px solid #e8e9ee;background:#fbfbfc;border-radius:12px;font-size:14px;font-weight:700;color:#6b7280;}
.nk-seg.on{background:${NAVY};border-color:${NAVY};color:#fff;}
.nk-seg:active{transform:scale(.96);}
.nk-pay{flex:1;min-height:52px;border:1.5px solid #e8e9ee;background:#fbfbfc;border-radius:12px;font-size:14.5px;font-weight:800;color:#6b7280;}
.nk-pay.on{background:${ORANGE};border-color:${ORANGE};color:#fff;}
.nk-pay:active{transform:scale(.96);}
.nk-check{display:flex;align-items:center;gap:10px;min-height:48px;font-size:14.5px;font-weight:600;}
.nk-check input{width:22px;height:22px;accent-color:${NAVY};}
.nk-addbtn{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:12px;}
.nk-addbtn:active{transform:scale(.97);}
.nk-addbtn:disabled{opacity:.4;}
.nk-submit{background:${ORANGE};color:#fff;width:100%;min-height:54px;border:none;border-radius:12px;font-size:16px;font-weight:800;margin-top:14px;}
.nk-submit:active{transform:scale(.97);}
.nk-submit:disabled{opacity:.45;}
.nk-item{border:1px solid #e8e9ee;border-radius:10px;padding:10px 12px;margin-bottom:8px;}
.nk-item:last-child{margin-bottom:0;}
.nk-iname{font-weight:700;font-size:14px;line-height:1.4;padding-right:8px;}
.nk-idetail{font-size:12.5px;color:#6b7280;margin-top:4px;line-height:1.5;}
.nk-itotal{font-weight:800;color:${NAVY};font-size:14.5px;white-space:nowrap;}
.nk-del{border:none;background:#fdeeee;color:#a12b2b;font-weight:800;font-size:13px;min-width:44px;min-height:44px;border-radius:10px;padding:0 10px;}
.nk-del:active{transform:scale(.94);}
.nk-trow{display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:5px 0;color:#374151;}
.nk-trow.grand{font-size:17px;font-weight:800;color:${NAVY};border-top:2px solid ${NAVY};margin-top:6px;padding-top:10px;}
.nk-trow .neg{color:#a12b2b;}
.nk-empty{text-align:center;color:#6b7280;font-size:13.5px;padding:18px 8px;line-height:1.6;}
.nk-msg{margin:12px 16px 0;padding:11px 14px;border-radius:12px;font-size:14px;font-weight:600;background:#fdeeee;border:1px solid #f5c9c9;color:#a12b2b;}
.nk-warn{margin-top:8px;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.5;background:#fffbeb;border:1px solid #f5dfae;color:#8a5a00;}
.nk-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%) translateY(10px);background:rgba(26,29,38,.92);color:#fff;font-size:13.5px;font-weight:600;padding:11px 18px;border-radius:999px;z-index:60;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;white-space:nowrap;max-width:92vw;}
.nk-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
.nk-login{padding:40px 24px;}
.nk-pin{font-size:30px;font-weight:800;letter-spacing:12px;text-align:center;}
.nk-send{background:${NAVY};color:#fff;width:100%;min-height:50px;border:none;border-radius:12px;font-size:15px;font-weight:700;margin-top:16px;}
.nk-send:active{transform:scale(.97);}
.nk-send:disabled{opacity:.4;}
.nk-search{position:relative;}
.nk-drop{position:absolute;left:0;right:0;top:100%;background:#fff;border:1.5px solid #e8e9ee;border-top:none;border-radius:0 0 12px 12px;z-index:30;max-height:240px;overflow-y:auto;box-shadow:0 8px 20px rgba(16,24,40,.12);}
.nk-opt{padding:12px;font-size:14px;font-weight:600;border-bottom:1px solid #f1f2f6;min-height:48px;display:flex;align-items:center;}
.nk-opt:last-child{border-bottom:none;}
.nk-opt:active{background:#f6f7fb;}
.nk-opt small{color:#6b7280;font-weight:500;margin-left:6px;}
.nk-pick{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:12px;padding:10px 12px;margin-top:8px;font-size:14px;font-weight:700;color:${NAVY};}
.nk-pick button{border:none;background:none;color:#6b7280;font-size:16px;font-weight:700;min-width:44px;min-height:44px;}
.nk-success{text-align:center;padding:48px 24px;}
.nk-check-big{width:84px;height:84px;border-radius:50%;background:#dcfce7;color:#15803d;font-size:44px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;}
.nk-code{font-size:22px;font-weight:800;color:${NAVY};letter-spacing:1px;margin-top:8px;}
.nk-grand{font-size:30px;font-weight:800;color:${ORANGE};margin-top:6px;}
`;

function auth(token, hubT) {
  const h = { headers: { Authorization: 'Bearer ' + token } };
  if (hubT) h.params = { t: hubT };
  return h;
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function isoToday() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
// "2026-10-03" -> "03/10/2026"
function fmtDMY(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : String(ymd || '');
}
// chuỗi tiền "1.200.000" -> 1200000
function num(s) {
  const n = parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}
// số lượng cho phép thập phân, chấp nhận dấu phẩy
function qtyNum(s) {
  const n = parseFloat(String(s == null ? '' : s).trim().replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}
function fmtVND(n) {
  return (Math.round(Number(n) || 0)).toLocaleString('vi-VN') + 'đ';
}
function errMsg(err, fallback) {
  if (err && err.response && err.response.data && err.response.data.message) return err.response.data.message;
  return fallback;
}

export default function NhapKho({ embed } = {}) {
  const hubT = (embed && embed.hubT) || '';
  const [token, setToken] = useState(() => (embed && embed.token) || localStorage.getItem('nhapkho_token') || '');
  const [emp, setEmp] = useState(() => {
    if (embed && embed.emp) return embed.emp;
    try { return JSON.parse(localStorage.getItem('nhapkho_emp') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [units, setUnits] = useState([]); // Gói 55 p11z: đơn vị tính từ Thiết lập
  const [categories, setCategories] = useState([]); // Gói 55 p11z: loại NL để nhóm popup
  const [loading, setLoading] = useState(false);
  // Gói 55 p11z: popup chọn nhiều nguyên liệu
  const [showPicker, setShowPicker] = useState(false);
  const [pickSearch, setPickSearch] = useState('');

  const todayIso = useMemo(() => isoToday(), []);
  // --- form phiếu ---
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayIso);
  const [items, setItems] = useState([]);
  // --- thuế / phí ---
  const [taxIncluded, setTaxIncluded] = useState(false);
  const [taxRate, setTaxRate] = useState(0);
  const [discount, setDiscount] = useState('');
  const [shipping, setShipping] = useState('');
  const [note, setNote] = useState('');
  const [paymentType, setPaymentType] = useState('paid'); // 'paid' | 'debt'

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(null); // {code, grand, payLabel, supplierName}
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);

  const toast = (m) => {
    setToastMsg(m); setToastOn(true);
    setTimeout(() => setToastOn(false), 2400);
  };

  const logout = () => {
    localStorage.removeItem('nhapkho_token');
    localStorage.removeItem('nhapkho_emp');
    setToken(''); setEmp(null); setPhone(''); setPin(''); setErr('');
    setSuppliers([]); setMaterials([]);
    resetForm(true);
    setSuccess(null); setToastOn(false);
  };

  const expired = (e) => {
    if (e && e.response && e.response.status === 401) {
      if (embed && embed.onExpired) { embed.onExpired(); }
      else logout();
      toast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return true;
    }
    return false;
  };

  const resetForm = (full) => {
    setInvoiceNo('');
    setReceiptDate(isoToday());
    setItems([]);
    setDiscount(''); setShipping(''); setNote('');
    if (full) {
      setSupplierId(''); setPaymentType('paid');
      setTaxIncluded(false); setTaxRate(0);
    }
  };

  const loadAll = async (tk) => {
    setLoading(true);
    try {
      const [s, m, u, c] = await Promise.all([
        axios.get(API + '/employee/suppliers', auth(tk, hubT)),
        axios.get(API + '/employee/materials', auth(tk, hubT)),
        axios.get(API + '/employee/units', auth(tk, hubT)).catch(() => ({ data: { data: [] } })),
        axios.get(API + '/employee/stocktake-meta', auth(tk, hubT)).catch(() => ({ data: { data: {} } })),
      ]);
      setSuppliers((s.data && s.data.data) || []);
      setMaterials((m.data && m.data.data) || []);
      setUnits((u.data && (u.data.data || u.data)) || []);
      setCategories(((c.data && c.data.data) || {}).categories || []);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Không tải được dữ liệu.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token) loadAll(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
      localStorage.setItem('nhapkho_token', tk);
      localStorage.setItem('nhapkho_emp', JSON.stringify(info));
      setToken(tk); setEmp(info); setPhone(''); setPin('');
    } catch (e) {
      setErr(errMsg(e, 'Đăng nhập thất bại. Kiểm tra lại SĐT và mã PIN.'));
    } finally { setLoginBusy(false); }
  };

  const removeItem = (key) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  };

  // Gói 55 p11z: thêm nhiều nguyên liệu từ popup (mỗi dòng nhập SL/đơn giá sau)
  const addMultipleMaterials = (pickedIds) => {
    const existing = new Set(items.map((it) => it.materialId));
    const added = [];
    pickedIds.forEach((id) => {
      if (existing.has(id)) return;
      const m = materials.find((x) => x.id === id);
      if (!m) return;
      const pu = m.purchase_unit || m.unit || '';
      added.push({
        key: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        materialId: m.id,
        name: m.name,
        purchaseUnit: pu,
        unit: m.unit || '',
        conversionRate: Number(m.conversion_rate) || 1,
        qty: '',
        unitCost: '',
        expiredAt: '',
      });
    });
    if (added.length) {
      setItems((prev) => [...prev, ...added]);
      toast('Đã thêm ' + added.length + ' nguyên liệu.');
    }
    setShowPicker(false);
    setPickSearch('');
  };

  // Cập nhật 1 trường của dòng trong phiếu
  const setItemField = (key, field, value) => {
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, [field]: value } : it));
  };

  // --- tính tổng live ---
  const subtotal = useMemo(
    () => items.reduce((s, it) => s + qtyNum(it.qty) * num(it.unitCost), 0),
    [items]
  );
  const vatAmount = useMemo(() => {
    const r = Number(taxRate) || 0;
    if (!r || !subtotal) return 0;
    if (taxIncluded) return subtotal - subtotal / (1 + r / 100);
    return (subtotal * r) / 100;
  }, [subtotal, taxRate, taxIncluded]);
  const grand = useMemo(() => {
    const base = taxIncluded ? subtotal : subtotal + vatAmount;
    return Math.max(0, Math.round(base - num(discount) + num(shipping)));
  }, [subtotal, vatAmount, taxIncluded, discount, shipping]);

  const submit = async () => {
    // Gói 55 p11z: chỉ gửi dòng có SL > 0
    const validItems = items.filter((it) => qtyNum(it.qty) > 0);
    if (validItems.length === 0) { toast('Vui lòng nhập số lượng cho ít nhất 1 mặt hàng.'); return; }
    if (!receiptDate) { toast('Vui lòng chọn ngày nhập.'); return; }
    if (paymentType === 'debt' && !supplierId) { toast('Công nợ bắt buộc phải chọn nhà cung cấp.'); return; }
    const supName = supplierId
      ? (suppliers.find((s) => String(s.id) === String(supplierId)) || {}).name || ''
      : 'Mua lẻ';
    if (!window.confirm(
      'Tạo phiếu nhập ' + validItems.length + ' mặt hàng, tổng ' + fmtVND(grand) + '?\n' +
      'NCC: ' + supName + ' · ' + (paymentType === 'paid' ? 'Trả ngay' : 'Công nợ')
    )) return;
    setSaving(true);
    try {
      const r = await axios.post(API + '/employee/inbound-receipts', {
        partner_id: supplierId ? Number(supplierId) : null,
        invoice_no: invoiceNo.trim() || null,
        receipt_date: receiptDate,
        tax_included: !!taxIncluded,
        tax_rate: Number(taxRate) || 0,
        discount_amount: num(discount),
        shipping_fee: num(shipping),
        payment_type: paymentType,
        note: note.trim() || null,
        items: validItems.map((it) => ({
          material_id: it.materialId,
          purchase_quantity: qtyNum(it.qty),
          purchase_unit: it.purchaseUnit || null,
          unit_cost: num(it.unitCost),
          expired_at: it.expiredAt || null,
        })),
      }, auth(token, hubT));
      const d = (r.data && r.data.data) || {};
      setSuccess({
        code: d.code || '',
        grand: d.grand_total != null ? d.grand_total : grand,
        payLabel: paymentType === 'paid' ? 'Trả ngay' : 'Công nợ',
        supplierName: supName,
        // Gói 55 p11b: cảnh báo giá nhập tăng so với lần nhập gần nhất
        priceWarnings: r.data && Array.isArray(r.data.price_warnings) ? r.data.price_warnings : [],
      });
      resetForm(false);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Tạo phiếu thất bại.'));
    } finally { setSaving(false); }
  };

  // ================= MÀN HÌNH ĐĂNG NHẬP =================
  // Gói 59: khi nhúng trong StaffHub (embed) thì dùng token/emp của hub, bỏ qua login riêng
  if (!token && !embed) {
    return (
      <div className="nk-wrap">
        <style>{CSS}</style>
        <div className="nk-login">
          <div className="nk-hd" style={{ borderRadius: 18 }}>
            <div className="nk-title">📦 Nhập hàng</div>
            <div className="nk-sub">Đăng nhập để tiếp tục</div>
          </div>
          <form className="nk-card" onSubmit={doLogin}>
            <label className="nk-label" style={{ marginTop: 4 }}>Số điện thoại</label>
            <input
              className="nk-field"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              placeholder="09xxxxxxxx"
              autoComplete="tel"
            />
            <label className="nk-label">Mã PIN 6 số</label>
            <input
              className="nk-field nk-pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              autoComplete="off"
            />
            {err && <div className="nk-msg" style={{ margin: '12px 0 0' }}>{err}</div>}
            <button className="nk-send" type="submit" disabled={loginBusy}>
              {loginBusy ? 'Đang xử lý...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const avatarLetter = ((emp && emp.full_name) || '?').trim().charAt(0).toUpperCase();

  // ================= MÀN HÌNH THÀNH CÔNG =================
  if (success) {
    return (
      <div className="nk-wrap">
        <style>{CSS}</style>
        <header className="nk-hd">
          <div className="nk-hd-user">
            <div className="nk-avatar">{avatarLetter}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nk-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
              <div className="nk-sub">{(emp && emp.branch_name) || ''}</div>
            </div>
            <button className="nk-logout" onClick={embed && embed.onBack ? embed.onBack : logout} aria-label={embed && embed.onBack ? 'Quay lại' : 'Đăng xuất'}>{embed && embed.onBack ? '‹ Quay lại' : 'Đăng xuất'}</button>
          </div>
          <div className="nk-title">📦 Phiếu nhập hàng</div>
        </header>
        <div className="nk-card nk-success">
          <div className="nk-check-big">✓</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Tạo phiếu thành công!</div>
          <div className="nk-code">{success.code}</div>
          <div className="nk-grand">{fmtVND(success.grand)}</div>
          <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>
            {success.supplierName} · {success.payLabel}
          </div>
          {/* Gói 55 p11b: cảnh báo giá nhập tăng so với lần nhập gần nhất */}
          {success.priceWarnings && success.priceWarnings.length > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fcd34d', textAlign: 'left', fontSize: 13 }}>
              <div style={{ fontWeight: 800, color: '#92400e', marginBottom: 6 }}>⚠️ Giá nhập tăng so với lần trước</div>
              {success.priceWarnings.map((w, i) => (
                <div key={i} style={{ color: '#78350f', marginTop: 4, lineHeight: 1.5 }}>
                  • {w.material_name}: {fmtVND(w.old_price)} → {fmtVND(w.new_price)} <b>(+{w.pct}%)</b>
                </div>
              ))}
            </div>
          )}
          <button className="nk-submit" onClick={() => setSuccess(null)}>
            ＋ Tạo phiếu mới
          </button>
        </div>
        <div className={'nk-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
      </div>
    );
  }

  // ================= FORM PHIẾU NHẬP =================
  return (
    <div className="nk-wrap">
      <style>{CSS}</style>

      <header className="nk-hd">
        <div className="nk-hd-user">
          <div className="nk-avatar">{avatarLetter}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="nk-name">{(emp && emp.full_name) || 'Nhân viên'}</div>
            <div className="nk-sub">{(emp && emp.branch_name) || ''}</div>
          </div>
          <button className="nk-logout" onClick={embed && embed.onBack ? embed.onBack : logout} aria-label={embed && embed.onBack ? 'Quay lại' : 'Đăng xuất'}>{embed && embed.onBack ? '‹ Quay lại' : 'Đăng xuất'}</button>
        </div>
        <div className="nk-title">📦 Phiếu nhập hàng</div>
      </header>

      {loading ? (
        <div className="nk-card"><div className="nk-empty">Đang tải dữ liệu...</div></div>
      ) : (
        <>
          <section className="nk-card">
            <h3>Thông tin phiếu</h3>
            <label className="nk-label" style={{ marginTop: 0 }}>Nhà cung cấp</label>
            <select className="nk-field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">🛒 Mua lẻ (không NCC)</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.phone ? ' · ' + s.phone : ''}</option>
              ))}
            </select>
            <div className="nk-2col">
              <div>
                <label className="nk-label">Số hóa đơn</label>
                <input
                  className="nk-field"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="VD: HD-001"
                />
              </div>
              <div>
                <label className="nk-label">Ngày nhập</label>
                <DateInput value={receiptDate} onChange={setReceiptDate} className="nk-field" />
              </div>
            </div>
          </section>

          <section className="nk-card">
            <h3>Thêm mặt hàng</h3>
            {/* Gói 55 p11z: popup chọn nhiều thay cho dropdown đơn */}
            <button className="nk-addbtn" onClick={() => setShowPicker(true)}>
              ＋ Chọn nguyên liệu ({items.length} đã chọn)
            </button>
            <div className="nk-warn" style={{ marginTop: 10 }}>
              Chọn nhiều nguyên liệu 1 lần, sau đó nhập số lượng &amp; đơn giá từng dòng bên dưới.
            </div>
          </section>

          <section className="nk-card">
            <h3>Hàng trong phiếu ({items.length})</h3>
            {items.length === 0 ? (
              <div className="nk-empty">Chưa có mặt hàng nào.<br />Bấm "Chọn nguyên liệu" ở trên để thêm.</div>
            ) : (
              items.map((it) => {
                const line = qtyNum(it.qty) * num(it.unitCost);
                const stockQty = qtyNum(it.qty) * (Number(it.conversionRate) || 1);
                return (
                  <div className="nk-item" key={it.key}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="nk-iname">{it.name}</div>
                        <div className="nk-idetail">
                          {it.unit && it.conversionRate && Number(it.conversionRate) !== 1 ? (
                            <span>ĐV cơ sở: {it.unit}</span>
                          ) : null}
                        </div>
                      </div>
                      <button className="nk-del" onClick={() => removeItem(it.key)} aria-label="Xóa dòng">✕</button>
                    </div>
                    {/* Gói 55 p11z: nhập trực tiếp từng dòng */}
                    <div className="nk-2col">
                      <div>
                        <label className="nk-label" style={{ marginTop: 0 }}>SL nhập</label>
                        <input
                          className="nk-field"
                          inputMode="decimal"
                          value={it.qty}
                          onChange={(e) => setItemField(it.key, 'qty', e.target.value.replace(/[^\d.,]/g, ''))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="nk-label">Đơn vị mua</label>
                        <select
                          className="nk-field"
                          value={it.purchaseUnit}
                          onChange={(e) => setItemField(it.key, 'purchaseUnit', e.target.value)}
                        >
                          <option value={it.unit}>{it.unit} (cơ sở)</option>
                          {units.filter((u) => u.name !== it.unit).map((u) => (
                            <option key={u.id} value={u.name}>{u.name}</option>
                          ))}
                          {it.purchaseUnit && it.purchaseUnit !== it.unit && !units.some((u) => u.name === it.purchaseUnit) && (
                            <option value={it.purchaseUnit}>{it.purchaseUnit}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="nk-2col">
                      <div>
                        <label className="nk-label">Đơn giá (đ)</label>
                        <input
                          className="nk-field"
                          inputMode="numeric"
                          value={it.unitCost}
                          onChange={(e) => setItemField(it.key, 'unitCost', e.target.value.replace(/[^\d]/g, ''))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="nk-label">HSD</label>
                        <DateInput value={it.expiredAt} onChange={(v) => setItemField(it.key, 'expiredAt', v)} className="nk-field" placeholder="dd/mm/yyyy" />
                      </div>
                    </div>
                    {qtyNum(it.qty) > 0 && (
                      <div className="nk-idetail" style={{ marginTop: 6 }}>
                        💰 <b>{fmtVND(line)}</b>
                        {stockQty > 0 && it.unit ? <span> · ≈ {stockQty.toLocaleString('vi-VN')} {it.unit} tồn</span> : null}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          <section className="nk-card">
            <h3>Thuế &amp; chi phí</h3>
            <label className="nk-check">
              <input
                type="checkbox"
                checked={taxIncluded}
                onChange={(e) => setTaxIncluded(e.target.checked)}
              />
              Giá đã gồm VAT
            </label>
            <label className="nk-label">Thuế suất VAT</label>
            <div className="nk-3col" style={{ marginTop: 6 }}>
              {[0, 8, 10].map((r) => (
                <button
                  key={r}
                  className={'nk-seg' + (taxRate === r ? ' on' : '')}
                  onClick={() => setTaxRate(r)}
                >
                  {r}%
                </button>
              ))}
            </div>
            <div className="nk-2col">
              <div>
                <label className="nk-label">Chiết khấu (đ)</label>
                <input
                  className="nk-field"
                  inputMode="numeric"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="nk-label">Phí vận chuyển (đ)</label>
                <input
                  className="nk-field"
                  inputMode="numeric"
                  value={shipping}
                  onChange={(e) => setShipping(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                />
              </div>
            </div>
            <label className="nk-label">Ghi chú</label>
            <input
              className="nk-field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú thêm (không bắt buộc)"
            />
          </section>

          <section className="nk-card">
            <h3>Thanh toán</h3>
            <div className="nk-2col" style={{ marginTop: 0 }}>
              <button
                className={'nk-pay' + (paymentType === 'paid' ? ' on' : '')}
                onClick={() => setPaymentType('paid')}
              >
                💵 Trả ngay
              </button>
              <button
                className={'nk-pay' + (paymentType === 'debt' ? ' on' : '')}
                onClick={() => setPaymentType('debt')}
              >
                📒 Công nợ
              </button>
            </div>
            {paymentType === 'debt' && !supplierId && (
              <div className="nk-warn">⚠️ Công nợ bắt buộc phải chọn <b>nhà cung cấp</b> ở trên.</div>
            )}
          </section>

          <section className="nk-card">
            <h3>Tổng cộng</h3>
            <div className="nk-trow"><span>Tiền hàng</span><b>{fmtVND(subtotal)}</b></div>
            <div className="nk-trow">
              <span>VAT {taxRate}%{taxIncluded ? ' (đã gồm trong giá)' : ''}</span>
              <b>{fmtVND(vatAmount)}</b>
            </div>
            <div className="nk-trow"><span>Chiết khấu</span><b className="neg">−{fmtVND(num(discount))}</b></div>
            <div className="nk-trow"><span>Phí vận chuyển</span><b>+{fmtVND(num(shipping))}</b></div>
            <div className="nk-trow grand"><span>Tổng thanh toán</span><span>{fmtVND(grand)}</span></div>
            <button className="nk-submit" onClick={submit} disabled={saving || items.length === 0}>
              {saving ? 'Đang tạo phiếu...' : '✓ Tạo phiếu nhập'}
            </button>
          </section>
        </>
      )}

      {/* Gói 55 p11z: popup chọn nhiều nguyên liệu */}
      {showPicker && (
        <MaterialMultiPicker
          materials={materials}
          categories={categories}
          excludeIds={items.map((it) => it.materialId)}
          search={pickSearch}
          setSearch={setPickSearch}
          onClose={() => { setShowPicker(false); setPickSearch(''); }}
          onConfirm={addMultipleMaterials}
        />
      )}

      <div className={'nk-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}

// Gói 55 p11z: popup chọn nhiều nguyên liệu (copy pattern từ KiemKe.jsx)
function MaterialMultiPicker({ materials, categories, excludeIds, search, setSearch, onClose, onConfirm }) {
  const [picked, setPicked] = useState(new Set());

  const groups = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    const available = (materials || []).filter((m) =>
      !excludeIds.includes(m.id) &&
      m.is_active !== false &&
      (!q || String(m.name || '').toLowerCase().includes(q))
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
  }, [materials, excludeIds, categories, search]);

  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 18 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#24305E', marginBottom: 12 }}>Chọn nguyên liệu</h3>
        <input
          style={{ width: '100%', minHeight: 48, border: '1.5px solid #F5A623', borderRadius: 12, padding: '10px 12px', fontSize: 15, marginBottom: 12, boxSizing: 'border-box' }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm nguyên liệu..."
          autoFocus
        />
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {groups.length === 0 && <div style={{ textAlign: 'center', color: '#6b7280', padding: 18 }}>Không có nguyên liệu nào.</div>}
          {groups.map((g) => (
            <div key={g.name} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#666', textTransform: 'uppercase', marginBottom: 6 }}>
                {g.name} ({g.items.length})
              </div>
              {g.items.map((m) => (
                <button key={m.id} onClick={() => toggle(m.id)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '11px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid',
                    borderColor: picked.has(m.id) ? '#24305E' : '#eee',
                    background: picked.has(m.id) ? '#eef2ff' : '#fff',
                    fontSize: 14, textAlign: 'left', fontFamily: 'inherit',
                  }}>
                  <span>{m.name} <span style={{ color: '#999', fontSize: 12 }}>({m.unit})</span></span>
                  {picked.has(m.id) && <span style={{ color: '#24305E', fontWeight: 800 }}>✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: '1px solid #ddd', background: '#fff', fontSize: 15, fontWeight: 700 }}>Hủy</button>
          <button onClick={() => onConfirm([...picked])} disabled={picked.size === 0}
            style={{ flex: 1, minHeight: 48, borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', fontSize: 15, fontWeight: 700, opacity: picked.size === 0 ? 0.45 : 1 }}>
            Thêm ({picked.size})
          </button>
        </div>
      </div>
    </div>
  );
}
