import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, fmt, getProfile, setProfile, getRef, setRef } from '../api';
import { storage } from '../utils/storage';
import SearchSelect from '../components/SearchSelect';
import SearchInput from '../components/SearchInput';
import ZmIcon from '../components/ZmIcon';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';
import { openStatus, nextOpenSlot, timeSlots, isWithinOpening } from '../utils/openingHours';
import { findPlaceByName } from '../utils/placeName'; // Sổ #69: khớp tên tỉnh/phường có chuẩn hóa
import { DateField, TimeField, toApiDate, validTime, formatPhone } from '../utils/checkoutFields.jsx';
import ConsentCheck from '../components/ConsentCheck'; // Spec mật khẩu §5.4: ô đồng ý dùng chung với mặt tiền đăng ký
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
  // Gói Ưu đãi hợp nhất (2026-10-31): coupon chọn sẵn từ Ví (Coupons.jsx "Dùng
  // ngay") truyền qua navigation state — xử lý 1 lần khi danh sách hợp nhất về.
  const preselectCouponId = useRef(location.state?.couponId || null);
  const [type, setType] = useState('delivery');
  const [deliveryMode, setDeliveryMode] = useState('now'); // Gói 55 p10: 'now' = giao ngay, 'scheduled' = hẹn giờ giao
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // Gói Đón Bình Minh (2026-10-28): ô nhập tay mã người giới thiệu — prefilled
  // từ zm_ref khi đến từ link mời; khách đã có lịch sử đơn thì ẩn (mã mời chỉ
  // có ý nghĩa ở đơn đầu; backend vốn chỉ kích hoạt CP-02 cho đơn đầu thật).
  const [refCode, setRefCodeState] = useState(() => getRef());
  const [refFromLink] = useState(() => !!getRef());
  const [hasPriorOrders, setHasPriorOrders] = useState(false);
  const updateRefCode = (v) => { setRefCodeState(v); setRef(v); };
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
  const [ckGate, setCkGate] = useState(null); // UX 2026-10-26 (MA-🟠3-bis): hộp xác nhận trong trang khi cổng CK lỗi cấu hình (thay window.confirm)
  const ckGateOkRef = useRef(false);
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
  useEffect(() => {
    api.payMethods().then((list) => {
      if (list && list.length) {
        setPayMethods(list);
        if (!list.some((m) => m.value === payment)) setPayment(list[0].value);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Đợt fix rà soát VPS (S8): "Trả tại quán" không áp dụng cho đơn Giao hàng —
  // đang chọn mà khách chuyển sang Giao hàng thì đưa lựa chọn về Chuyển khoản,
  // tránh gửi payment_method không hợp lệ lên server.
  useEffect(() => {
    if (type === 'delivery' && payment === 'pay_at_store') setPayment('transfer');
  }, [type, payment]);
  // Gói Ưu đãi hợp nhất (2026-10-31): danh sách hợp nhất từ server (chế độ
  // unified) + lựa chọn phía A của khách (KM chung HOẶC coupon ví — radio).
  // Khách không chọn = không giảm: bỏ hẳn tự áp ở bề mặt Mini App.
  const [offers, setOffers] = useState(null); // {items, stack_cap_amount}
  const [selA, setSelA] = useState(null); // {kind: 'promotion'|'wallet_coupon', id}
  const [offerWarn, setOfferWarn] = useState(''); // cảnh báo trong khối Ưu đãi (mất điều kiện / coupon ví không dùng được)
  const [panelOpen, setPanelOpen] = useState(false);
  const [offerSearch, setOfferSearch] = useState('');
  const [voucher, setVoucher] = useState('');
  // Audit 2026-10-21 🟠8: kết quả validate voucher từ SERVER (số giảm thật để vào tổng hiển thị)
  const [voucherInfo, setVoucherInfo] = useState(null); // {code, name, discount, stack_with_promotion}
  const [voucherMsg, setVoucherMsg] = useState(''); // Gói Ưu đãi hợp nhất: thông báo chặn cặp thiếu cờ (gọi tên mã đang chặn)
  const [points, setPoints] = useState(0);
  // Loyalty 2.0: không còn đổi điểm trực tiếp tại checkout — điểm chỉ đổi
  // coupon ở Cửa hàng điểm (trang Tài khoản).
  // Gói 64: bỏ tick VAT trên Mini App (hóa đơn đã kèm mã QR) — giữ state rỗng để không gãy code cũ
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  // UX 2026-10-26 (🟠3): lỗi validate hiện tại trang thay alert() — banner ở bước hiện tại + lỗi riêng dưới ô mã
  const [formErr, setFormErr] = useState('');
  const [voucherErr, setVoucherErr] = useState('');
  const [customerId, setCustomerId] = useState(null);
  // Spec mật khẩu §5.4/§7.3: email tự nguyện + ô đồng ý NĐ 13 ở đơn đầu.
  const [email, setEmail] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [hasConsented, setHasConsented] = useState(null); // null = chưa rõ
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [addrBook, setAddrBook] = useState([]);
  const [addrId, setAddrId] = useState('');
  // Lát 3g (2026-11-04, #39): tự áp địa chỉ MẶC ĐỊNH khi sổ địa chỉ tải xong —
  // trước đây addrId khởi tạo rỗng và không ai tự chọn, khách có sẵn địa chỉ
  // mặc định vẫn phải chọn lại tay. Chỉ tự áp khi khách CHƯA tự đụng vào ô
  // chọn (addrTouched) để không giật lại lựa chọn "nhập địa chỉ mới".
  const addrTouched = useRef(false);
  const fillFromAddress = (a) => {
    // Sổ #69 (2026-11-04): khớp tên tỉnh/phường qua findPlaceByName (có chuẩn
    // hóa viết tắt/dấu) — khớp chính xác cũ trượt khi sổ lưu "TP. Hồ Chí Minh"
    // mà danh mục là "Thành phố Hồ Chí Minh", kéo theo phường không nạp.
    const pc = findPlaceByName(provinces, a.province)?.code;
    if (pc) {
      setProvince(String(pc));
      loadWards(pc).then((ws) => {
        setWards(ws || []);
        const wc = findPlaceByName(ws || [], a.ward)?.code;
        setWard(wc ? String(wc) : '');
      });
    }
    setStreet(a.street || '');
    setPickedCoord(null);
  };
  useEffect(() => {
    if (addrTouched.current || addrId || !addrBook.length) return;
    const d = addrBook.find((a) => a.is_default);
    if (d) { setAddrId(String(d.id)); fillFromAddress(d); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrBook]);
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
        // Gói Ưu đãi hợp nhất (2026-10-31): xin danh sách hợp nhất KM + coupon ví
        unified: true,
      };
      // Audit 2026-10-21 🟠10 (phía FE): tra khách lỗi (mạng/422 cũ) KHÔNG được nuốt
      // luôn danh sách KM — rơi về khách vãng lai để KM công khai vẫn hiện.
      api.customerByPhone(phone, getProfile()?.member_code || '').catch(() => null).then((c) => {
        if (c) {
          setPoints(c.loyalty?.points ?? c.points ?? 0);
          setCustomerId(c.id);
          // Spec mật khẩu §5.4/§7.3: khách đã đồng ý thì không hiện lại ô;
          // chưa đồng ý thì hiện ô ở đơn đầu. Email hồ sơ có sẵn thì điền sẵn.
          setHasConsented(!!c.has_consented);
          if (c.has_consented === false) setConsentNeeded(true);
          if (c.email) setEmail((prev) => prev || c.email);
          // Gói Đón Bình Minh: khách đã từng có đơn (đã tích lũy chi tiêu hoặc
          // còn đơn gần đây) → ẩn ô mã người giới thiệu ở form bên dưới.
          setHasPriorOrders((Number(c.total_spent) || 0) > 0 || (c.orders || []).length > 0);
          api.addresses(c.id, c.phone, c.member_code).then((r) => setAddrBook(Array.isArray(r) ? r : [])).catch(() => {}); // Sổ phụ #31: r là mảng thuần (req đã bóc phong bì)
          return api.eligiblePromotions({ ...payload, customer_id: c.id, phone: formatPhone(phone), member_code: getProfile()?.member_code || '' });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setOffers).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [phone, subtotal, km, shipCfg, type]);

  // Gói Ưu đãi hợp nhất (2026-10-31): mỗi lần danh sách hợp nhất nạp lại (đổi
  // giỏ/SĐT/loại đơn) — xử lý coupon chọn sẵn từ Ví (1 lần) và tự nhả lựa chọn
  // phía A đã mất điều kiện kèm cảnh báo, đúng spec mục 2.8.
  const itemOfSel = (list, sel) => (list || []).find((i) => sel
    && i.kind === sel.kind
    && (sel.kind === 'promotion' ? i.promotion_id : i.customer_coupon_id) === sel.id) || null;
  useEffect(() => {
    if (!offers) return;
    if (preselectCouponId.current) {
      const cid = Number(preselectCouponId.current);
      preselectCouponId.current = null;
      const it = offers.items.find((i) => i.kind === 'wallet_coupon' && i.customer_coupon_id === cid);
      if (it?.eligible) {
        setSelA({ kind: 'wallet_coupon', id: cid });
        setOfferWarn('');
      } else if (it) {
        setOfferWarn(`Coupon ${it.code} chưa dùng được cho đơn này: ${it.reason_text || 'chưa đủ điều kiện.'}`);
      } else {
        setOfferWarn('Coupon bạn chọn từ Ví không còn dùng được cho đơn này.');
      }
      return;
    }
    if (selA) {
      const it = itemOfSel(offers.items, selA);
      if (!it) {
        setSelA(null);
        setOfferWarn('Ưu đãi đã chọn không còn áp dụng được cho đơn này — đã bỏ chọn.');
      } else if (!it.eligible) {
        setSelA(null);
        setOfferWarn(`Ưu đãi đã chọn không còn đủ điều kiện: ${it.reason_text || ''} — đã bỏ chọn.`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers]);

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
  // ===== Gói Ưu đãi hợp nhất (2026-10-31): PHÂN XỬ HIỂN THỊ §5d =====
  // Bất biến sống còn: TỔNG HIỂN THỊ = SỐ SERVER THU. Mọi số đầu vào do server
  // trả (số giảm từng mã, cờ cộng dồn, trần stack_cap_amount); client chỉ chạy
  // đúng phép phân xử của store() (OnlineOrderController bước 5d) trên các số
  // đó — thay cho cụm cộng thẳng promoDisc + couponDisc gây lỗi 41.500/76.500đ.
  const selItem = itemOfSel(offers?.items, selA);
  const stackCap = offers ? Number(offers.stack_cap_amount) || 0 : subtotal;
  const aMoneyItem = selItem && !selItem.is_shipping && selItem.type !== 'gift' ? selItem : null;
  const shipDisc = selItem?.is_shipping ? Math.min(Number(selItem.discount) || 0, shipFee) : 0;
  const shipDiscTotal = shipDisc;
  const aDisc = aMoneyItem ? Number(aMoneyItem.discount) || 0 : 0;
  const bDisc = voucherInfo ? Number(voucherInfo.discount) || 0 : 0;
  const pairAllowed = aDisc > 0 && bDisc > 0 && !!aMoneyItem?.stack_with_coupon && !!voucherInfo?.stack_with_promotion;
  const promoSingle = aDisc > 0 ? Math.min(aDisc, stackCap) : 0;
  const voucherSingle = bDisc > 0 ? Math.min(bDisc, stackCap) : 0;
  const pairTotal = pairAllowed ? Math.min(aDisc + bDisc, stackCap) : 0;
  let moneyDiscTotal = 0;
  let aApplied = 0; // số giảm tiền hàng của phía A đang được áp
  let vApplied = 0; // số giảm tiền hàng của voucher đang được áp
  let voucherState = null; // 'stacked' | 'single' | 'not_applied' (đã nhận nhưng chạm trần)
  let pairCapped = false;
  if (pairAllowed && pairTotal > promoSingle && pairTotal > voucherSingle) {
    moneyDiscTotal = pairTotal;
    aApplied = aDisc;
    vApplied = pairTotal - aDisc;
    voucherState = 'stacked';
    pairCapped = aDisc + bDisc > stackCap;
  } else if (bDisc > aDisc) {
    // Voucher thắng hẳn (kể cả khi phía A là KM ship/tặng món — mặt tiền hàng trống)
    moneyDiscTotal = voucherSingle;
    vApplied = voucherSingle;
    voucherState = 'single';
  } else if (aDisc > 0) {
    moneyDiscTotal = promoSingle;
    aApplied = promoSingle;
    if (bDisc > 0) voucherState = 'not_applied';
  } else if (bDisc > 0) {
    moneyDiscTotal = voucherSingle;
    vApplied = voucherSingle;
    voucherState = 'single';
  }
  const totalDiscTotal = shipDiscTotal + moneyDiscTotal;
  // Loyalty 2.0: bỏ pointDisc — tổng không còn dòng trừ điểm
  const total = Math.max(0, subtotal + shipFee - shipDiscTotal - moneyDiscTotal);

  // Mã phía A bị voucher đang có chặn (thiếu 1 trong 2 cờ cộng dồn) — chỉ xét
  // quan hệ cùng mặt tiền hàng; KM ship/tặng món không tranh mặt này (§5d).
  const blockedByVoucher = (item) => !!voucherInfo && !item.is_shipping && item.type !== 'gift'
    && !(item.stack_with_coupon && voucherInfo.stack_with_promotion);

  const chooseA = (item) => {
    if (!item?.eligible || blockedByVoucher(item)) return;
    const key = { kind: item.kind, id: item.kind === 'promotion' ? item.promotion_id : item.customer_coupon_id };
    // Chạm lại mã đang chọn = bỏ chọn
    setSelA((cur) => (cur && cur.kind === key.kind && cur.id === key.id ? null : key));
    setOfferWarn('');
  };

  // Audit 2026-10-21 🟠8: validate voucher gõ tay bằng endpoint server.
  // Gói Ưu đãi hợp nhất (2026-10-31): thêm kiểm soát tương thích chiều B→A —
  // voucher thiếu cờ với phía A đang chọn thì BỊ CHẶN ngay tại lúc nhập (không
  // thành lựa chọn, thông báo gọi đúng tên mã A đang chặn, ô nhập giữ nguyên).
  const checkVoucher = async (code) => {
    const c = String(code || '').trim().toUpperCase();
    setVoucherErr('');
    setVoucherMsg('');
    if (!c) { setVoucherInfo(null); return true; }
    // Ca biên 5: mã gõ vào trùng coupon ví của chính khách → chọn luôn ở phía A
    const walletHit = (offers?.items || []).find((i) => i.kind === 'wallet_coupon' && String(i.code || '').toUpperCase() === c);
    if (walletHit) {
      if (walletHit.eligible) {
        setSelA({ kind: 'wallet_coupon', id: walletHit.customer_coupon_id });
        setOfferWarn('');
        setVoucher('');
        setVoucherInfo(null);
        setVoucherMsg('Mã này là coupon trong ví của bạn — đã chọn ở danh sách ưu đãi bên dưới.');
        return true;
      }
      setVoucherErr(`Coupon ${walletHit.code} trong ví của bạn chưa dùng được: ${walletHit.reason_text || 'chưa đủ điều kiện.'}`);
      return false;
    }
    try {
      const prof = getProfile() || {};
      const res = await api.validateVoucher({
        code: c,
        subtotal,
        phone: formatPhone(phone || '') || prof.phone || '',
        member_code: prof.member_code || '',
      });
      const info = {
        code: res.code, name: res.name,
        discount: Math.round(Number(res.discount) || 0),
        stack_with_promotion: !!res.stack_with_promotion,
      };
      if (aMoneyItem && !(aMoneyItem.stack_with_coupon && info.stack_with_promotion)) {
        // Tên mã đang chặn: coupon ví gọi cả mã coupon, KM chung gọi tên chương trình
        const aLabel = aMoneyItem.kind === 'wallet_coupon' && aMoneyItem.code
          ? `${aMoneyItem.name} (${aMoneyItem.code})` : aMoneyItem.name;
        setVoucherInfo(null);
        setVoucherMsg(`Mã ${info.code} không áp dụng cùng ${aLabel} — bỏ chọn ${aLabel} để dùng mã này, hoặc giữ ${aLabel} và bỏ qua mã này.`);
        return false;
      }
      setVoucherInfo(info);
      return true;
    } catch (err) {
      setVoucherInfo(null);
      setVoucherErr(err.message || 'Mã voucher không hợp lệ.');
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

  // Đổi loại đơn: reset toàn bộ lựa chọn ưu đãi (không áp dụng sang loại mới)
  const switchType = (t) => {
    setType(t);
    setSelA(null);
    setVoucher('');
    setVoucherInfo(null);
    setVoucherMsg('');
    setOfferWarn('');
  };

  // Validate bước 1 rồi sang tóm tắt
  const goSummary = async () => {
    setFormErr('');
    if (!name.trim() || !phone.trim()) { setFormErr('Nhập tên và số điện thoại ở phần thông tin nhận hàng phía trên.'); return; }
    // 🟠8: có mã voucher chưa validate (hoặc khác mã đã validate) → validate trước khi
    // sang bước 2 để tổng hiển thị ở bước 2 đã gồm số giảm/không gồm mã sai.
    const vcode = voucher.trim().toUpperCase();
    if (vcode && vcode !== (voucherInfo?.code || '')) {
      const ok = await checkVoucher(vcode);
      if (!ok) return;
    }
    if (type === 'delivery') {
      if (!province || !ward || !street.trim()) { setFormErr('Chọn tỉnh/thành, phường/xã và nhập số nhà, tên đường ở phần địa chỉ giao hàng.'); return; }
      // Gói 55 p10: hẹn giờ giao — kiểm tra trong giờ mở cửa
      if (deliveryMode === 'scheduled') {
        const d = toApiDate(schedDate);
        if (!d) { setFormErr('Nhập ngày muốn giao (dd/mm/yyyy).'); return; }
        if (!validTime(schedTime)) { setFormErr('Nhập giờ muốn giao (HH:MM, 24h).'); return; }
        if (new Date(`${d}T${schedTime}`) <= new Date()) { setFormErr('Giờ hẹn phải sau thời điểm hiện tại.'); return; }
        if (!isWithinOpening(branch, schedDate, schedTime)) { setFormErr('Giờ hẹn phải trong giờ mở cửa của quán.'); return; }
      }
    }
    if (type === 'scheduled') {
      const d = toApiDate(schedDate);
      if (!d) { setFormErr('Nhập ngày muốn tới lấy (dd/mm/yyyy).'); return; }
      if (!validTime(schedTime)) { setFormErr('Nhập giờ muốn tới lấy (HH:MM, 24h).'); return; }
      if (new Date(`${d}T${schedTime}`) <= new Date()) { setFormErr('Giờ hẹn phải sau thời điểm hiện tại.'); return; }
      if (!isWithinOpening(branch, schedDate, schedTime)) { setFormErr('Giờ hẹn phải trong giờ mở cửa của quán.'); return; }
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
        setFormErr('Chưa giao được tới địa chỉ này. Vui lòng thử địa chỉ khác hoặc chọn nhận tại quán.');
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
      if (!useZaloPay && payment === 'transfer' && !ckGateOkRef.current) {
        // UX 2026-10-26 (MA-🟠3-bis): hiện hộp xác nhận ngay trong trang (mẫu inline như
        // TrackOrder/WaitingPayment) thay window.confirm; khách bấm "Vẫn đặt đơn" thì
        // ckGateOkRef mở cổng và place() chạy lại từ đầu. Nội dung giữ nguyên ý 🟠15 audit 21/10.
        setCkGate(zaloCfgFailed
          ? 'Chưa tải được thông tin chuyển khoản của quán (có thể do mạng chập chờn). Nếu tiếp tục, quán sẽ liên hệ hướng dẫn chuyển khoản sau khi nhận đơn.'
          : 'Đơn chuyển khoản này sẽ được quán xác nhận và hướng dẫn thông tin chuyển khoản sau khi nhận đơn.');
        return;
      }
      ckGateOkRef.current = false;
      // Spec mật khẩu §5.4: đơn đầu chưa tích ô đồng ý thì khóa nút đặt đơn
      // ngay ở client (cổng cứng thật vẫn ở server — 422 consent_required).
      if (consentNeeded && !consentChecked) {
        setFormErr('Bạn cần tích ô đồng ý cho Daybreak xử lý dữ liệu cá nhân để đặt đơn đầu tiên.');
        setStep(1);
        return;
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
        // Spec mật khẩu §7.3/§5.4: email tự nguyện + cờ đồng ý NĐ 13 ở đơn đầu.
        email: email.trim() || null,
        consent_agreed: !!consentChecked,
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
        // Gói Ưu đãi hợp nhất (2026-10-31): chỉ gửi ĐÚNG những gì khách đã chọn
        // và đã được nhận — voucher bị chặn khi nhập không gửi (tránh server áp
        // thay lựa chọn của khách); không chọn gì → cả 3 trường rỗng, đơn không giảm.
        voucher_code: voucherInfo?.code || null,
        promotion_id: selA?.kind === 'promotion' ? selA.id : null,
        customer_coupon_id: selA?.kind === 'wallet_coupon' ? selA.id : null,
        // Loyalty 2.0: không gửi points_redeem nữa (điểm chỉ đổi coupon ở Cửa hàng điểm)
        // Gói 64: không gửi yêu cầu VAT cho đơn online nữa (giữ null)
        note: note.trim() || null,
        referred_by: refCode.trim().toUpperCase() || null,
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
      // Spec mật khẩu §5.4: server từ chối vì thiếu đồng ý → hiện ô đồng ý
      // ở bước 1 và cho khách đặt lại.
      if (e.code === 'consent_required') {
        setConsentNeeded(true);
        setFormErr(e.message || 'Bạn cần đồng ý cho Daybreak xử lý dữ liệu cá nhân để đặt đơn đầu tiên.');
        setStep(1);
      } else {
        setFormErr(e.message || 'Đặt hàng thất bại. Vui lòng thử lại.');
      }
    } finally { setPlacing(false); }
  };

  const typeLabel = type === 'delivery'
    ? (deliveryMode === 'scheduled' ? 'Hẹn giờ giao' : 'Giao hàng')
    : type === 'takeaway' ? 'Mang đi' : 'Hẹn giờ lấy';

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
              <button className={type === 'delivery' ? 'on' : ''} onClick={() => { switchType('delivery'); if (isClosed) setDeliveryMode('scheduled'); }}><ZmIcon name="bike" size={16} />Giao hàng</button>
              <button className={type === 'takeaway' ? 'on' : ''} disabled={isClosed} onClick={() => switchType('takeaway')}><ZmIcon name="bag" size={16} />Mang đi</button>
              <button className={type === 'scheduled' ? 'on' : ''} onClick={() => switchType('scheduled')}><ZmIcon name="clock" size={16} />Hẹn giờ lấy</button>
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
            {/* Spec mật khẩu §7.3: email tự nguyện ở checkout — chỉ điền vào
                hồ sơ khi hồ sơ đang trống (server quyết), không bắt buộc. */}
            <div className="zm-field">
              <label>Email <span style={{ color: '#888', fontWeight: 400 }}>(không bắt buộc — chỉ dùng cho thông báo bảo mật)</span></label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email của bạn" type="email" maxLength={150} />
            </div>
            {/* Spec mật khẩu §5.4: ô đồng ý NĐ 13 ở đơn đầu — chưa tích thì
                nút đặt đơn khóa (cổng cứng ở server, xem place()). */}
            {consentNeeded && (
              <div style={{ margin: '4px 0 8px' }}>
                <ConsentCheck checked={consentChecked} onChange={setConsentChecked} />
              </div>
            )}
            {/* Gói Đón Bình Minh (2026-10-28): mã người giới thiệu — chỉ hiện với
                khách chưa có đơn; đến từ link thì hiện sẵn mã đã gắn, xóa/sửa được */}
            {!hasPriorOrders && (
              <div className="zm-field">
                <label>Mã người giới thiệu (nếu có)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input value={refCode} onChange={(e) => updateRefCode(e.target.value.toUpperCase())} placeholder="Nhập mã của người giới thiệu" maxLength={20} style={{ flex: 1 }} />
                  {refCode && (
                    <button type="button" onClick={() => updateRefCode('')} aria-label="Xóa mã người giới thiệu"
                      style={{ minWidth: 44, minHeight: 44, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 15, color: '#888' }}><ZmIcon name="x" size={16} /></button>
                  )}
                </div>
                {refFromLink && refCode && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>Đã gắn từ link mời — kiểm tra đúng người mời của bạn chưa nhé.</div>
                )}
              </div>
            )}

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
                  <span style={{ color: '#24305E', display: 'flex' }}><ZmIcon name="zap" size={24} /></span>
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
                  <span style={{ color: '#24305E', display: 'flex' }}><ZmIcon name="calendar" size={24} /></span>
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
                    <div className="zm-deliv-ic"><ZmIcon name="mapPin" size={20} /></div>
                    <div className="zm-deliv-t">Thông tin nhận hàng</div>
                    <div className="zm-deliv-chg">Thay đổi</div>
                  </div>
                  <div className="zm-deliv-mid">
                    <div className="zm-deliv-uic"><ZmIcon name="user" size={20} /></div>
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="book" size={14} />Sổ địa chỉ</label>
      <select value={addrId} onChange={(e) => {
        addrTouched.current = true;
        const id = e.target.value;
        setAddrId(id);
        if (!id) return;
        const a = addrBook.find((x) => String(x.id) === id);
        if (!a) return;
        fillFromAddress(a);
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
        {suggestLoading && <div style={{ padding: 12, fontSize: 13, color: '#999' }}>Đang tìm địa chỉ...</div>}
        {suggests.map((s, i) => (
          <div
            key={i}
            onClick={() => pickSuggest(s)}
            style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
          >
            <div style={{ fontWeight: 600 }}>{s.short}</div>
            <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
    )}
  </div>
  {geoLoading && <div className="zm-note">Đang tự động tính khoảng cách...</div>}
  {km != null && shipCfg && (
    <div className="zm-alert">Khoảng cách ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b> (tự động tính)</div>
  )}
  {geoError && (
    <div className="zm-alert" style={{ background: '#fef3c7', borderColor: '#fcd34d' }}>
      ⚠️ Không tự tính được khoảng cách. Quán sẽ xác nhận phí ship qua điện thoại.
      <button type="button" onClick={calcKm} style={{ marginLeft: 8, textDecoration: 'underline', color: '#b45309' }}>Tính lại</button>
    </div>
  )}
  {/* Gói 60: chọn gói giao hàng từ báo giá live của hãng */}
  {type === 'delivery' && quoteLoading && (
    <div className="zm-note">Đang tính phí ship từ hãng giao hàng...</div>
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
              <div style={{ fontWeight: 700 }}>{p.code === 'nhanh' ? 'Nhanh' : 'Siêu Tốc'} <span style={{ color: '#888', fontWeight: 400 }}>· {p.provider_label}</span></div>
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
                        {locLoading ? 'Đang lấy vị trí...' : 'Vị trí hiện tại'}
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
            <div style={{ fontSize: 12, color: '#888', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ZmIcon name="lock" size={14} />Thanh toán an toàn qua Zalo
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
              ]).map((m) => {
                // S8: khóa "Trả tại quán" khi đang Giao hàng (như đường cấu hình Zalo ở trên)
                const mLocked = m.value === 'pay_at_store' && type === 'delivery';
                return (
                  <div key={m.value}
                    className={`zm-pay-opt ${payment === m.value ? 'on' : ''} ${mLocked ? 'disabled' : ''}`}
                    onClick={() => { if (!mLocked) setPayment(m.value); }}
                    style={mLocked ? { opacity: 0.5 } : {}}>
                    <div className="dot" /><div><b>{m.label}</b><div style={{ fontSize: 12, color: '#888' }}>{mLocked ? 'Chỉ áp dụng khi nhận tại quán' : m.desc}</div></div>
                  </div>
                );
              })
            )}

            {/* Gói 64: bỏ tick xuất VAT trên Mini App (hóa đơn đã kèm mã QR cho khách quét nhập thông tin) */}

            {/* ===== Gói Ưu đãi hợp nhất (2026-10-31): khối Ưu đãi + panel chọn ===== */}
            <div
              onClick={() => setPanelOpen(true)}
              style={{ background: '#fff', border: '1.5px solid #fde68a', borderRadius: 12, padding: 12, marginBottom: 14, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>🎁 Ưu đãi</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {totalDiscTotal > 0 && <b style={{ color: '#16a34a', fontSize: 13.5 }}>−{fmt(totalDiscTotal)}đ</b>}
                  <span style={{ color: '#999', fontSize: 18 }}>›</span>
                </span>
              </div>
              {selItem?.is_shipping && shipDisc > 0 && (
                <div style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>🚚 {selItem.name}: giảm ship {fmt(shipDisc)}đ</div>
              )}
              {selItem?.type === 'gift' && (
                <div style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>🎁 {selItem.name}: tặng {selItem.gift_product_name}</div>
              )}
              {aApplied > 0 && aMoneyItem && (
                <div style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                  {aMoneyItem.kind === 'wallet_coupon' ? '🎫' : '🎉'} {aMoneyItem.name}: −{fmt(aApplied)}đ{voucherState === 'stacked' ? ' (cộng dồn)' : ''}
                </div>
              )}
              {vApplied > 0 && voucherInfo && (
                <div style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                  🎟️ Voucher {voucherInfo.code}: −{fmt(vApplied)}đ{voucherState === 'stacked' ? ' (cộng dồn)' : ''}{pairCapped ? ' — đã chạm trần giảm tối đa' : ''}
                </div>
              )}
              {voucherState === 'not_applied' && voucherInfo && (
                <div style={{ fontSize: 12.5, color: '#92400e', fontWeight: 600, marginTop: 4 }}>
                  🎟️ Voucher {voucherInfo.code} chưa áp dụng cho đơn này — đi cùng {aMoneyItem?.name} đã chạm trần giảm tối đa; mã giữ nguyên, chưa bị trừ lượt.
                </div>
              )}
              {offerWarn && (
                <div style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, marginTop: 4 }}>⚠ {offerWarn}</div>
              )}
              {voucherMsg && (
                <div style={{ fontSize: 12.5, color: '#92400e', fontWeight: 600, marginTop: 4 }}>{voucherMsg}</div>
              )}
              {!selItem && !voucherInfo && !offerWarn && (
                <div style={{ fontSize: 12.5, color: '#888', marginTop: 4 }}>
                  {(() => {
                    const best = Math.max(0, ...(offers?.items || []).filter((i) => i.eligible).map((i) => Number(i.discount) || 0));
                    return best > 0 ? `Có ưu đãi giảm đến ${fmt(best)}đ — chạm để chọn` : 'Nhập mã giảm giá nếu có';
                  })()}
                </div>
              )}
            </div>

            {/* L0 (2026-10-31): overlay căn giữa + sheet chốt maxWidth 480 theo khung #root của app — hết tràn ngang ở viewport rộng */}
            {panelOpen && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
                onClick={() => setPanelOpen(false)}>
                <div style={{ background: '#fff', width: '100%', maxWidth: 480, maxHeight: '92vh', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column' }}
                  onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px 8px' }}>
                    <b style={{ fontSize: 16 }}>🎁 Ưu đãi</b>
                    <button type="button" onClick={() => setPanelOpen(false)}
                      style={{ width: 44, height: 44, border: 'none', background: 'transparent', fontSize: 20, color: '#666', cursor: 'pointer' }}><ZmIcon name="x" size={16} /></button>
                  </div>
                  <div style={{ overflowY: 'auto', padding: '0 16px 8px' }}>
                    {/* Phía B: ô nhập voucher gõ tay */}
                    <div style={{ fontWeight: 700, fontSize: 13.5, margin: '4px 0 6px' }}>🎟️ Mã voucher</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={voucher}
                        onChange={(e) => { setVoucher(e.target.value); setVoucherInfo(null); setVoucherErr(''); setVoucherMsg(''); }}
                        placeholder="NHẬP MÃ NẾU CÓ"
                        style={{ flex: 1, minWidth: 0, minHeight: 44, border: '1px solid #ddd', borderRadius: 8, padding: '0 12px', textTransform: 'uppercase', fontSize: 14 }} />
                      <button type="button" className="zm-btn-inline" style={{ minHeight: 44 }}
                        onClick={() => checkVoucher(voucher)}>
                        Áp dụng
                      </button>
                    </div>
                    {voucherErr && <div style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 6, fontWeight: 600 }}>⚠ {voucherErr}</div>}
                    {voucherMsg && <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 6, fontWeight: 600 }}>{voucherMsg}</div>}
                    {voucherInfo && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '8px 10px', marginTop: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>
                          🎟️ {voucherInfo.code} — giảm {fmt(voucherInfo.discount)}đ
                          {voucherState === 'stacked' ? ` · Đang cộng dồn với ${aMoneyItem?.name}` : voucherState === 'not_applied' ? ' · Chưa áp dụng (chạm trần)' : ''}
                        </span>
                        <button type="button" aria-label="Gỡ voucher"
                          onClick={() => { setVoucherInfo(null); setVoucher(''); setVoucherMsg(''); }}
                          style={{ width: 44, height: 44, border: 'none', background: 'transparent', fontSize: 16, color: '#999', cursor: 'pointer' }}><ZmIcon name="x" size={16} /></button>
                      </div>
                    )}
                    {/* L4-B (2026-10-31): dòng gợi ý tương thích voucher KHÔNG còn nằm dưới ô nhập
                        (đọc như lỗi của ô nhập) — đã chuyển vào dòng của mã đang chọn trong danh sách dưới đây.
                        Dưới ô nhập chỉ còn thông báo khi khách thật sự nhập mã bị chặn (voucherMsg ở trên). */}
                    {/* Ô tìm kiếm: CHỈ lọc danh sách, không áp mã (phát triển sau) */}
                    <SearchInput value={offerSearch} onChange={(e) => setOfferSearch(e.target.value)} onSearch={(v) => setOfferSearch(v)}
                      placeholder="Tìm ưu đãi theo tên hoặc mã…"
                      style={{ marginTop: 14 }} inputStyle={{ minHeight: 44, border: '1px solid #ddd', borderRadius: 8, padding: '0 12px', fontSize: 14 }} />
                    {/* Phía A: danh sách hợp nhất, chọn 1 */}
                    <div style={{ fontWeight: 700, fontSize: 13.5, margin: '14px 0 4px' }}>Ưu đãi chính — chọn 1 trong các mã này</div>
                    {/* L1a (2026-10-31): khi KHÔNG mã tiền hàng nào cộng dồn được với voucher, huy hiệu
                        "Chỉ dùng riêng" lặp trên mọi dòng mất tác dụng phân biệt → thay bằng 1 chú thích chung */}
                    {(() => {
                      const items = offers?.items || [];
                      const anyStack = items.some((i) => i.stack_with_coupon && !i.is_shipping && i.type !== 'gift');
                      return !anyStack && items.length > 0 ? (
                        <div style={{ fontSize: 12.5, color: '#666', margin: '0 0 6px' }}>Các ưu đãi hiện tại không cộng dồn với voucher.</div>
                      ) : null;
                    })()}
                    <div
                      onClick={() => { setSelA(null); setOfferWarn(''); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '6px 2px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${!selA ? '#F5A623' : '#ccc'}`, background: !selA ? '#F5A623' : 'transparent', flexShrink: 0, boxSizing: 'border-box' }} />
                      <span style={{ fontSize: 14 }}>Không dùng ưu đãi</span>
                    </div>
                    {(() => {
                      const q = offerSearch.trim().toLowerCase();
                      const list = (offers?.items || []).filter((i) => !q
                        || String(i.name || '').toLowerCase().includes(q)
                        || String(i.code || '').toLowerCase().includes(q));
                      if (list.length === 0) {
                        return <div style={{ fontSize: 13, color: '#888', padding: '14px 2px' }}>
                          {q ? `Không có ưu đãi nào khớp '${offerSearch.trim()}' — mã giảm giá gõ tay nhập ở ô Mã voucher phía trên.` : 'Chưa có ưu đãi nào cho đơn này.'}
                        </div>;
                      }
                      const allItems = offers?.items || [];
                      const anyStack = allItems.some((i) => i.stack_with_coupon && !i.is_shipping && i.type !== 'gift');
                      const couponNames = new Set(allItems.filter((i) => i.kind === 'wallet_coupon').map((i) => i.name));
                      return list.map((item) => {
                        const idOf = item.kind === 'promotion' ? item.promotion_id : item.customer_coupon_id;
                        const isSel = !!selA && selA.kind === item.kind && selA.id === idOf;
                        const blocked = item.eligible && blockedByVoucher(item);
                        const dim = !item.eligible || blocked;
                        // L1a/L1b (2026-10-31): mã tặng món đứng ngoài §5d → không huy hiệu nội tại,
                        // có voucher thì hiện "Dùng cùng voucher được"; khi không mã nào cộng dồn
                        // được (anyStack = false) → ẩn huy hiệu "Chỉ dùng riêng" lặp (đã có chú thích chung)
                        const badge = !item.eligible ? null
                          : blocked ? { text: `✕ Không áp dụng cùng ${voucherInfo.code}`, color: '#b91c1c', bg: '#fef2f2' }
                          : item.type === 'gift'
                            ? (voucherInfo ? { text: '✓ Dùng cùng voucher được', color: '#15803d', bg: '#f0fdf4' } : null)
                          : voucherInfo && !item.is_shipping ? { text: `✓ Cộng dồn được với ${voucherInfo.code}`, color: '#15803d', bg: '#f0fdf4' }
                          : !anyStack ? null
                          : item.stack_with_coupon ? { text: '✓ Cộng dồn được với voucher', color: '#15803d', bg: '#f0fdf4' }
                          : { text: 'Chỉ dùng riêng', color: '#666', bg: '#f3f4f6' };
                        const rightText = item.is_shipping
                          ? (item.eligible ? `Giảm ship ${fmt(item.discount)}đ` : 'Giảm ship')
                          : item.type === 'gift'
                            ? `Tặng ${item.gift_product_name || 'món'}`
                            : item.eligible
                              ? `−${fmt(item.discount)}đ`
                              : (Number(item.would_discount) > 0 ? `−${fmt(item.would_discount)}đ` : '');
                        return (
                          <div key={`${item.kind}-${idOf}`}
                            onClick={() => chooseA(item)}
                            style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 56, padding: '8px 2px', borderBottom: '1px solid #f3f4f6',
                              cursor: dim ? 'not-allowed' : 'pointer', opacity: dim ? 0.55 : 1,
                              background: isSel ? '#fff7e6' : 'transparent', borderRadius: isSel ? 10 : 0 }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', marginTop: 2, flexShrink: 0, boxSizing: 'border-box',
                              border: `2px solid ${isSel ? '#F5A623' : '#ccc'}`, background: isSel ? '#F5A623' : 'transparent' }} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>
                                {item.kind === 'wallet_coupon' ? '🎫 ' : ''}{item.name}
                                {/* L2 (2026-10-31): KM chung trùng tên với coupon ví → nhãn "Khuyến mãi" để phân biệt */}
                                {item.kind === 'promotion' && couponNames.has(item.name) && (
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#24305E', background: '#EDF0F8', borderRadius: 999, padding: '1px 7px', marginLeft: 6 }}>Khuyến mãi</span>
                                )}
                              </span>
                              {/* L2 (2026-10-31): dòng phụ coupon ví — mã + hạn dùng là dữ kiện phân biệt; sắp hết hạn (≤7 ngày) tô cam */}
                              {item.kind === 'wallet_coupon' && item.code && (
                                <span style={{ display: 'block', fontSize: 12, color: '#888', marginTop: 2 }}>
                                  Mã {item.code}
                                  {item.expires_at ? (() => {
                                    const [y, m, d] = String(item.expires_at).split('-');
                                    const daysLeft = Math.ceil((new Date(`${item.expires_at}T23:59:59`) - new Date()) / 86400000);
                                    return <> · Hạn dùng <span style={daysLeft <= 7 ? { color: '#D97706', fontWeight: 700 } : undefined}>{d}/{m}/{y}</span></>;
                                  })() : null}
                                </span>
                              )}
                              {!item.eligible && (
                                <span style={{ display: 'block', fontSize: 12.5, color: '#b91c1c', marginTop: 2 }}>
                                  {item.reason_code === 'MIN_ORDER' && item.missing_amount
                                    ? `Đặt thêm ${fmt(item.missing_amount)}đ để được hưởng`
                                    : (item.reason_text || 'Chưa đủ điều kiện cho đơn này')}
                                </span>
                              )}
                              {blocked && (
                                <span style={{ display: 'block', fontSize: 12.5, color: '#b91c1c', marginTop: 2 }}>Không áp dụng cùng {voucherInfo.code} — gỡ voucher để dùng mã này</span>
                              )}
                              {badge && (
                                <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, marginTop: 4, padding: '2px 8px', borderRadius: 999, color: badge.color, background: badge.bg }}>{badge.text}</span>
                              )}
                              {/* L4-B (2026-10-31): dòng tương thích voucher gắn vào chính dòng mã ĐANG CHỌN */}
                              {isSel && !voucherInfo && !item.is_shipping && item.type !== 'gift' && (
                                <span style={{ display: 'block', fontSize: 12.5, color: '#666', marginTop: 3 }}>
                                  {item.stack_with_coupon
                                    ? 'Cộng dồn được với voucher — nhập thêm mã ở ô Mã voucher phía trên để giảm thêm.'
                                    : 'Chỉ dùng riêng — voucher sẽ không áp dụng cùng mã này.'}
                                </span>
                              )}
                            </span>
                            {rightText && <b style={{ fontSize: 14, color: dim ? '#999' : '#16a34a', whiteSpace: 'nowrap' }}>{rightText}</b>}
                          </div>
                        );
                      });
                    })()}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 16px', borderTop: '1px solid #eee' }}>
                    <span style={{ fontSize: 14 }}>Tổng giảm: <b style={{ color: '#16a34a' }}>−{fmt(totalDiscTotal)}đ</b></span>
                    <button type="button" className="zm-btn-inline" style={{ minHeight: 44 }} onClick={() => setPanelOpen(false)}>Xong</button>
                  </div>
                </div>
              </div>
            )}
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
            {formErr && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>⚠ {formErr}</div>
            )}
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
            <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="receipt" size={14} />Món đã đặt ({cart.reduce((s, l) => s + l.qty, 0)})</div>
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
                {l.note && <div style={{ fontSize: 12, color: '#888', paddingLeft: 12, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="note" size={12} />{l.note}</div>}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="user" size={14} />{name} · {phone}</div>
              {type === 'delivery' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="mapPin" size={14} />{fullAddress()}</div>
                  {deliveryNote.trim() && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="note" size={14} />{deliveryNote.trim()}</div>}
                  <div>Khoảng cách: {km != null ? `~${km}km` : 'quán xác nhận'}</div>
                </>
              )}
              {type === 'scheduled' && <div>⏰ Hẹn lấy: {schedDate} {schedTime}</div>}
              {type === 'delivery' && deliveryMode === 'scheduled' && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="calendar" size={14} />Hẹn giao: {schedDate} {schedTime}</div>}
              {type === 'takeaway' && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="store" size={14} />Nhận tại: {branch.name}</div>}
              <div>{(zaloCfg ? payChannel === 'BANK' : payment === 'transfer') ? 'Chuyển khoản / QR' : 'Thanh toán tại quán'}</div> {/* UX 2026-10-26 (MA-❓3): trước đây đọc biến payment của nhánh dự phòng -> hiện sai kênh khi khách chọn qua payChannel (BANK/COD) */}
              {/* Gói 64: bỏ hiển thị VAT trên tóm tắt đơn */}
            </div>
          </div>

          {/* Phí & tổng */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Chi tiết thanh toán</div>
            {type === 'delivery' && (
              <div className="zm-total-row">
                <span>Phí vận chuyển{quotePkg ? ` (${quotePkg.code === 'nhanh' ? 'Nhanh' : 'Siêu Tốc'} · ${quotePkg.provider_label})` : km != null ? ` (~${km}km)` : ''}</span>
                <span>{quotePkg || km != null ? `${fmt(shipFee)}đ` : 'Quán xác nhận'}</span>
              </div>
            )}
            {type === 'delivery' && shipShopSupport > 0 && (
              <div className="zm-total-row disc"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="store" size={14} />Quán hỗ trợ phí ship</span><span>−{fmt(shipShopSupport)}đ</span></div>
            )}
            {/* Gói Ưu đãi hợp nhất (2026-10-31): các dòng giảm do hàm phân xử §5d
                sinh ra — chỉ ưu đãi ĐANG ÁP mới có dòng ở khối tổng */}
            {shipDisc > 0 && selItem && <div className="zm-total-row disc"><span>{selItem.kind === 'wallet_coupon' ? '🎫' : '🚚'} {selItem.name} (phí ship)</span><span>−{fmt(shipDisc)}đ</span></div>}
            {selItem?.type === 'gift' && <div className="zm-total-row disc"><span>🎁 {selItem.name}</span><span>Tặng {selItem.gift_product_name}</span></div>}
            {aApplied > 0 && aMoneyItem && (
              <div className="zm-total-row disc">
                <span>{aMoneyItem.kind === 'wallet_coupon' ? `🎫 Coupon ${aMoneyItem.code || ''}` : `🎉 ${aMoneyItem.name}`}</span>
                <span>−{fmt(aApplied)}đ</span>
              </div>
            )}
            {vApplied > 0 && voucherInfo && (
              <div className="zm-total-row disc">
                <span>🎟️ Voucher {voucherInfo.code}{voucherState === 'stacked' ? ' (cộng dồn)' : ''}</span>
                <span>−{fmt(vApplied)}đ</span>
              </div>
            )}
            <div className="zm-total-row grand"><span>Tổng cộng</span><span>{fmt(total)}đ</span></div>
          </div>

          {/* UX 2026-10-26 (MA-🟠3-bis): hộp xác nhận cổng chuyển khoản */}
          {ckGate && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>⚠ Xác nhận đặt đơn chuyển khoản</div>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.55, marginBottom: 10 }}>{ckGate}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="zm-btn-inline" style={{ background: '#e8eaf0', color: '#24305E' }} onClick={() => setCkGate(null)}>Quay lại</button>
                <button className="zm-btn-inline" onClick={() => { ckGateOkRef.current = true; setCkGate(null); place(); }}>Vẫn đặt đơn</button>
              </div>
            </div>
          )}
          <div className="zm-cartbar" style={{ display: 'flex', gap: 8 }}>
            <button className="zm-btn-primary" style={{ flex: 1, background: '#e8eaf0', color: '#24305E' }} onClick={() => setStep(1)}>
              ← Sửa
            </button>
            {formErr && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>⚠ {formErr}</div>
            )}
            <button className="zm-btn-primary" style={{ flex: 2 }} disabled={placing} onClick={place}>
              {placing ? 'Đang đặt...' : `Đặt hàng · ${fmt(total)}đ`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
