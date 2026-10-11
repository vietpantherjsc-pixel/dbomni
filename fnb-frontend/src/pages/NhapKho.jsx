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

function auth(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
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

export default function NhapKho() {
  const [token, setToken] = useState(() => localStorage.getItem('nhapkho_token') || '');
  const [emp, setEmp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nhapkho_emp') || 'null'); } catch (e) { return null; }
  });
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);

  const todayIso = useMemo(() => isoToday(), []);
  // --- form phiếu ---
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayIso);
  const [items, setItems] = useState([]);
  // --- thêm dòng hàng ---
  const [matQuery, setMatQuery] = useState('');
  const [matOpen, setMatOpen] = useState(false);
  const [pickMat, setPickMat] = useState(null);
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [expDate, setExpDate] = useState('');
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
      logout();
      toast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return true;
    }
    return false;
  };

  const resetForm = (full) => {
    setInvoiceNo('');
    setReceiptDate(isoToday());
    setItems([]);
    setMatQuery(''); setMatOpen(false); setPickMat(null);
    setQty(''); setUnitCost(''); setExpDate('');
    setDiscount(''); setShipping(''); setNote('');
    if (full) {
      setSupplierId(''); setPaymentType('paid');
      setTaxIncluded(false); setTaxRate(0);
    }
  };

  const loadAll = async (tk) => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        axios.get(API + '/employee/suppliers', auth(tk)),
        axios.get(API + '/employee/materials', auth(tk)),
      ]);
      setSuppliers((s.data && s.data.data) || []);
      setMaterials((m.data && m.data.data) || []);
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

  // --- tìm nguyên liệu ---
  const matResults = useMemo(() => {
    const q = matQuery.trim().toLowerCase();
    if (!q || pickMat) return [];
    return materials.filter((m) => String(m.name || '').toLowerCase().includes(q)).slice(0, 8);
  }, [matQuery, materials, pickMat]);

  const pickMaterial = (m) => {
    setPickMat(m);
    setMatQuery(m.name);
    setMatOpen(false);
  };
  const clearPick = () => {
    setPickMat(null); setMatQuery('');
  };

  const addItem = () => {
    if (!pickMat) { toast('Vui lòng chọn nguyên liệu.'); return; }
    const q = qtyNum(qty);
    if (!q || q <= 0) { toast('Vui lòng nhập số lượng lớn hơn 0.'); return; }
    if (String(unitCost).trim() === '') { toast('Vui lòng nhập đơn giá.'); return; }
    const pu = pickMat.purchase_unit || pickMat.unit || '';
    setItems((prev) => [...prev, {
      key: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      materialId: pickMat.id,
      name: pickMat.name,
      purchaseUnit: pu,
      unit: pickMat.unit || '',
      conversionRate: Number(pickMat.conversion_rate) || 1,
      qty: String(qty).trim(),
      unitCost: String(unitCost).trim(),
      expiredAt: expDate || '',
    }]);
    setPickMat(null); setMatQuery(''); setQty(''); setUnitCost(''); setExpDate('');
    toast('Đã thêm vào phiếu.');
  };

  const removeItem = (key) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
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
    if (items.length === 0) { toast('Phiếu chưa có mặt hàng nào.'); return; }
    if (!receiptDate) { toast('Vui lòng chọn ngày nhập.'); return; }
    if (paymentType === 'debt' && !supplierId) { toast('Công nợ bắt buộc phải chọn nhà cung cấp.'); return; }
    const supName = supplierId
      ? (suppliers.find((s) => String(s.id) === String(supplierId)) || {}).name || ''
      : 'Mua lẻ';
    if (!window.confirm(
      'Tạo phiếu nhập ' + items.length + ' mặt hàng, tổng ' + fmtVND(grand) + '?\n' +
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
        items: items.map((it) => ({
          material_id: it.materialId,
          purchase_quantity: qtyNum(it.qty),
          unit_cost: num(it.unitCost),
          expired_at: it.expiredAt || null,
        })),
      }, auth(token));
      const d = (r.data && r.data.data) || {};
      setSuccess({
        code: d.code || '',
        grand: d.grand_total != null ? d.grand_total : grand,
        payLabel: paymentType === 'paid' ? 'Trả ngay' : 'Công nợ',
        supplierName: supName,
      });
      resetForm(false);
    } catch (e) {
      if (expired(e)) return;
      toast(errMsg(e, 'Tạo phiếu thất bại.'));
    } finally { setSaving(false); }
  };

  // ================= MÀN HÌNH ĐĂNG NHẬP =================
  if (!token) {
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
            <button className="nk-logout" onClick={logout} aria-label="Đăng xuất">Đăng xuất</button>
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
          <button className="nk-logout" onClick={logout} aria-label="Đăng xuất">Đăng xuất</button>
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
            <label className="nk-label" style={{ marginTop: 0 }}>Tìm nguyên liệu</label>
            <div className="nk-search">
              <input
                className="nk-field"
                value={matQuery}
                onChange={(e) => { setMatQuery(e.target.value); setMatOpen(true); }}
                onFocus={() => setMatOpen(true)}
                placeholder="Gõ tên nguyên liệu..."
                autoComplete="off"
              />
              {matOpen && matResults.length > 0 && (
                <div className="nk-drop">
                  {matResults.map((m) => (
                    <div className="nk-opt" key={m.id} onClick={() => pickMaterial(m)}>
                      {m.name}
                      <small>{m.purchase_unit || m.unit || ''}{m.category_name ? ' · ' + m.category_name : ''}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {pickMat && (
              <div className="nk-pick">
                <span>✓ {pickMat.name}{pickMat.purchase_unit ? ' (' + pickMat.purchase_unit + ')' : ''}</span>
                <button onClick={clearPick} aria-label="Bỏ chọn">✕</button>
              </div>
            )}
            <div className="nk-2col">
              <div>
                <label className="nk-label">Số lượng{pickMat && pickMat.purchase_unit ? ' (' + pickMat.purchase_unit + ')' : ''}</label>
                <input
                  className="nk-field"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="nk-label">Đơn giá (đ)</label>
                <input
                  className="nk-field"
                  inputMode="numeric"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                />
              </div>
            </div>
            <label className="nk-label">Hạn sử dụng (không bắt buộc)</label>
            <DateInput value={expDate} onChange={setExpDate} className="nk-field" placeholder="dd/mm/yyyy" />
            {pickMat && qtyNum(qty) > 0 && (
              <div className="nk-warn" style={{ marginTop: 10 }}>
                💰 Thành tiền: <b>{fmtVND(qtyNum(qty) * num(unitCost))}</b>
                {pickMat.conversion_rate && Number(pickMat.conversion_rate) !== 1 && pickMat.unit ? (
                  <span> · Quy đổi tồn kho: <b>{(qtyNum(qty) * Number(pickMat.conversion_rate)).toLocaleString('vi-VN')} {pickMat.unit}</b></span>
                ) : null}
              </div>
            )}
            <button className="nk-addbtn" onClick={addItem}>＋ Thêm vào phiếu</button>
          </section>

          <section className="nk-card">
            <h3>Hàng trong phiếu ({items.length})</h3>
            {items.length === 0 ? (
              <div className="nk-empty">Chưa có mặt hàng nào.<br />Tìm nguyên liệu ở trên để thêm.</div>
            ) : (
              items.map((it) => {
                const line = qtyNum(it.qty) * num(it.unitCost);
                const stockQty = qtyNum(it.qty) * (Number(it.conversionRate) || 1);
                return (
                  <div className="nk-item" key={it.key}>
                    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="nk-iname">{it.name}</div>
                        <div className="nk-idetail">
                          {it.qty} {it.purchaseUnit} × {fmtVND(num(it.unitCost))}
                          {it.unit && it.conversionRate && Number(it.conversionRate) !== 1 ? (
                            <span> → {stockQty.toLocaleString('vi-VN')} {it.unit} tồn</span>
                          ) : null}
                          {it.expiredAt ? <span> · HSD {fmtDMY(it.expiredAt)}</span> : null}
                        </div>
                      </div>
                      <div className="nk-itotal">{fmtVND(line)}</div>
                      <button className="nk-del" onClick={() => removeItem(it.key)} aria-label="Xóa dòng">✕</button>
                    </div>
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

      <div className={'nk-toast' + (toastOn ? ' show' : '')}>{toastMsg}</div>
    </div>
  );
}
