import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getProfile, setProfile, getRef } from '../api';
import SearchSelect from '../components/SearchSelect';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';
import { openStatus, nextOpenSlot, timeSlots, isWithinOpening } from '../utils/openingHours';
import { useShop } from '../store';

// Gói 50d: luồng 2 bước — (1) nhập thông tin, (2) tóm tắt đơn hàng rồi mới đặt.
// Không chặn đặt hàng khi geocode thất bại: hiện cảnh báo, phí ship quán xác nhận sau.

// Gói 55 p11ac: tỉnh/thành qua backend proxy (Zalo WebView chặn domain lạ)
const loadProvinces = () => api.provinces().catch(() => []);
const loadWards = (code) => api.wards(code).catch(() => []);

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
// Chuẩn hóa SĐT VN: bỏ khoảng trắng/ký tự lạ, +84/84 → 0
const formatPhone = (v) => {
  let p = String(v || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length >= 11) p = '0' + p.slice(2);
  return p;
};

export default function Checkout() {
  const { branch, cart, subtotal, clearCart } = useShop();
  const nav = useNavigate();
  const [step, setStep] = useState(1); // 1: nhập thông tin, 2: tóm tắt đơn
  const [type, setType] = useState('delivery');
  const [deliveryMode, setDeliveryMode] = useState('now'); // Gói 55 p10: 'now' = giao ngay, 'scheduled' = hẹn giờ giao
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [provinces, setProvinces] = useState([]);
  const [province, setProvince] = useState('');
  const [wards, setWards] = useState([]);
  const [ward, setWard] = useState('');
  const [street, setStreet] = useState('');
  const [km, setKm] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [shipCfg, setShipCfg] = useState(null);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [payment, setPayment] = useState('transfer');
  // Gói 55 p11ac: PTTT động từ cấu hình (thay vì hardcode)
  const [payMethods, setPayMethods] = useState([]);
  useEffect(() => {
    api.payMethods().then((list) => {
      if (list && list.length) {
        setPayMethods(list);
        if (!list.some((m) => m.value === payment)) setPayment(list[0].value);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [promos, setPromos] = useState([]);
  const [promoId, setPromoId] = useState('');
  const [voucher, setVoucher] = useState('');
  const [points, setPoints] = useState(0);
  const [redeem, setRedeem] = useState(0);
  const [redeemRate, setRedeemRate] = useState({ points: 10, amount: 1000 });
  const [needVat, setNeedVat] = useState(false);
  const [vatCode, setVatCode] = useState('');
  const [vatName, setVatName] = useState('');
  const [vatAddr, setVatAddr] = useState('');
  const [vatEmail, setVatEmail] = useState('');
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [customerId, setCustomerId] = useState(null);
  const [addrBook, setAddrBook] = useState([]);
  const [addrId, setAddrId] = useState('');
  const [saveAddr, setSaveAddr] = useState(false);
  const [addrLabel, setAddrLabel] = useState('Nhà');
  // Gói 55 p3: popup thông tin nhận hàng + vị trí hiện tại
  const [showAddrPop, setShowAddrPop] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  // Gói 50f: gợi ý địa chỉ khi gõ
  const [suggests, setSuggests] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [pickedCoord, setPickedCoord] = useState(null); // {lat, lng} khi user chọn gợi ý
  // Gói 55 p10: kiểm tra trạng thái mở cửa — đóng cửa thì chỉ nhận hẹn giờ
  const st = openStatus(branch);
  const isClosed = st && !st.open;
  const geoTimer = useRef(null);
  const suggestTimer = useRef(null);
  useEffect(() => {
    if (isClosed) {
      // Đóng cửa: ép sang chế độ hẹn giờ
      if (type === 'delivery') setDeliveryMode('scheduled');
      if (type === 'takeaway') setType('scheduled');
      // Gợi ý khung giờ mở cửa gần nhất
      const next = nextOpenSlot(branch);
      if (next && !schedDate) { setSchedDate(next.date); setSchedTime(next.time); }
    }
  }, [isClosed]);

  useEffect(() => {
    if (promoId && promos.length > 0 && !promos.some((p) => String(p.id) === String(promoId))) setPromoId('');
  }, [promos]);

  useEffect(() => {
    if (!branch) { nav('/branches'); return; }
    if (cart.length === 0) { nav('/'); return; }
    const p = getProfile();
    if (p) { setName(p.name || ''); setPhone(p.phone || ''); }
    api.shipConfig().then(setShipCfg).catch(() => {});
    loadProvinces().then(setProvinces);
  }, []);

  useEffect(() => {
    if (!province) { setWards([]); setWard(''); return; }
    loadWards(province)
      .then((ws) => { setWards(ws || []); setWard(''); });
  }, [province]);

  const fullAddress = () => [street.trim(), wardName(), provName()].filter(Boolean).join(', ');
  const wardName = () => (wards.find((w) => String(w.code) === String(ward)) || {}).name || '';
  const provName = () => (provinces.find((p) => String(p.code) === String(province)) || {}).name || '';

  const calcKm = async () => {
    if (!branch.latitude || !branch.longitude) return;
    // Gói 50f: nếu user đã chọn gợi ý có tọa độ thì dùng luôn
    if (pickedCoord) {
      const d = haversineKm(Number(branch.latitude), Number(branch.longitude), pickedCoord.lat, pickedCoord.lng);
      setKm(Math.round(d * 10) / 10);
      setGeoError(false);
      return;
    }
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    setGeoLoading(true); setGeoError(false);
    try {
      const g = await geocodeAddress(fullAddress() + ', Việt Nam');
      const d = haversineKm(Number(branch.latitude), Number(branch.longitude), g.lat, g.lng);
      setKm(Math.round(d * 10) / 10);
    } catch (e) { setKm(null); setGeoError(true); }
    finally { setGeoLoading(false); }
  };

  // Gói 55 p3: BỎ gợi ý tự động khi gõ tay — chỉ hiện gợi ý sau khi bấm "Vị trí hiện tại"
  // (fillFromCoord tự gọi khi GPS thiếu số nhà). Nhập tay → calcKm tự geocode khi Lưu.

  const pickSuggest = (s) => {
    // Gói 55 p3: giữ số nhà user đã gõ tay (VD "90 Tô Hiệu" → chọn gợi ý vẫn giữ "90")
    const typedNo = street.match(/^\d[\d/\-\s]*/)?.[0]?.trim();
    let newStreet = s.short || s.label.split(',')[0];
    if (typedNo && !/^\d/.test(newStreet)) {
      newStreet = `${typedNo} ${newStreet}`;
    }
    setStreet(newStreet);
    setPickedCoord({ lat: s.lat, lng: s.lng });
    setSuggests([]);
  };

  // Gói 55 p3: điền địa chỉ từ tọa độ (dùng chung cho GPS chính xác cao/thấp)
  const fillFromCoord = async (latitude, longitude) => {
    const r = await api.geocodeReverse(latitude, longitude);
    // Điền số nhà + đường
    const streetParts = [r.house_number, r.road].filter(Boolean).join(' ');
    if (streetParts) setStreet(streetParts);
    // Tìm tỉnh/thành khớp
    const prov = provinces.find((p) =>
      r.state?.includes(p.name) || p.name.includes(r.state || '###') ||
      r.city?.includes(p.name) || p.name.includes(r.city || '###'));
    if (prov) {
      setProvince(String(prov.code));
      // Tải xã/phường của tỉnh rồi tìm khớp
      try {
        const ws = await loadWards(prov.code);
        setWards(ws);
        const w = ws.find((x) =>
          r.suburb && (x.name.includes(r.suburb) || r.suburb.includes(x.name)));
        if (w) setWard(String(w.code));
      } catch {}
    }
    // Gói 55 p3: GPS điền xong là xong — KHÔNG hiện gợi ý (tránh làm phiền user)
    setSuggests([]);
  };

  // Gói 55 p3: lấy vị trí hiện tại (GPS) → reverse geocode → điền vào các trường
  // Thử GPS chính xác cao trước (15s), thất bại thì dùng định vị nhanh (WiFi/cột sóng)
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { alert('Thiết bị không hỗ trợ định vị.'); return; }
    setLocLoading(true);
    const onPos = async (pos, highAcc) => {
      try {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        if (accuracy && accuracy > 500 && highAcc) throw new Error('low-accuracy');
        setPickedCoord({ lat, lng: lon });
        await fillFromCoord(lat, lon);
        if (accuracy && accuracy > 100) {
          alert(`Đã lấy vị trí (sai số ~${Math.round(accuracy)}m). Hãy kiểm tra lại địa chỉ.`);
        }
      } catch (e) {
        if (e.message === 'low-accuracy') { tryLowAccuracy(); return; }
        alert(e.message || 'Không lấy được địa chỉ từ vị trí.');
      } finally {
        setLocLoading(false);
      }
    };
    const tryLowAccuracy = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => onPos(pos, false),
        (err) => {
          setLocLoading(false);
          const msgs = {
            1: 'Bạn đã từ chối quyền định vị. Hãy bật lại trong cài đặt trình duyệt.',
            2: 'Không xác định được vị trí. Hãy nhập địa chỉ tay.',
            3: 'Hết thời gian chờ định vị. Hãy thử lại hoặc nhập địa chỉ tay.',
          };
          alert(msgs[err.code] || 'Không lấy được vị trí. Hãy nhập địa chỉ tay.');
        },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
      );
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => onPos(pos, true),
      () => tryLowAccuracy(),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  useEffect(() => {
    if (type !== 'delivery') return;
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(calcKm, 800);
    return () => clearTimeout(geoTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, ward, province, type]);

  useEffect(() => {
    if (!phone || phone.length < 9) return;
    const fee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
    const t = setTimeout(() => {
      const payload = {
        subtotal,
        // Gói 55 p11ac: bổ sung category_id + unit_price để KM theo danh mục / đồng giá hiện được trên Mini App
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty, line_total: l.unitPrice * l.qty, category_id: l.product.category_id || null, unit_price: l.unitPrice })),
        shipping_fee: fee,
      };
      api.customerByPhone(phone, getProfile()?.member_code || '').then((c) => {
        if (c) {
          setPoints(c.points || 0);
          setCustomerId(c.id);
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

  // Đổi loại đơn: reset voucher + KM + đổi điểm (không áp dụng sang loại mới)
  const switchType = (t) => {
    setType(t);
    setPromoId('');
    setVoucher('');
    setRedeem(0);
  };

  // Validate bước 1 rồi sang tóm tắt
  const goSummary = () => {
    if (!name.trim() || !phone.trim()) { alert('Nhập tên và số điện thoại.'); return; }
    if (type === 'delivery') {
      if (!province || !ward || !street.trim()) { alert('Chọn tỉnh/thành, phường/xã và nhập số nhà, tên đường.'); return; }
      // Gói 55 p10: hẹn giờ giao — kiểm tra trong giờ mở cửa
      if (deliveryMode === 'scheduled') {
        const d = toApiDate(schedDate);
        if (!d) { alert('Nhập ngày muốn giao (dd/mm/yyyy).'); return; }
        if (!validTime(schedTime)) { alert('Nhập giờ muốn giao (HH:MM, 24h).'); return; }
        if (new Date(`${d}T${schedTime}`) <= new Date()) { alert('Giờ hẹn phải sau thời điểm hiện tại.'); return; }
        if (!isWithinOpening(branch, schedDate, schedTime)) { alert('Giờ hẹn phải trong giờ mở cửa của quán.'); return; }
      }
    }
    if (type === 'scheduled') {
      const d = toApiDate(schedDate);
      if (!d) { alert('Nhập ngày muốn tới lấy (dd/mm/yyyy).'); return; }
      if (!validTime(schedTime)) { alert('Nhập giờ muốn tới lấy (HH:MM, 24h).'); return; }
      if (new Date(`${d}T${schedTime}`) <= new Date()) { alert('Giờ hẹn phải sau thời điểm hiện tại.'); return; }
      if (!isWithinOpening(branch, schedDate, schedTime)) { alert('Giờ hẹn phải trong giờ mở cửa của quán.'); return; }
    }
    if (needVat) {
      if (!vatCode.trim() || !vatName.trim() || !vatEmail.trim()) { alert('Nhập MST, tên công ty và email để xuất hóa đơn VAT.'); return; }
      if (!/^\S+@\S+\.\S+$/.test(vatEmail.trim())) { alert('Email nhận hóa đơn chưa đúng.'); return; }
    }
    window.scrollTo(0, 0);
    setStep(2);
  };

  const place = async () => {
    let scheduledAt = null;
    if (type === 'scheduled') {
      const d = toApiDate(schedDate);
      scheduledAt = `${d}T${schedTime}`;
    }
    // Gói 55 p10: hẹn giờ giao cũng gửi scheduled_at
    if (type === 'delivery' && deliveryMode === 'scheduled') {
      const d = toApiDate(schedDate);
      scheduledAt = `${d}T${schedTime}`;
    }
    setPlacing(true);
    try {
      const order = await api.createOrder({
        // Gói 55 p11ac: idempotency key chống tạo trùng đơn khi retry
        client_key: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'zalo-' + Date.now() + '-' + Math.random().toString(36).slice(2)),
        branch_id: branch.id,
        order_type: type === 'delivery' ? 'delivery' : 'takeaway',
        customer_name: name.trim(),
        customer_phone: formatPhone(phone),
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
      setProfile({ ...(getProfile() || {}), name: name.trim(), phone: formatPhone(phone) });
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

  const typeLabel = type === 'delivery'
    ? (deliveryMode === 'scheduled' ? '📅 Hẹn giờ giao' : '🛵 Giao hàng')
    : type === 'takeaway' ? '🏃 Mang đi' : '⏰ Hẹn giờ lấy';

  return (
    <div className="zm-page">
      <div className="zm-header">
        <button className="zm-back" onClick={() => step === 2 ? setStep(1) : nav('/cart')}>←</button>
        <h1>{step === 2 ? 'Tóm tắt đơn hàng' : 'Xác nhận đơn'}</h1>
      </div>

      {/* Gói 55 p10: banner khi đóng cửa */}
      {step === 1 && isClosed && (
        <div style={{ margin: '12px 16px 0', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px 12px', fontSize: 13, color: '#991b1b' }}>
          🔴 <b>Quán đã đóng cửa</b>{st?.hours && st.hours !== 'Nghỉ hôm nay' ? ` (mở lại ${st.hours.split(' - ')[0]})` : ''}<br />
          Hiện chỉ nhận đơn hẹn giờ — hẹn từ khung giờ mở cửa gần nhất trở đi.
        </div>
      )}

      {step === 1 && (
        <>
          <div style={{ padding: '12px 16px 0' }}>
            <div className="zm-seg">
              <button className={type === 'delivery' ? 'on' : ''} disabled={isClosed} onClick={() => { switchType('delivery'); if (isClosed) setDeliveryMode('scheduled'); }}>🛵 Giao hàng</button>
              <button className={type === 'takeaway' ? 'on' : ''} disabled={isClosed} onClick={() => switchType('takeaway')}>🏃 Mang đi</button>
              <button className={type === 'scheduled' ? 'on' : ''} onClick={() => switchType('scheduled')}>⏰ Hẹn giờ lấy</button>
            </div>
          </div>

          <div style={{ padding: '0 16px' }}>
            <div className="zm-field">
              <label>Tên của bạn *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />
            </div>
            <div className="zm-field">
              <label>Số điện thoại * <span style={{ color: '#888', fontWeight: 400 }}>(để tích điểm thành viên)</span></label>
              <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="09xx xxx xxx" inputMode="tel" maxLength={12} />
            </div>

            {type === 'delivery' && (
              <>
                {/* Gói 55 p10: chọn Giao ngay / Hẹn giờ giao */}
                <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px', color: '#555' }}>HÌNH THỨC GIAO HÀNG</div>
                <div
                  onClick={() => !isClosed && setDeliveryMode('now')}
                  style={{
                    border: `2px solid ${deliveryMode === 'now' ? '#24305E' : '#e5e7eb'}`,
                    background: deliveryMode === 'now' ? '#f0f4ff' : '#fff',
                    borderRadius: 12, padding: 12, marginBottom: 8, cursor: isClosed ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10, opacity: isClosed ? 0.5 : 1,
                  }}>
                  <span style={{ fontSize: 24 }}>⚡</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Giao ngay</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{isClosed ? 'Không khả dụng khi quán đóng cửa' : 'Shipper giao luôn trong ~30 phút'}</div>
                  </div>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #d1d5db', ...(deliveryMode === 'now' ? { borderColor: '#24305E', background: '#24305E', boxShadow: 'inset 0 0 0 3px #fff' } : {}) }} />
                </div>
                <div
                  onClick={() => setDeliveryMode('scheduled')}
                  style={{
                    border: `2px solid ${deliveryMode === 'scheduled' ? '#24305E' : '#e5e7eb'}`,
                    background: deliveryMode === 'scheduled' ? '#f0f4ff' : '#fff',
                    borderRadius: 12, padding: 12, marginBottom: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  <span style={{ fontSize: 24 }}>📅</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Hẹn giờ giao</div>
                    <div style={{ fontSize: 12, color: '#888' }}>Chọn ngày giờ muốn nhận hàng</div>
                  </div>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #d1d5db', ...(deliveryMode === 'scheduled' ? { borderColor: '#24305E', background: '#24305E', boxShadow: 'inset 0 0 0 3px #fff' } : {}) }} />
                </div>
                {deliveryMode === 'scheduled' && (
                  <div style={{ background: '#f0f4ff', borderRadius: 12, padding: 12, marginBottom: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Ngày giờ muốn nhận hàng *</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}><DateField value={schedDate} onChange={setSchedDate} /></div>
                      <div style={{ width: 110 }}>
                        {timeSlots(branch, schedDate).length > 0 ? (
                          <select value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
                            style={{ width: '100%', padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
                            <option value="">Chọn giờ</option>
                            {timeSlots(branch, schedDate).map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : (
                          <TimeField value={schedTime} onChange={setSchedTime} />
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Chỉ chọn trong giờ mở cửa của quán</div>
                  </div>
                )}
                {/* Gói 55 p3: card gọn thông tin nhận hàng — bấm mở popup */}
                <div className="zm-deliv-card" onClick={() => setShowAddrPop(true)}>
                  <div className="zm-deliv-top">
                    <div className="zm-deliv-ic">📍</div>
                    <div className="zm-deliv-t">Thông tin nhận hàng</div>
                    <div className="zm-deliv-chg">Thay đổi</div>
                  </div>
                  <div className="zm-deliv-mid">
                    <div className="zm-deliv-uic">👤</div>
                    <div style={{ flex: 1 }}>
                      <div className="zm-deliv-nm">
                        {name || 'Nhập tên'} · {phone ? phone : <span className="zm-miss">Nhập số điện thoại</span>}
                      </div>
                      <div className="zm-deliv-ad">
                        {[street, wards.find((w) => String(w.code) === ward)?.name, provinces.find((pr) => String(pr.code) === province)?.name].filter(Boolean).join(', ') || 'Nhập địa chỉ'}
                      </div>
                    </div>
                    <div className="zm-deliv-arr">›</div>
                  </div>
                </div>

                {/* Gói 55 p3: popup sửa thông tin nhận hàng */}
                {showAddrPop && (
                  <div className="zm-pop-overlay" onClick={() => setShowAddrPop(false)}>
                    <div className="zm-pop-sheet" onClick={(e) => e.stopPropagation()}>
                      <h3>Thông tin nhận hàng</h3>
  {addrBook.length > 0 && (
    <div className="zm-field">
      <label>📒 Sổ địa chỉ</label>
      <select value={addrId} onChange={(e) => {
        const id = e.target.value;
        setAddrId(id);
        if (!id) return;
        const a = addrBook.find((x) => String(x.id) === id);
        if (!a) return;
        const pc = provinces.find((p) => p.name === a.province)?.code;
        if (pc) {
          setProvince(String(pc));
          loadWards(pc).then((ws) => {
            setWards(ws || []);
            const wc = (ws || []).find((w) => w.name === a.ward)?.code;
            setWard(wc ? String(wc) : '');
          });
        }
        setStreet(a.street || '');
        setPickedCoord(null);
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
    <SearchSelect
      value={province} placeholder="— Chọn tỉnh/thành —"
      options={provinces.map((p) => ({ code: p.code, name: p.name }))}
      onChange={(c) => { setProvince(c); setAddrId(''); setPickedCoord(null); }}
    />
  </div>
  <div className="zm-field">
    <label>Phường / Xã *</label>
    <SearchSelect
      value={ward} placeholder="— Chọn phường/xã —" disabled={!province}
      options={wards.map((w) => ({ code: w.code, name: w.name }))}
      onChange={(c) => { setWard(c); setPickedCoord(null); }}
    />
  </div>
  <div className="zm-field" style={{ position: 'relative' }}>
    <label>Số nhà, tên đường *</label>
    <input
      value={street}
      onChange={(e) => { setStreet(e.target.value); setPickedCoord(null); }}
      placeholder="VD: 123 Nguyễn Huệ"
      autoComplete="off"
    />
    {(suggestLoading || suggests.length > 0) && (
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 50,
        background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto',
      }}>
        {suggestLoading && <div style={{ padding: 12, fontSize: 13, color: '#999' }}>🔍 Đang tìm địa chỉ...</div>}
        {suggests.map((s, i) => (
          <div
            key={i}
            onClick={() => pickSuggest(s)}
            style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
          >
            <div style={{ fontWeight: 600 }}>📍 {s.short}</div>
            <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
    )}
  </div>
  {geoLoading && <div className="zm-note">📍 Đang tự động tính khoảng cách...</div>}
  {km != null && shipCfg && (
    <div className="zm-alert">📏 Khoảng cách ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b> (tự động tính)</div>
  )}
  {geoError && (
    <div className="zm-alert" style={{ background: '#fef3c7', borderColor: '#fcd34d' }}>
      ⚠️ Không tự tính được khoảng cách. Quán sẽ xác nhận phí ship qua điện thoại.
      <button type="button" onClick={calcKm} style={{ marginLeft: 8, textDecoration: 'underline', color: '#b45309' }}>Tính lại</button>
    </div>
  )}
  <div className="zm-field">
    <label>Ghi chú giao hàng</label>
    <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="VD: gọi trước khi tới, để ở bảo vệ..." />
  </div>
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
                      {/* Gói 55 p3: nút vị trí hiện tại */}
                      <button type="button" className="zm-loc-btn" onClick={useCurrentLocation} disabled={locLoading}>
                        📍 {locLoading ? 'Đang lấy vị trí...' : 'Vị trí hiện tại'}
                      </button>
                      <p className="zm-loc-hint">Bấm "Vị trí hiện tại" để tự điền địa chỉ và tính phí ship chính xác, hoặc nhập tay rồi bấm Lưu.</p>
                      <button className="zm-btn-primary zm-pop-save" onClick={() => setShowAddrPop(false)}>Lưu</button>
                    </div>
                  </div>
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
            {/* Gói 55 p11ac: PTTT động từ cấu hình */}
            {(payMethods.length ? payMethods : [
              { value: 'transfer', label: 'Chuyển khoản / QR', desc: 'Quán xác nhận đã nhận tiền rồi mới làm món' },
              { value: 'pay_at_store', label: 'Thanh toán tại quán', desc: 'Trả tiền khi nhận món' },
            ]).map((m) => (
              <div key={m.value} className={`zm-pay-opt ${payment === m.value ? 'on' : ''}`} onClick={() => setPayment(m.value)}>
                <div className="dot" /><div><b>{m.label}</b><div style={{ fontSize: 12, color: '#888' }}>{m.desc}</div></div>
              </div>
            ))}

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
          </div>

          <div className="zm-cartbar">
            <button className="zm-btn-primary" onClick={goSummary}>
              Tiếp tục · {fmt(total)}đ →
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <div style={{ padding: '12px 16px 100px' }}>
          {/* Món đã đặt */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>🧾 Món đã đặt ({cart.reduce((s, l) => s + l.qty, 0)})</div>
            {cart.map((l, i) => (
              <div key={i} style={{ padding: '6px 0', borderTop: i ? '1px dashed #f0f0f0' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span><b>{l.qty}×</b> {l.product.name}</span>
                  <b>{fmt(l.unitPrice * l.qty)}đ</b>
                </div>
                {/* Gói 50h: mỗi nhóm tùy chọn một dòng */}
                {l.optGroups && l.optGroups.length > 0
                  ? l.optGroups.map((g, j) => (
                      <div key={j} style={{ fontSize: 12, color: '#888', paddingLeft: 12 }}>
                        + {g.name}: {g.opts.join(', ')}
                      </div>
                    ))
                  : l.optText && <div style={{ fontSize: 12, color: '#888', paddingLeft: 12 }}>+ {l.optText}</div>
                }
                {l.note && <div style={{ fontSize: 12, color: '#888', paddingLeft: 12, fontStyle: 'italic' }}>📝 {l.note}</div>}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingTop: 8, borderTop: '1px solid #eee', marginTop: 4 }}>
              <span>Tạm tính</span><b>{fmt(subtotal)}đ</b>
            </div>
          </div>

          {/* Thông tin giao hàng */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{typeLabel}</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: '#444' }}>
              <div>👤 {name} · {phone}</div>
              {type === 'delivery' && (
                <>
                  <div>📍 {fullAddress()}</div>
                  {deliveryNote.trim() && <div>📝 {deliveryNote.trim()}</div>}
                  <div>📏 Khoảng cách: {km != null ? `~${km}km` : 'quán xác nhận'}</div>
                </>
              )}
              {type === 'scheduled' && <div>⏰ Hẹn lấy: {schedDate} {schedTime}</div>}
              {type === 'delivery' && deliveryMode === 'scheduled' && <div>📅 Hẹn giao: {schedDate} {schedTime}</div>}
              {type === 'takeaway' && <div>🏪 Nhận tại: {branch.name}</div>}
              <div>💳 {payment === 'transfer' ? 'Chuyển khoản / QR' : 'Thanh toán tại quán'}</div>
              {needVat && <div>🧾 VAT: {vatName} ({vatCode})</div>}
            </div>
          </div>

          {/* Phí & tổng */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>💰 Chi tiết thanh toán</div>
            {type === 'delivery' && (
              <div className="zm-total-row">
                <span>Phí vận chuyển{km != null ? ` (~${km}km)` : ''}</span>
                <span>{km != null ? `${fmt(shipFee)}đ` : 'Quán xác nhận'}</span>
              </div>
            )}
            {shipDisc > 0 && <div className="zm-total-row disc"><span>🚚 KM phí vận chuyển</span><span>−{fmt(shipDisc)}đ</span></div>}
            {promoDisc > 0 && <div className="zm-total-row disc"><span>🎉 {promo?.name}</span><span>−{fmt(promoDisc)}đ</span></div>}
            {pointDisc > 0 && <div className="zm-total-row disc"><span>⭐ Đổi điểm</span><span>−{fmt(pointDisc)}đ</span></div>}
            <div className="zm-total-row grand"><span>Tổng cộng</span><span>{fmt(total)}đ</span></div>
          </div>

          <div className="zm-cartbar" style={{ display: 'flex', gap: 8 }}>
            <button className="zm-btn-primary" style={{ flex: 1, background: '#e8eaf0', color: '#24305E' }} onClick={() => setStep(1)}>
              ← Sửa
            </button>
            <button className="zm-btn-primary" style={{ flex: 2 }} disabled={placing} onClick={place}>
              {placing ? 'Đang đặt...' : `Đặt hàng · ${fmt(total)}đ`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
