import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getProfile, setProfile, getRef } from '../api';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';
import { useShop } from '../store';

// Gói 48: địa chỉ tách Tỉnh/Phường-Xã (API v2, 34 tỉnh mới) + số nhà/đường;
// tự động tính khoảng cách (bỏ nút bấm tay); ghi chú giao hàng;
// xuất hóa đơn VAT; hẹn giờ lấy dùng ô ngày/giờ chuẩn (dd/mm/yyyy + HH:MM 24h).

const PROV_API = 'https://provinces.open-api.vn/api/v2';

// Ô nhập ngày dd/mm/yyyy đơn giản cho Mini App
function DateField({ value, onChange }) {
  const mask = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    if (d.length > 2) return d.slice(0, 2) + '/' + d.slice(2);
    return d;
  };
  return (
    <input value={value} onChange={(e) => onChange(mask(e.target.value))}
      placeholder="dd/mm/yyyy" inputMode="numeric" maxLength={10} />
  );
}
// Ô nhập giờ HH:MM 24h đơn giản cho Mini App
function TimeField({ value, onChange }) {
  const mask = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 4);
    if (d.length > 2) return d.slice(0, 2) + ':' + d.slice(2);
    return d;
  };
  return (
    <input value={value} onChange={(e) => onChange(mask(e.target.value))}
      placeholder="HH:MM" inputMode="numeric" maxLength={5} />
  );
}
const toApiDate = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');

