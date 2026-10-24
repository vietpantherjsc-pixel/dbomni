import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, fmt, getProfile, setProfile, getRef, profileIdentity } from '../api';
import { storage } from '../utils/storage';
import SearchSelect from '../components/SearchSelect';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';
import { openStatus, nextOpenSlot, timeSlots, isWithinOpening } from '../utils/openingHours';
import { DateField, TimeField, toApiDate, validTime, formatPhone } from '../utils/checkoutFields.jsx';
import { useShop } from '../store';

// Gói 50d: luồng 2 bước — (1) nhập thông tin, (2) tóm tắt đơn hàng rồi mới đặt.
// Không chặn đặt hàng khi geocode thất bại: hiện cảnh báo, phí ship quán xác nhận sau.

// Gói 55 p11ac: tỉnh/thành qua backend proxy (Zalo WebView chặn domain lạ)
const loadProvinces = () => api.provinces().catch(() => []);
const loadWards = (code) => api.wards(code).catch(() => []);

export default function Checkout() {
  const { branch, cart, subtotal, clearCart } = useShop();
  const nav = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(1); // 1: nhập thông tin, 2: tóm tắt đơn
  // SPEC-02: coupon từ ví (Coupons.jsx "Dùng ngay" truyền qua navigation state)
  const [selectedCouponId, setSelectedCouponId] = useState(location.state?.couponId || null);
  const [myCoupons, setMyCoupons] = useState([]);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponIsShipping, setCouponIsShipping] = useState(false);
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
  // SPEC-01: cấu hình thanh toán Zalo (BANK/COD qua Checkout SDK)
  const [zaloCfg, setZaloCfg] = useState(null);
  const [zaloCfgFailed, setZaloCfgFailed] = useState(false); // 🟠15: phân biệt "lỗi tải" với "chưa tải"
  const [payChannel, setPayChannel] = useState('BANK'); // BANK | COD
  useEffect(() => {
    api.zaloPayConfig().then(setZaloCfg).catch(() => setZaloCfgFailed(true));
  }, []);
  // Audit 2026-10-21 🟠11: kênh mặc định TỰ HIỆU CHỈNH theo cấu hình thật — quán tắt BANK
  // (hoặc thiếu thông tin NH) mà khách không tự chọn COD thì trước đây place() vẫn gửi
  // BANK → 422 oan dù COD đang mở.
  useEffect(() => {
    if (!zaloCfg) return;
    setPayChannel((cur) => {
      if (cur === 'BANK' && !zaloCfg.bank_available && zaloCfg.cod_enabled) return 'COD';
      if (cur === 'COD' && !zaloCfg.cod_enabled && zaloCfg.bank_available) return 'BANK';
      return cur;
    });
  }, [zaloCfg]);
  // SPEC-02: nạp ví coupon của khách
  // Spec KM chống mã (2026-10-21) Phần B: nạp bằng định danh SĐT + mã TV (không dùng customer_id trần)
  useEffect(() => {
    const profile = getProfile();
    if (profile?.customer_id) {
      api.myCoupons(profileIdentity(profile), 'active').then(setMyCoupons).catch(() => {});
    }
  }, []);
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
  // Audit 2026-10-21 🟠8: kết quả validate voucher từ SERVER (số giảm thật để vào tổng hiển thị)
  const [voucherInfo, setVoucherInfo] = useState(null); // {code, name, discount}
  const [points, setPoints] = useState(0);
  // Loyalty 2.0: không còn đổi điểm trực tiếp tại checkout — điểm chỉ đổi
  // coupon ở Cửa hàng điểm (trang Tài khoản).
  // Gói 64: bỏ tick VAT trên Mini App (hóa đơn đã kèm mã QR) — giữ state rỗng để không gãy code cũ
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
  // Gói 60: báo giá giao hàng live từ hãng (AhaMove/Lalamove qua backend)
  const [quote, setQuote] = useState(null); // {packages:[{code,name,fee,customer_pays,shop_support,provider...}], ...}
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [deliveryPkg, setDeliveryPkg] = useState('nhanh'); // gói khách chọn
  const [deliveryReady, setDeliveryReady] = useState(false); // backend đã cấu hình hãng giao hàng
  const quoteTimer = useRef(null);
  // Audit UX 2026-10-21 (hạng 3): client_key CỐ ĐỊNH theo phiên giỏ — sinh 1 lần khi
  // giỏ thay đổi, KHÔNG sinh lại mỗi lần bấm Đặt hàng (bấm lại sau timeout mạng phải
  // dùng key cũ để server nhận diện trùng, tránh tạo 2 đơn).
  const newClientKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'zalo-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const clientKeyRef = useRef(null);
  const cartSig = JSON.stringify({
    b: branch?.id || null,
    items: cart.map((l) => [l.product.id, l.optionId || 0, (l.optionIds || []).join(','), l.qty, l.unitPrice]),
  });
  useEffect(() => { clientKeyRef.current = newClientKey(); }, [cartSig]);
  // Audit UX 2026-10-21 (hạng 6): bản gương mới nhất của báo giá — place() đọc qua ref
  // để tự chờ quote xong rồi đặt tiếp, thay vì chặn bắt khách bấm lại.
  const quoteLiveRef = useRef({ loading: false, pkg: null, code: 'nhanh' });
  useEffect(() => {
    api.deliveryConfig().then((c) => setDeliveryReady(!!c?.ready)).catch(() => {});
  }, []);
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

  // Gói 60: gọi báo giá live khi có địa chỉ giao đầy đủ (debounce 1s).
  // Quá 8s chưa có kết quả → dùng phí nội bộ cũ (không chặn đặt đơn quá lâu).
  useEffect(() => {
    if (type !== 'delivery') { setQuote(null); setQuoteError(''); return; }
    if (!branch?.id || !street.trim() || !ward || !province) { setQuote(null); setQuoteError(''); return; }
    clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      setQuoteLoading(true); setQuoteError('');
      const addr = fullAddress();
      const timeoutMs = 8000;
      try {
        const data = await Promise.race([
          api.deliveryQuote({
            branch_id: branch.id,
            dropoff_address: addr,
            dropoff_lat: pickedCoord?.lat || null,
            dropoff_lng: pickedCoord?.lng || null,
            subtotal,
            cod_amount: payment === 'pay_at_store' ? subtotal : 0,
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
        ]);
        setQuote(data);
        // Mặc định gói Nhanh (rẻ nhất) theo quyết định đã chốt
        const hasNhanh = (data.packages || []).some((p) => p.code === 'nhanh');
        setDeliveryPkg(hasNhanh ? 'nhanh' : (data.packages[0]?.code || 'nhanh'));
      } catch (e) {
        // Hãng không báo được giá → fallback phí nội bộ cũ; nếu cũng không có thì báo lỗi
        setQuote(null);
        setQuoteError(e.message === 'timeout'
          ? 'Đang tính phí ship — vui lòng đợi giây lát.'
          : (e.message || 'Chưa giao được tới địa chỉ này.'));
      } finally {
        setQuoteLoading(false);
      }
    }, 1000);
    return () => clearTimeout(quoteTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, ward, province, type, branch?.id, subtotal, payment]);

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
      // Audit 2026-10-21 🟠10 (phía FE): tra khách lỗi (mạng/422 cũ) KHÔNG được nuốt
      // luôn danh sách KM — rơi về khách vãng lai để KM công khai vẫn hiện.
      api.customerByPhone(phone, getProfile()?.member_code || '').catch(() => null).then((c) => {
        if (c) {
          setPoints(c.loyalty?.points ?? c.points ?? 0);
          setCustomerId(c.id);
          api.addresses(c.id, c.phone, c.member_code).then((r) => setAddrBook(r?.data || [])).catch(() => {});
          return api.eligiblePromotions({ ...payload, customer_id: c.id, phone: formatPhone(phone), member_code: getProfile()?.member_code || '' });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setPromos).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [phone, subtotal, km, shipCfg, type]);

  // Gói 60: phí ship ưu tiên từ báo giá live của hãng (đã trừ phần quán hỗ trợ);
  // chưa có báo giá thì dùng cách tính nội bộ cũ.
  const quotePkg = quote?.packages?.find((p) => p.code === deliveryPkg) || quote?.packages?.[0];
  const shipFee = type === 'delivery'
    ? (quotePkg ? quotePkg.customer_pays : (km != null && shipCfg ? calcShipFee(km, shipCfg) : 0))
    : 0;
  const shipShopSupport = quotePkg ? quotePkg.shop_support : 0;
  useEffect(() => {
    quoteLiveRef.current = { loading: quoteLoading, pkg: quotePkg || null, code: deliveryPkg };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteLoading, quote, deliveryPkg]);
  const promo = promos.find((p) => String(p.id) === String(promoId));
  const isShipPromo = !!(promo && (promo.is_shipping || promo.type === 'shipping') && type === 'delivery');
  const shipDisc = isShipPromo ? Math.min(Number(promo.discount) || 0, shipFee) : 0;
  const promoDisc = promo && !isShipPromo ? Number(promo.discount) : 0;
  // Audit toàn diện 2026-10-21 🟠8: voucher gõ tay PHẢI vào tổng hiển thị (số giảm do
  // server validate). Luật phía thắng giống server khi không cộng dồn: phía tiền hàng
  // chỉ trừ MỨC LỚN HƠN giữa (KM + coupon tiền hàng) và voucher — hòa thì KM thắng
  // (đúng luật hòa đã chốt); khi quán bật cộng dồn, server cộng thêm và tổng thật chỉ
  // thấp hơn số hiển thị, không bao giờ cao hơn.
  const couponMoneyDisc = couponIsShipping ? 0 : couponDiscount;
  const couponShipDisc = couponIsShipping ? couponDiscount : 0;
  const shipDiscTotal = shipDisc + couponShipDisc;
  const kmMoneyDisc = promoDisc + couponMoneyDisc;
  const voucherDisc = voucherInfo ? Number(voucherInfo.discount) || 0 : 0;
  const voucherWins = voucherDisc > 0 && voucherDisc > kmMoneyDisc;
  const moneyDiscTotal = voucherDisc > 0 ? Math.max(kmMoneyDisc, voucherDisc) : kmMoneyDisc;
  // Loyalty 2.0: bỏ pointDisc — tổng không còn dòng trừ điểm (điểm chỉ đổi
  // coupon ở Cửa hàng điểm, coupon áp như coupon ví bình thường ở trên).
  const total = Math.max(0, subtotal + shipFee - shipDiscTotal - moneyDiscTotal);
  const selectedCoupon = myCoupons.find((c) => String(c.id) === String(selectedCouponId)) || null;

  // Audit UX 2026-10-21 (hạng 1): validate coupon dùng chung cho chọn tay lẫn coupon
  // chọn sẵn từ ví ("Dùng ngay") — trước đây preselect không được validate nên giảm = 0đ.
  // Spec KM chống mã (2026-10-21): số giảm do SERVER tính theo phạm vi (discountFor) —
  // frontend không tự tính % nữa; gửi kèm items + phí ship + định danh SĐT/mã TV.
  const validatedCouponRef = useRef(null);
  const applyCoupon = async (cid) => {
    if (!cid) { setCouponDiscount(0); setCouponIsShipping(false); validatedCouponRef.current = null; return; }
    try {
      const prof = getProfile() || {};
      const res = await api.validateCoupon({
        // Audit 2026-10-21 🟠13: dùng SĐT TRONG FORM (cùng số sẽ gửi khi đặt đơn) —
        // trước đây lấy SĐT profile nên khách sửa SĐT ở form là validate báo OK nhưng
        // đặt đơn bị server từ chối "Coupon không thuộc về bạn" ở bước cuối.
        phone: formatPhone(phone || '') || prof.phone || '',
        member_code: prof.member_code || '',
        coupon_id: Number(cid),
        subtotal,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty, line_total: l.unitPrice * l.qty, category_id: l.product.category_id || null, unit_price: l.unitPrice })),
        shipping_fee: shipFee,
        channel: 'online',
      });
      setCouponDiscount(Math.round(Number(res.discount) || 0));
      setCouponIsShipping(!!res.is_shipping);
      validatedCouponRef.current = Number(cid);
    } catch (err) {
      alert(err.message || 'Coupon không hợp lệ.');
      setSelectedCouponId(null);
      setCouponDiscount(0);
      setCouponIsShipping(false);
      validatedCouponRef.current = null;
    }
  };
  // Tự validate coupon chọn sẵn ngay khi ví coupon nạp xong
  useEffect(() => {
    if (!selectedCouponId || myCoupons.length === 0) return;
    if (validatedCouponRef.current === Number(selectedCouponId)) return;
    if (!myCoupons.some((c) => String(c.id) === String(selectedCouponId))) return;
    setPromoId('');
    applyCoupon(selectedCouponId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCouponId, myCoupons]);

  // Audit 2026-10-21 🟠8: validate voucher gõ tay bằng endpoint server — trả về true nếu
  // mã dùng được (đã set voucherInfo). Lỗi thì báo rõ lý do như server sẽ nói khi chốt đơn.
  const checkVoucher = async (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c) { setVoucherInfo(null); return true; }
    try {
      const prof = getProfile() || {};
      const res = await api.validateVoucher({
        code: c,
        subtotal,
        phone: formatPhone(phone || '') || prof.phone || '',
        member_code: prof.member_code || '',
      });
      setVoucherInfo({ code: res.code, name: res.name, discount: Math.round(Number(res.discount) || 0) });
      return true;
    } catch (err) {
      setVoucherInfo(null);
      alert(err.message || 'Mã voucher không hợp lệ.');
      return false;
    }
  };
  // Giỏ đổi (subtotal đổi) mà đã áp voucher → tính lại số giảm lặng lẽ; hết hiệu lực thì gỡ.
  const voucherSubtotalRef = useRef(null);
  useEffect(() => {
    if (!voucherInfo) { voucherSubtotalRef.current = null; return; }
    if (voucherSubtotalRef.current === subtotal) return;
    voucherSubtotalRef.current = subtotal;
    checkVoucher(voucherInfo.code).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, voucherInfo]);

  // Đổi loại đơn: reset voucher + KM (không áp dụng sang loại mới)
  const switchType = (t) => {
    setType(t);
    setPromoId('');
    setVoucher('');
    setVoucherInfo(null);
  };

  // Validate bước 1 rồi sang tóm tắt
  const goSummary = async () => {
    if (!name.trim() || !phone.trim()) { alert('Nhập tên và số điện thoại.'); return; }
    // 🟠8: có mã voucher chưa validate (hoặc khác mã đã validate) → validate trước khi
    // sang bước 2 để tổng hiển thị ở bước 2 đã gồm số giảm/không gồm mã sai.
    const vcode = voucher.trim().toUpperCase();
    if (vcode && vcode !== (voucherInfo?.code || '')) {
      const ok = await checkVoucher(vcode);
      if (!ok) return;
    }
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
    // Gói 64: bỏ validate VAT (không còn tick VAT trên Mini App)
    window.scrollTo(0, 0);
    setStep(2);
  };

  const place = async () => {
    if (placing) return;
    setPlacing(true);
    try {
      // Audit UX 2026-10-21 (hạng 6): đang tính phí ship thì TỰ CHỜ quote xong (tối đa 10s)
      // rồi đặt tiếp — không chặn bắt khách bấm lại như trước.
      if (type === 'delivery') {
        let waited = 0;
        while (quoteLiveRef.current.loading && waited < 10000) {
          await new Promise((r) => setTimeout(r, 300));
          waited += 300;
        }
      }
      const livePkg = type === 'delivery' ? quoteLiveRef.current.pkg : null;
      // Gói 60: đã cấu hình hãng mà báo giá lỗi và không có phí dự phòng → chặn (checklist #5)
      if (type === 'delivery' && deliveryReady && !livePkg && km == null) {
        alert('Chưa giao được tới địa chỉ này. Vui lòng thử địa chỉ khác hoặc chọn nhận tại quán.');
        return;
      }
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
      // SPEC-01: dùng checkout-orders + Checkout SDK khi có cấu hình Zalo
      const useZaloPay = !!zaloCfg;
      // Audit 2026-10-21 🟠15: KHÔNG rơi vào "đường mù STK" — tải cấu hình thanh toán
      // lỗi mà khách chọn Chuyển khoản qua đường thường thì đơn sẽ không có nơi hiện
      // STK/nội dung CK. Báo rõ để khách chọn: thử lại (tải lại trang) hoặc tiếp tục
      // và quán sẽ liên hệ hướng dẫn chuyển khoản.
      if (!useZaloPay && payment === 'transfer') {
        const cont = window.confirm(zaloCfgFailed
          ? 'Chưa tải được thông tin chuyển khoản của quán (có thể do mạng chập chờn). Nếu tiếp tục, quán sẽ liên hệ hướng dẫn chuyển khoản sau khi nhận đơn.\n\nBấm OK để vẫn đặt đơn, hoặc Cancel để quay lại chọn cách thanh toán khác / thử tải lại trang.'
          : 'Đơn chuyển khoản này sẽ được quán xác nhận và hướng dẫn thông tin chuyển khoản sau khi nhận đơn.\n\nBấm OK để tiếp tục đặt đơn.');
        if (!cont) return;
      }
      // 🟠11 (phòng race): kênh đã chọn không còn khả dụng theo cấu hình vừa tải → tự đổi
      let effChannel = payChannel;
      if (useZaloPay) {
        if (effChannel === 'BANK' && !zaloCfg.bank_available && zaloCfg.cod_enabled) effChannel = 'COD';
        if (effChannel === 'COD' && !zaloCfg.cod_enabled && zaloCfg.bank_available) effChannel = 'BANK';
        if (effChannel !== payChannel) setPayChannel(effChannel);
      }
      const orderPayload = {
        // Audit UX 2026-10-21 (hạng 3): client_key cố định theo phiên giỏ (xem clientKeyRef)
        client_key: clientKeyRef.current || newClientKey(),
        branch_id: branch.id,
        order_type: type === 'delivery' ? 'delivery' : 'takeaway',
        customer_name: name.trim(),
        customer_phone: formatPhone(phone),
        // Spec KM chống mã Phần B: mã TV để server xác thực quyền lợi (điểm/coupon/hạng)
        member_code: getProfile()?.member_code || null,
        delivery_address: type === 'delivery' ? fullAddress() : null,
        province: type === 'delivery' ? provName() : null,
        ward: type === 'delivery' ? wardName() : null,
        distance_km: type === 'delivery' ? km : null,
        delivery_note: type === 'delivery' && deliveryNote.trim() ? deliveryNote.trim() : null,
        // Gói 60: gói giao hàng khách chọn + phí đã khóa lúc chốt đơn (checklist #6)
        // (đọc từ quoteLiveRef — bản mới nhất sau khi chờ quote, tránh closure cũ)
        delivery_package: type === 'delivery' ? (quoteLiveRef.current.code || deliveryPkg) : null,
        delivery_quoted_fee: type === 'delivery' && livePkg ? livePkg.fee : null,
        delivery_provider: type === 'delivery' ? livePkg?.provider || null : null,
        // Gói 61b: tọa độ điểm giao để hãng báo giá/tạo đơn chính xác
        delivery_dropoff_lat: type === 'delivery' ? pickedCoord?.lat || null : null,
        delivery_dropoff_lng: type === 'delivery' ? pickedCoord?.lng || null : null,
        scheduled_at: scheduledAt,
        payment_method: useZaloPay ? (effChannel === 'BANK' ? 'transfer' : 'pay_at_store') : payment,
        // SPEC-01: kênh thanh toán Zalo
        ...(useZaloPay ? { pay_channel: effChannel } : {}),
        voucher_code: voucher.trim() || null,
        promotion_id: promoId || null,
        // SPEC-02: coupon từ ví (thay thế promotion_id khi có)
        customer_coupon_id: selectedCouponId ? Number(selectedCouponId) : null,
        // Loyalty 2.0: không gửi points_redeem nữa (điểm chỉ đổi coupon ở Cửa hàng điểm)
        // Gói 64: không gửi yêu cầu VAT cho đơn online nữa (giữ null)
        note: note.trim() || null,
        referred_by: getRef() || null,
        items: cart.map((l) => ({
          product_id: l.product.id,
          product_option_id: l.optionId || null,
          option_ids: l.optionIds || [],
          quantity: l.qty,
          note: [l.optText, l.note].filter(Boolean).join(' | ') || null,
        })),
      };

      let order;
      let sdkParams = null;
      let bankTransfer = null;
      if (useZaloPay) {
        // SPEC-01: tạo đơn qua checkout-orders → nhận SDK params
        const res = await api.checkoutOrder(orderPayload);
        order = res.order;
        sdkParams = res.sdk_params;
        // Spec QR 2026-10-21: giữ thông tin CK để hiện màn "Chờ thanh toán"
        if (effChannel === 'BANK' && res.bank_info) {
          bankTransfer = {
            bank_info: res.bank_info,
            transfer_content: res.transfer_content,
            vietqr_payload: res.vietqr_payload || null,
            amount: Math.round(Number(order.total_amount) || 0),
          };
        }
      } else {
        order = await api.createOrder(orderPayload);
      }

      // Audit UX 2026-10-21 (hạng 2): lưu customer_id + member_code vào profile sau đơn đầu
      // → lần sau tra được khách: sổ địa chỉ / điểm / coupon tự nạp, không nhập lại từ đầu.
      const prof = { ...(getProfile() || {}), name: name.trim(), phone: formatPhone(phone) };
      if (order?.customer?.id) prof.customer_id = order.customer.id;
      else if (order?.customer_id) prof.customer_id = order.customer_id;
      if (order?.customer?.member_code) prof.member_code = order.customer.member_code;
      setProfile(prof);
      // Audit UX 2026-10-21 (hạng 11): lưu mã đơn gần nhất để trang Theo dõi hiện sẵn
      try { storage.set('zm_last_order', order.code); } catch { /* bỏ qua */ }
      if (type === 'delivery' && customerId && saveAddr && !addrId) {
        api.saveAddress({
          customer_id: customerId, phone: formatPhone(phone), member_code: getProfile()?.member_code || '',
          label: addrLabel,
          province: provName(), ward: wardName(), street: street.trim(),
        }).catch(() => {});
      }
      clearCart();

      // SPEC-01: mở Checkout SDK nếu có (trong Zalo client)
      if (sdkParams && typeof window !== 'undefined') {
        try {
          // Thử dùng zmp-sdk nếu có, fallback sang ZaloJSBridge
          let Payment = null;
          try {
            const zmp = await import('zmp-sdk');
            Payment = zmp.Payment;
          } catch {
            // zmp-sdk chưa load được, thử ZaloJSBridge
          }
          if (Payment && Payment.createOrder) {
            await Payment.createOrder(sdkParams);
          } else if (window.ZaloJSBridge && window.ZaloJSBridge.call) {
            // Fallback: gọi trực tiếp qua bridge
            window.ZaloJSBridge.call('Payment.createOrder', sdkParams);
          }
          // Sau khi SDK đóng, chuyển sang trang kết quả (trạng thái đơn cập nhật qua notify)
        } catch (sdkErr) {
          console.warn('Không mở được Checkout SDK:', sdkErr);
          // Spec QR 2026-10-21: SDK thất bại → rơi về màn hình hướng dẫn CK tay
          // (khối dưới điều hướng BANK sang /pay-wait), không còn Success im lặng.
        }
      }

      // Spec QR 2026-10-21: đơn BANK (phương án A) luôn kết thúc ở màn "Chờ thanh toán"
      // — khách cần STK/QR + nút báo CK; NV xác nhận tay sau khi đối chiếu sao kê.
      if (bankTransfer) {
        nav(`/pay-wait/${order.code}`, { state: { transfer: bankTransfer } });
      } else {
        nav(`/success/${order.code}`);
      }
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
  {/* Gói 60: chọn gói giao hàng từ báo giá live của hãng */}
  {type === 'delivery' && quoteLoading && (
    <div className="zm-note">🛵 Đang tính phí ship từ hãng giao hàng...</div>
  )}
  {type === 'delivery' && !quoteLoading && quote?.packages?.length > 0 && (
    <div className="zm-field">
      <label>Chọn gói giao hàng</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quote.packages.map((p) => (
          <button
            key={p.code + p.provider}
            type="button"
            onClick={() => setDeliveryPkg(p.code)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 10, fontSize: 13, textAlign: 'left',
              border: deliveryPkg === p.code ? '2px solid #24305E' : '1px solid #e0e0e0',
              background: deliveryPkg === p.code ? '#eef2ff' : '#fff',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{p.code === 'nhanh' ? '🛵 Nhanh' : '⚡ Siêu Tốc'} <span style={{ color: '#888', fontWeight: 400 }}>· {p.provider_label}</span></div>
              <div style={{ color: '#666', fontSize: 12 }}>{p.eta_text}{p.shop_support > 0 ? ` · Quán hỗ trợ ${fmt(p.shop_support)}đ` : ''}</div>
            </div>
            <div style={{ fontWeight: 700, color: '#24305E' }}>{fmt(p.customer_pays)}đ</div>
          </button>
        ))}
      </div>
    </div>
  )}
  {type === 'delivery' && !quoteLoading && quoteError && !quote?.packages?.length && km == null && (
    <div className="zm-alert" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
      ⚠️ {quoteError}
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
            {/* SPEC-01: Thanh toán qua Checkout SDK (BANK/COD) */}
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
              🔒 Thanh toán an toàn qua Zalo
            </div>
            {zaloCfg ? (
              <>
                {/* Spec QR 2026-10-21: BANK chỉ hiện khi cấu hình NH + private key sẵn sàng (bank_available) — ẩn kênh chết */}
                {(zaloCfg.bank_available ?? zaloCfg.bank_enabled) && (
                  <div className={`zm-pay-opt ${payChannel === 'BANK' ? 'on' : ''}`} onClick={() => setPayChannel('BANK')}>
                    <div className="dot" /><div><b>Chuyển khoản</b><div style={{ fontSize: 12, color: '#888' }}>Quét QR / chuyển khoản qua Zalo</div></div>
                  </div>
                )}
                {zaloCfg.cod_enabled && (
                  <div
                    className={`zm-pay-opt ${payChannel === 'COD' ? 'on' : ''} ${zaloCfg.cod_takeaway_only && type === 'delivery' ? 'disabled' : ''}`}
                    onClick={() => {
                      if (zaloCfg.cod_takeaway_only && type === 'delivery') return;
                      setPayChannel('COD');
                    }}
                    style={zaloCfg.cod_takeaway_only && type === 'delivery' ? { opacity: 0.5 } : {}}
                  >
                    <div className="dot" /><div><b>Trả tại quán</b><div style={{ fontSize: 12, color: '#888' }}>
                      {zaloCfg.cod_takeaway_only && type === 'delivery' ? 'Chỉ áp dụng mang về/hẹn giờ' : 'Trả tiền khi nhận món'}
                    </div></div>
                  </div>
                )}
              </>
            ) : (
              /* Fallback luồng cũ khi chưa có cấu hình */
              (payMethods.length ? payMethods : [
                { value: 'transfer', label: 'Chuyển khoản / QR', desc: 'Quán xác nhận đã nhận tiền rồi mới làm món' },
                { value: 'pay_at_store', label: 'Thanh toán tại quán', desc: 'Trả tiền khi nhận món' },
              ]).map((m) => (
                <div key={m.value} className={`zm-pay-opt ${payment === m.value ? 'on' : ''}`} onClick={() => setPayment(m.value)}>
                  <div className="dot" /><div><b>{m.label}</b><div style={{ fontSize: 12, color: '#888' }}>{m.desc}</div></div>
                </div>
              ))
            )}

            {/* Gói 64: bỏ tick xuất VAT trên Mini App (hóa đơn đã kèm mã QR cho khách quét nhập thông tin) */}

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

            {/* SPEC-02: chọn coupon từ ví (1 hóa đơn = 1 coupon) */}
            {myCoupons.length > 0 && (
              <div className="zm-field">
                <label>🎫 Coupon của tôi (chọn 1)</label>
                <select
                  value={selectedCouponId || ''}
                  onChange={(e) => {
                    const cid = e.target.value || null;
                    setSelectedCouponId(cid);
                    // Nếu chọn coupon ví thì bỏ KM chung (quy tắc 1 hóa đơn = 1 coupon)
                    if (cid) setPromoId('');
                    applyCoupon(cid);
                  }}
                >
                  <option value="">Không dùng coupon</option>
                  {myCoupons.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.promotion?.name} ({c.code})
                    </option>
                  ))}
                </select>
                {selectedCouponId && couponDiscount > 0 && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4, fontWeight: 700 }}>
                    Giảm {fmt(couponDiscount)}đ từ coupon
                  </div>
                )}
              </div>
            )}
            <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>🎟️ Mã giảm giá</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="zm-field" style={{ margin: 0, flex: 1 }}>
                  <input value={voucher} onChange={(e) => { setVoucher(e.target.value); setVoucherInfo(null); }} placeholder="NHẬP MÃ NẾU CÓ" style={{ textTransform: 'uppercase' }} />
                </div>
                {/* 🟠8: nút Áp dụng — validate server ngay để số giảm vào tổng hiển thị */}
                <button type="button" className="zm-btn-primary" style={{ padding: '0 14px', fontSize: 13 }}
                  onClick={() => checkVoucher(voucher)}>
                  Áp dụng
                </button>
              </div>
              {voucherInfo && (
                <div style={{ fontSize: 12, color: '#16a34a', marginTop: 6, fontWeight: 700 }}>
                  ✅ {voucherInfo.code}: giảm {fmt(voucherInfo.discount)}đ{voucherWins ? '' : (kmMoneyDisc > 0 ? ' — KM hiện tại giảm nhiều hơn nên hệ thống sẽ áp KM (voucher không bị trừ lượt)' : '')}
                </div>
              )}
            </div>
            {points > 0 && (
              <div style={{ background: '#fff7e6', border: '1px solid #ffe1a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                ⭐ Bạn có <b>{fmt(points)} điểm</b> — đổi coupon tại mục <b>Tài khoản › Cửa hàng điểm</b>{' '}
                <span onClick={() => nav('/account')} style={{ color: 'var(--zm-primary)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Đi đổi ngay ›</span>
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
              {/* Gói 64: bỏ hiển thị VAT trên tóm tắt đơn */}
            </div>
          </div>

          {/* Phí & tổng */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>💰 Chi tiết thanh toán</div>
            {type === 'delivery' && (
              <div className="zm-total-row">
                <span>Phí vận chuyển{quotePkg ? ` (${quotePkg.code === 'nhanh' ? 'Nhanh' : 'Siêu Tốc'} · ${quotePkg.provider_label})` : km != null ? ` (~${km}km)` : ''}</span>
                <span>{quotePkg || km != null ? `${fmt(shipFee)}đ` : 'Quán xác nhận'}</span>
              </div>
            )}
            {type === 'delivery' && shipShopSupport > 0 && (
              <div className="zm-total-row disc"><span>🏪 Quán hỗ trợ phí ship</span><span>−{fmt(shipShopSupport)}đ</span></div>
            )}
            {shipDisc > 0 && <div className="zm-total-row disc"><span>🚚 KM phí vận chuyển</span><span>−{fmt(shipDisc)}đ</span></div>}
            {/* Coupon phí ship đứng NGOÀI so sánh tiền hàng — luôn hiển thị khi có */}
            {couponIsShipping && couponDiscount > 0 && <div className="zm-total-row disc"><span>🎫 Coupon{selectedCoupon ? ` ${selectedCoupon.code}` : ''} (phí ship)</span><span>−{fmt(couponDiscount)}đ</span></div>}
            {/* 🟠8: hiển thị theo PHÍA THẮNG thật — chỉ 1 phía tiền hàng được trừ khi không cộng dồn */}
            {voucherWins ? (
              <div className="zm-total-row disc"><span>🎟️ Voucher {voucherInfo.code}</span><span>−{fmt(voucherDisc)}đ</span></div>
            ) : (
              <>
                {promoDisc > 0 && <div className="zm-total-row disc"><span>🎉 {promo?.name}</span><span>−{fmt(promoDisc)}đ</span></div>}
                {!couponIsShipping && couponDiscount > 0 && <div className="zm-total-row disc"><span>🎫 Coupon{selectedCoupon ? ` ${selectedCoupon.code}` : ''}</span><span>−{fmt(couponDiscount)}đ</span></div>}
                {voucherDisc > 0 && kmMoneyDisc > 0 && (
                  <div className="zm-total-row" style={{ color: '#999', fontSize: 12 }}>
                    <span>🎟️ Voucher {voucherInfo.code} (−{fmt(voucherDisc)}đ) không áp vì KM giảm nhiều hơn</span><span></span>
                  </div>
                )}
              </>
            )}
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