export default function Checkout() {
  const { branch, cart, subtotal, clearCart } = useShop();
  const nav = useNavigate();
  const [type, setType] = useState('delivery'); // delivery | takeaway | scheduled
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // Địa chỉ giao hàng
  const [provinces, setProvinces] = useState([]);
  const [province, setProvince] = useState('');
  const [wards, setWards] = useState([]);
  const [ward, setWard] = useState('');
  const [street, setStreet] = useState('');
  const [km, setKm] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [shipCfg, setShipCfg] = useState(null);
  // Hẹn giờ lấy
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [payment, setPayment] = useState('transfer');
  const [promos, setPromos] = useState([]);
  const [promoId, setPromoId] = useState('');
  const [voucher, setVoucher] = useState('');
  const [points, setPoints] = useState(0);
  const [redeem, setRedeem] = useState(0);
  const [redeemRate, setRedeemRate] = useState({ points: 10, amount: 1000 });
  // Hóa đơn VAT
  const [needVat, setNeedVat] = useState(false);
  const [vatCode, setVatCode] = useState('');
  const [vatName, setVatName] = useState('');
  const [vatAddr, setVatAddr] = useState('');
  const [vatEmail, setVatEmail] = useState('');
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  // Gói 49: sổ địa chỉ
  const [customerId, setCustomerId] = useState(null);
  const [addrBook, setAddrBook] = useState([]);
  const [addrId, setAddrId] = useState('');
  const [saveAddr, setSaveAddr] = useState(false);
  const [addrLabel, setAddrLabel] = useState('Nhà');
  const geoTimer = useRef(null);

  useEffect(() => {
    if (promoId && promos.length > 0 && !promos.some((p) => String(p.id) === String(promoId))) setPromoId('');
  }, [promos]);

  useEffect(() => {
    if (!branch) { nav('/branches'); return; }
    if (cart.length === 0) { nav('/'); return; }
    const p = getProfile();
    if (p) { setName(p.name || ''); setPhone(p.phone || ''); }
    api.shipConfig().then(setShipCfg).catch(() => {});
    fetch(`${PROV_API}/p/`).then((r) => r.json()).then(setProvinces).catch(() => {});
  }, []);

  // Nạp phường/xã khi đổi tỉnh
  useEffect(() => {
    if (!province) { setWards([]); setWard(''); return; }
    fetch(`${PROV_API}/p/${province}?depth=2`).then((r) => r.json())
      .then((d) => { setWards(d.wards || []); setWard(''); })
      .catch(() => {});
  }, [province]);

  // Tự động tính khoảng cách khi địa chỉ đủ (debounce 800ms)
  const fullAddress = () => [street.trim(), wardName(), provName()].filter(Boolean).join(', ');
  const wardName = () => (wards.find((w) => String(w.code) === String(ward)) || {}).name || '';
  const provName = () => (provinces.find((p) => String(p.code) === String(province)) || {}).name || '';
  useEffect(() => {
    if (type !== 'delivery') return;
    if (!street.trim() || !ward || !province) { setKm(null); return; }
    clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(async () => {
      if (!branch.latitude || !branch.longitude) return;
      setGeoLoading(true);
      try {
        const g = await geocodeAddress(fullAddress() + ', Việt Nam');
        const d = haversineKm(Number(branch.latitude), Number(branch.longitude), g.lat, g.lng);
        setKm(Math.round(d * 10) / 10);
      } catch (e) { setKm(null); }
      finally { setGeoLoading(false); }
    }, 800);
    return () => clearTimeout(geoTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, ward, province, type]);

  // Nạp KM + điểm
  useEffect(() => {
    if (!phone || phone.length < 9) return;
    const fee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
    const t = setTimeout(() => {
      const payload = {
        subtotal,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty, line_total: l.unitPrice * l.qty })),
        shipping_fee: fee,
      };
      api.customerByPhone(phone, getProfile()?.member_code || '').then((c) => {
        if (c) {
          setPoints(c.points || 0);
          setCustomerId(c.id); // Gói 49: để nạp sổ địa chỉ
          api.addresses(c.id).then((r) => setAddrBook(r?.data || [])).catch(() => {});
          if (c.redeem_points && c.redeem_amount) {
            setRedeemRate({ points: Number(c.redeem_points), amount: Number(c.redeem_amount) });
          }
          return api.eligiblePromotions({ ...payload, customer_id: c.id });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setPromos).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [phone, subtotal, km, shipCfg, type]);

  const shipFee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
  const promo = promos.find((p) => String(p.id) === String(promoId));
  const isShipPromo = !!(promo && (promo.is_shipping || promo.type === 'shipping') && type === 'delivery');
  const shipDisc = isShipPromo ? Math.min(Number(promo.discount) || 0, shipFee) : 0;
  const promoDisc = promo && !isShipPromo ? Number(promo.discount) : 0;
  const pointDisc = Math.min(redeem, points) * (redeemRate.amount / redeemRate.points);
  const total = Math.max(0, subtotal + shipFee - shipDisc - promoDisc - pointDisc);

  const place = async () => {
    if (!name.trim() || !phone.trim()) { alert('Nhập tên và số điện thoại.'); return; }
    if (type === 'delivery') {
      if (!province || !ward || !street.trim()) { alert('Chọn tỉnh/thành, phường/xã và nhập số nhà, tên đường.'); return; }
      if (km == null) { alert('Đang tính khoảng cách, vui lòng đợi giây lát...'); return; }
    }
    let scheduledAt = null;
    if (type === 'scheduled') {
      const d = toApiDate(schedDate);
      if (!d) { alert('Nhập ngày muốn tới lấy (dd/mm/yyyy).'); return; }
      if (!validTime(schedTime)) { alert('Nhập giờ muốn tới lấy (HH:MM, 24h).'); return; }
      scheduledAt = `${d}T${schedTime}`;
      if (new Date(scheduledAt) <= new Date()) { alert('Giờ hẹn phải sau thời điểm hiện tại.'); return; }
    }
    if (needVat) {
      if (!vatCode.trim() || !vatName.trim() || !vatEmail.trim()) { alert('Nhập MST, tên công ty và email để xuất hóa đơn VAT.'); return; }
      if (!/^\S+@\S+\.\S+$/.test(vatEmail.trim())) { alert('Email nhận hóa đơn chưa đúng.'); return; }
    }
    setPlacing(true);
    try {
      const order = await api.createOrder({
        branch_id: branch.id,
        order_type: type === 'delivery' ? 'delivery' : 'takeaway',
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        delivery_address: type === 'delivery' ? fullAddress() : null,
        province: type === 'delivery' ? provName() : null,
        ward: type === 'delivery' ? wardName() : null,
        distance_km: type === 'delivery' ? km : null,
        delivery_note: type === 'delivery' && deliveryNote.trim() ? deliveryNote.trim() : null,
        scheduled_at: scheduledAt,
        payment_method: payment,
        voucher_code: voucher.trim() || null,
        promotion_id: promoId || null,
        points_redeem: redeem || null,
        need_vat_invoice: needVat,
        vat_tax_code: needVat ? vatCode.trim() : null,
        vat_company_name: needVat ? vatName.trim() : null,
        vat_company_address: needVat && vatAddr.trim() ? vatAddr.trim() : null,
        vat_email: needVat && vatEmail.trim() ? vatEmail.trim() : null,
        note: note.trim() || null,
        referred_by: getRef() || null,
        items: cart.map((l) => ({
          product_id: l.product.id,
          product_option_id: l.optionId || null,
          option_ids: l.optionIds || [],
          quantity: l.qty,
          note: [l.optText, l.note].filter(Boolean).join(' | ') || null,
        })),
      });
      setProfile({ ...(getProfile() || {}), name: name.trim(), phone: phone.trim() });
      // Gói 49: lưu địa chỉ mới vào sổ
      if (type === 'delivery' && customerId && saveAddr && !addrId) {
        api.saveAddress({
          customer_id: customerId, label: addrLabel,
          province: provName(), ward: wardName(), street: street.trim(),
        }).catch(() => {});
      }
      clearCart();
      nav(`/success/${order.code}`);
    } catch (e) {
      alert(e.message);
    } finally { setPlacing(false); }
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav('/cart')}>←</button><h1>Xác nhận đơn</h1></div>

      <div style={{ padding: '12px 16px 0' }}>
        <div className="zm-seg">
          <button className={type === 'delivery' ? 'on' : ''} onClick={() => setType('delivery')}>🛵 Giao hàng</button>
          <button className={type === 'takeaway' ? 'on' : ''} onClick={() => setType('takeaway')}>🏃 Mang đi</button>
          <button className={type === 'scheduled' ? 'on' : ''} onClick={() => setType('scheduled')}>⏰ Hẹn giờ lấy</button>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div className="zm-field">
          <label>Tên của bạn *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />
        </div>
        <div className="zm-field">
          <label>Số điện thoại * <span style={{ color: '#888', fontWeight: 400 }}>(để tích điểm thành viên)</span></label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" inputMode="tel" />
        </div>

        {type === 'delivery' && (
          <>
            {/* Gói 49: sổ địa chỉ */}
            {addrBook.length > 0 && (
              <div className="zm-field">
                <label>📒 Sổ địa chỉ</label>
                <select value={addrId} onChange={(e) => {
                  const id = e.target.value;
                  setAddrId(id);
                  if (!id) return;
                  const a = addrBook.find((x) => String(x.id) === id);
                  if (!a) return;
                  // Map tên tỉnh/xã -> code
                  const pc = provinces.find((p) => p.name === a.province)?.code;
                  if (pc) {
                    setProvince(String(pc));
                    fetch(`${PROV_API}/p/${pc}?depth=2`).then((r) => r.json()).then((d) => {
                      const ws = d.wards || [];
                      setWards(ws);
                      const wc = ws.find((w) => w.name === a.ward)?.code;
                      setWard(wc ? String(wc) : '');
                    }).catch(() => {});
                  }
                  setStreet(a.street || '');
                }}>
                  <option value="">— Nhập địa chỉ mới —</option>
                  {addrBook.map((a) => (
                    <option key={a.id} value={a.id}>{a.is_default ? '★ ' : ''}{a.label}: {a.full_address}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="zm-field">
              <label>Tỉnh / Thành phố *</label>
              <select value={province} onChange={(e) => { setProvince(e.target.value); setAddrId(''); }}>
                <option value="">— Chọn tỉnh/thành —</option>
                {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>
            <div className="zm-field">
              <label>Phường / Xã *</label>
              <select value={ward} onChange={(e) => setWard(e.target.value)} disabled={!province}>
                <option value="">— Chọn phường/xã —</option>
                {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
              </select>
            </div>
            <div className="zm-field">
              <label>Số nhà, tên đường *</label>
              <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="VD: 123 Nguyễn Huệ" />
            </div>
            {geoLoading && <div className="zm-note">📍 Đang tự động tính khoảng cách...</div>}
            {km != null && shipCfg && (
              <div className="zm-alert">📏 Khoảng cách ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b> (tự động tính)</div>
            )}
            <div className="zm-field">
              <label>Ghi chú giao hàng</label>
              <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="VD: gọi trước khi tới, để ở bảo vệ..." />
            </div>
            {/* Gói 49: lưu địa chỉ cho lần sau */}
            {customerId && !addrId && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
                <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} style={{ width: 18, height: 18 }} />
                Lưu địa chỉ này vào sổ địa chỉ
                {saveAddr && (
                  <select value={addrLabel} onChange={(e) => setAddrLabel(e.target.value)} style={{ marginLeft: 4, padding: '4px 8px', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                    <option>Nhà</option><option>Công ty</option><option>Khác</option>
                  </select>
                )}
              </label>
            )}
          </>
        )}

        {type === 'scheduled' && (
          <div className="zm-field">
            <label>Ngày giờ muốn tới lấy *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><DateField value={schedDate} onChange={setSchedDate} /></div>
              <div style={{ width: 110 }}><TimeField value={schedTime} onChange={setSchedTime} /></div>
            </div>
          </div>
        )}

        <div className="zm-field">
          <label>Phương thức thanh toán</label>
        </div>
        <div className={`zm-pay-opt ${payment === 'transfer' ? 'on' : ''}`} onClick={() => setPayment('transfer')}>
          <div className="dot" /><div><b>Chuyển khoản / QR</b><div style={{ fontSize: 12, color: '#888' }}>Quán xác nhận đã nhận tiền rồi mới làm món</div></div>
        </div>
        <div className={`zm-pay-opt ${payment === 'pay_at_store' ? 'on' : ''}`} onClick={() => setPayment('pay_at_store')}>
          <div className="dot" /><div><b>Thanh toán tại quán</b><div style={{ fontSize: 12, color: '#888' }}>Trả tiền khi nhận món</div></div>
        </div>

        {/* Hóa đơn VAT — card riêng tách biệt khỏi mã giảm giá */}
        <div style={{ background: needVat ? '#eff6ff' : '#f8fafc', border: `1.5px solid ${needVat ? '#3b82f6' : '#e2e8f0'}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
            <input type="checkbox" checked={needVat} onChange={(e) => setNeedVat(e.target.checked)} style={{ width: 20, height: 20 }} />
            🧾 Xuất hóa đơn VAT
          </label>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Dành cho khách hàng công ty cần hóa đơn đỏ</div>
          {needVat && (
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              <div className="zm-field" style={{ margin: 0 }}><label>Mã số thuế *</label>
                <input value={vatCode} onChange={(e) => setVatCode(e.target.value)} placeholder="VD: 0312345678" inputMode="numeric" /></div>
              <div className="zm-field" style={{ margin: 0 }}><label>Tên công ty *</label>
                <input value={vatName} onChange={(e) => setVatName(e.target.value)} placeholder="Tên công ty" /></div>
              <div className="zm-field" style={{ margin: 0 }}><label>Địa chỉ công ty</label>
                <input value={vatAddr} onChange={(e) => setVatAddr(e.target.value)} placeholder="Địa chỉ xuất hóa đơn" /></div>
              <div className="zm-field" style={{ margin: 0 }}><label>Email nhận hóa đơn *</label>
                <input value={vatEmail} onChange={(e) => setVatEmail(e.target.value)} placeholder="email@congty.vn" inputMode="email" /></div>
            </div>
          )}
        </div>

        {promos.length > 0 && (
          <div className="zm-field">
            <label>Khuyến mại</label>
            <select value={promoId} onChange={(e) => setPromoId(e.target.value)}>
              <option value="">Không dùng</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.is_shipping || p.type === 'shipping') ? `🚚 ${p.name} (−${fmt(p.discount)}đ phí ship)` : `${p.name} (−${fmt(p.discount)}đ)`}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Mã giảm giá — nhóm riêng */}
        <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>🎟️ Mã giảm giá</div>
          <div className="zm-field" style={{ margin: 0 }}>
            <input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="NHẬP MÃ NẾU CÓ" style={{ textTransform: 'uppercase' }} />
          </div>
        </div>
        {points > 0 && (
          <div className="zm-field">
            <label>Đổi điểm ({fmt(points)} điểm khả dụng)</label>
            <input type="number" min="0" max={points} value={redeem} onChange={(e) => setRedeem(Number(e.target.value))} placeholder="Nhập số điểm muốn đổi" />
          </div>
        )}
        <div className="zm-field">
          <label>Ghi chú</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho quán..." />
        </div>

        <div style={{ margin: '8px 0 16px' }}>
          <div className="zm-total-row"><span>Tạm tính ({cart.reduce((s, l) => s + l.qty, 0)} món)</span><span>{fmt(subtotal)}đ</span></div>
          {type === 'delivery' && shipFee > 0 && <div className="zm-total-row"><span>Phí dịch vụ (ship ~{km ?? '?'}km)</span><span>{fmt(shipFee)}đ</span></div>}
          {shipDisc > 0 && <div className="zm-total-row disc"><span>🚚 KM phí vận chuyển</span><span>−{fmt(shipDisc)}đ</span></div>}
          {promoDisc > 0 && <div className="zm-total-row disc"><span>Khuyến mại</span><span>−{fmt(promoDisc)}đ</span></div>}
          {pointDisc > 0 && <div className="zm-total-row disc"><span>Đổi điểm</span><span>−{fmt(pointDisc)}đ</span></div>}
          <div className="zm-total-row grand"><span>Tổng cộng</span><span>{fmt(total)}đ</span></div>
        </div>
      </div>

      <div className="zm-cartbar">
        <button className="zm-btn-primary" disabled={placing} onClick={place}>
          {placing ? 'Đang đặt món...' : `Đặt món · ${fmt(total)}đ`}
        </button>
      </div>
    </div>
  );
}
