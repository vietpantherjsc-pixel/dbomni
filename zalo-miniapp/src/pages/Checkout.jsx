import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, fmt, getProfile, setProfile, getRef, setRef } from '../api';
import { storage } from '../utils/storage';
import SearchSelect from '../components/SearchSelect';
import ZmIcon, { CouponIcon } from '../components/ZmIcon';
import { geocodeLadder, haversineKm, calcShipFee } from '../utils/geo';
import { openStatus, nextOpenSlot, timeSlots, isWithinOpening } from '../utils/openingHours';
import { findPlaceByName } from '../utils/placeName'; // Sổ #69: khớp tên tỉnh/phường có chuẩn hóa
import { DateField, TimeField, toApiDate, validTime, formatPhone, validPhone } from '../utils/checkoutFields.jsx';
import ConsentCheck from '../components/ConsentCheck'; // Spec mật khẩu §5.4: ô đồng ý dùng chung với mặt tiền đăng ký
import PromoPanel, { EMPTY_PROMO_RES } from '../components/PromoPanel'; // Spec panel Ưu đãi (2026-11-14): panel chọn ưu đãi dùng chung với đơn nhóm
import { openCheckout } from '../utils/checkoutSdk'; // Gói Checkout SDK (2026-11-10): điểm mở trang thanh toán Zalo duy nhất
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
  // Coupon chọn sẵn từ Ví (Coupons.jsx "Dùng ngay") truyền qua navigation
  // state — PromoPanel tự xử lý 1 lần khi danh sách hợp nhất về.
  const [type, setType] = useState('delivery');
  const [deliveryMode, setDeliveryMode] = useState('now'); // Gói 55 p10: 'now' = giao ngay, 'scheduled' = hẹn giờ giao
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  // Gói Đón Bình Minh (2026-10-28): ô nhập tay mã người giới thiệu — prefilled
  // từ zm_ref khi đến từ link mời. (Sửa 2026-11-07 #11: ô luôn có trong cụm
  // thu gọn; việc mã có hiệu lực hay không do backend quyết theo hồ sơ khách.)
  const [refCode, setRefCodeState] = useState(() => getRef());
  const [refFromLink] = useState(() => !!getRef());
  const updateRefCode = (v) => { setRefCodeState(v); setRef(v); };
  const [provinces, setProvinces] = useState([]);
  const [province, setProvince] = useState('');
  const [wards, setWards] = useState([]);
  const [ward, setWard] = useState('');
  // Vá F-2 (2026-11-12): cờ "lần đổi tỉnh này đến từ điền địa chỉ lưu" —
  // effect theo tỉnh không được xóa ward của chính lần điền đó (bug đua
  // ghi đè làm ward trống dù khớp được).
  const fillingFromBookRef = useRef(false);
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
  // Gói Ưu đãi hợp nhất (2026-10-31) → Spec panel Ưu đãi (2026-11-14):
  // danh sách hợp nhất từ server (chế độ unified) vẫn nạp tại đây; toàn bộ
  // trạng thái chọn + panel do component dùng chung PromoPanel giữ — trang
  // chỉ nhận kết quả phân xử qua promoRes (payload + tổng + dòng giảm).
  // Khách không chọn = không giảm: bỏ hẳn tự áp ở bề mặt Mini App.
  const [offers, setOffers] = useState(null); // {items, stack_cap_amount}
  const [promoRes, setPromoRes] = useState(EMPTY_PROMO_RES);
  const promoRef = useRef(null); // ensureVoucher() trước khi sang tóm tắt
  const [points, setPoints] = useState(0);
  // Loyalty 2.0: không còn đổi điểm trực tiếp tại checkout — điểm chỉ đổi
  // coupon ở Cửa hàng điểm (trang Tài khoản).
  // Gói 64: bỏ tick VAT trên Mini App (hóa đơn đã kèm mã QR) — giữ state rỗng để không gãy code cũ
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  // UX 2026-10-26 (🟠3): lỗi validate hiện tại trang thay alert() — banner ở bước hiện tại + lỗi riêng dưới ô mã
  const [formErr, setFormErr] = useState('');
  // (voucherErr cũ đã chuyển vào PromoPanel cùng ô nhập voucher.)
  const [customerId, setCustomerId] = useState(null);
  // Spec mật khẩu §5.4/§7.3: email tự nguyện + ô đồng ý NĐ 13 ở đơn đầu.
  const [email, setEmail] = useState('');
  // Mục thu gọn Email + Mã giới thiệu (phán Đại Vương 2026-11-07): mặc định
  // đóng cho gọn form; mở sẵn khi có mã mời gắn từ link để khách thấy mã.
  const [moreInfoOpen, setMoreInfoOpen] = useState(() => !!getRef());
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
    // Mỗi lần điền từ sổ là một "dòng chữ" mới: tăng phiên bản để điểm
    // của lần điền này mang đúng phiên bản đó (xem khối dropoff bên dưới).
    const ver = bumpAddrVer();
    // Sổ #69 (2026-11-04): khớp tên tỉnh/phường qua findPlaceByName (có chuẩn
    // hóa viết tắt/dấu) — khớp chính xác cũ trượt khi sổ lưu "TP. Hồ Chí Minh"
    // mà danh mục là "Thành phố Hồ Chí Minh", kéo theo phường không nạp.
    const pc = findPlaceByName(provinces, a.province)?.code;
    if (pc) {
      // Vá F-2: đánh dấu lần đổi tỉnh này là do ĐIỀN TỪ SỔ để effect
      // theo tỉnh không xóa ward mà chính lần điền này sắp đặt (bug đua).
      if (String(pc) !== String(province)) fillingFromBookRef.current = true;
      setProvince(String(pc));
      loadWards(pc).then((ws) => {
        setWards(ws || []);
        const wc = findPlaceByName(ws || [], a.ward)?.code;
        // Spec bỏ ghim (2026-11-12, mục 3): cơ chế tự chữa phường của vá
        // F-2 (healSavedWard/savedWardName) ĐÃ GỠ — tên phường không khớp
        // danh mục thì ô phường để trống, khách chọn lại theo danh mục
        // hiện hành (chọn lại = sửa chữ → điểm tra lại bằng bậc thang,
        // bậc 2 dùng tên phường mới).
        setWard(wc ? String(wc) : '');
      });
    }
    setStreet(a.street || '');
    // Spec bỏ ghim (2026-11-12, mục 3): địa chỉ lưu ĐÃ có tọa độ và khách
    // không sửa chữ → dùng luôn điểm đó tính phí, KHÔNG tra lại; chưa có
    // tọa độ → điểm trống, bậc thang tra tại checkout từ dòng chữ.
    if (a.lat != null && a.lng != null && Number(a.lat) !== 0 && Number(a.lng) !== 0) {
      const pt = { lat: Number(a.lat), lng: Number(a.lng) };
      setDropoff({ ...pt, step: null, source: 'saved', ver });
      if (branch?.latitude && branch?.longitude) {
        const d = haversineKm(Number(branch.latitude), Number(branch.longitude), pt.lat, pt.lng);
        setKm(Math.round(d * 10) / 10);
        setGeoError(false);
      }
    } else {
      setDropoff(null);
    }
  };
  useEffect(() => {
    if (addrTouched.current || addrId || !addrBook.length) return;
    const d = addrBook.find((a) => a.is_default);
    if (d) { setAddrId(String(d.id)); fillFromAddress(d); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrBook]);
  const [saveAddr, setSaveAddr] = useState(false);
  const [addrLabel, setAddrLabel] = useState('Nhà');
  // Gói 55 p3: popup thông tin nhận hàng
  const [showAddrPop, setShowAddrPop] = useState(false);
  // Gói 50f: gợi ý địa chỉ khi gõ
  const [suggests, setSuggests] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Spec bỏ ghim — tra tọa độ từ địa chỉ chữ (2026-11-12): điểm giao của
  // đơn = điểm tra bậc thang từ DÒNG CHỮ CUỐI CÙNG trong form, hoặc điểm
  // đã lưu của địa chỉ trong sổ (source 'saved'). dropoff mang phiên bản
  // dòng chữ (ver) mà nó thuộc về: khách sửa BẤT KỲ trường địa chỉ nào
  // sau khi đã có điểm → addrVerRef tăng → điểm cũ tự hủy hiệu lực, phải
  // tra lại; không bao giờ chốt đơn bằng điểm của dòng chữ cũ.
  const [dropoff, setDropoff] = useState(null); // {lat, lng, step, source, ver}
  const addrVerRef = useRef(0);
  const bumpAddrVer = () => { addrVerRef.current += 1; return addrVerRef.current; };
  const pointValid = !!dropoff && dropoff.ver === addrVerRef.current;
  // Spec phí giao một nguồn mục 5.2/5.3 (2026-11-06): đơn GIAO HÀNG ở giai
  // đoạn đầu chỉ nhận chuyển khoản — lựa chọn thu hộ được ẨN HẲN khỏi
  // checkout khi công tắc delivery_cod_enabled tắt (không hiện mờ/khóa như
  // trước). Bật công tắc → hiện "Thanh toán khi nhận hàng" ở nhánh ZaloPay.
  const codDeliveryOn = !!(zaloCfg && zaloCfg.cod_enabled && zaloCfg.delivery_cod_enabled);
  const codHiddenForDelivery = type === 'delivery' && !codDeliveryOn;

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
  // Gói 55 p10: kiểm tra trạng thái mở cửa — đóng cửa thì chỉ nhận hẹn giờ
  const st = openStatus(branch);
  const isClosed = st && !st.open;
  const geoTimer = useRef(null);
  const suggestTimer = useRef(null);
  // Gói geocode lai NDAMaps (spec 2026-11-13 mục 2.3): 1 token cho mỗi
  // phiên chọn địa chỉ — đổi token mới sau mỗi lần place thành công và
  // khi đổi chi nhánh. Cả phiên autocomplete + place chốt tính 1 lần tại
  // bước place (dữ kiện tài liệu nhà cung cấp, needs_validation NV-4).
  const newSuggestSession = () => (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const suggestSessionRef = useRef(null);
  if (suggestSessionRef.current === null) suggestSessionRef.current = newSuggestSession();
  useEffect(() => { suggestSessionRef.current = newSuggestSession(); }, [branch?.id]);
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
    // Vá F-2: lần đổi tỉnh do điền từ sổ/GPS thì lần nạp này KHÔNG xóa
    // ward (chính lần điền đó đặt ward qua loadWards riêng của nó) —
    // trước đây effect resolve sau và setWard('') đè mất (ward trống dù
    // khớp được, ca Bến Thành 2026-11-12).
    const fromBook = fillingFromBookRef.current;
    fillingFromBookRef.current = false;
    loadWards(province)
      .then((ws) => { setWards(ws || []); if (!fromBook) setWard(''); });
  }, [province]);

  const fullAddress = () => [street.trim(), wardName(), provName()].filter(Boolean).join(', ');

  const wardName = () => (wards.find((w) => String(w.code) === String(ward)) || {}).name || '';
  const provName = () => (provinces.find((p) => String(p.code) === String(province)) || {}).name || '';

  // Spec bỏ ghim — tra tọa độ từ địa chỉ chữ (2026-11-12, mục 2): điểm
  // chốt của đơn = kết quả tra BẬC THANG (backend geocode) từ dòng chữ
  // CUỐI CÙNG trong form. Điểm đã lưu của địa chỉ trong sổ (source
  // 'saved', khách không sửa chữ) dùng luôn, không tra lại. Cả thang
  // rỗng → geoError (khối lỗi đúng câu spec + nút Tính lại phí ở form),
  // km về null — không để phí 0đ lọt qua.
  const resolveDropoff = async () => {
    if (!branch?.latitude || !branch?.longitude) return;
    if (dropoff && dropoff.ver === addrVerRef.current) {
      const d = haversineKm(Number(branch.latitude), Number(branch.longitude), dropoff.lat, dropoff.lng);
      setKm(Math.round(d * 10) / 10);
      setGeoError(false);
      return;
    }
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    const ver = addrVerRef.current;
    setGeoLoading(true); setGeoError(false);
    try {
      const g = await geocodeLadder({
        q: fullAddress() + ', Việt Nam',
        street: street.trim(), ward: wardName(), province: provName(), branch,
      });
      // Chữ đã đổi giữa lúc tra → kết quả thuộc về dòng chữ cũ, bỏ đi
      // (lượt tra của dòng chữ mới tự chạy theo hiệu ứng dưới đây).
      if (addrVerRef.current !== ver) return;
      // Gói geocode lai NDAMaps (mục 3.2): source do backend trả —
      // 'ladder' khi trúng thang, 'ndamaps_forward' khi trúng cứu cánh
      // (vá §HP: từ vựng của cột dropoff_source, không phải tên nhà cung cấp).
      setDropoff({ lat: g.lat, lng: g.lng, step: g.ladder_step, source: g.source || 'ladder', ver });
      const d = haversineKm(Number(branch.latitude), Number(branch.longitude), g.lat, g.lng);
      setKm(Math.round(d * 10) / 10);
    } catch (e) {
      if (addrVerRef.current !== ver) return;
      setKm(null); setGeoError(true);
    } finally { setGeoLoading(false); }
  };

  // Gợi ý khi gõ (spec mục 1: giữ làm TRỢ GÕ — chọn hay gõ thẳng đều
  // được): thiên vị quanh chi nhánh đang chọn thay cho GPS (đường GPS đã
  // gỡ khỏi Checkout theo spec mục 2).
  const onStreetChange = (v) => {
    setStreet(v);
    bumpAddrVer();
    clearTimeout(suggestTimer.current);
    const q = v.trim();
    if (q.length < 5) { setSuggests([]); setSuggestLoading(false); return; }
    setSuggestLoading(true);
    suggestTimer.current = setTimeout(async () => {
      try {
        // Gói geocode lai NDAMaps (mục 2.4): đáp {source, items} — item
        // NDAMaps mang place_id (chưa có tọa độ), item Nominatim mang
        // lat/lng như trước; chấp nhận cả đáp mảng cũ để khỏi gãy khi
        // backend chưa nạp gói lai.
        const res = await api.geocodeSuggest(q, branch?.latitude, branch?.longitude, suggestSessionRef.current);
        setSuggests(Array.isArray(res) ? res : (res?.items || []));
      } catch { setSuggests([]); }
      finally { setSuggestLoading(false); }
    }, 500);
  };

  const pickSuggest = async (s) => {
    // Gói 55 p3: giữ số nhà user đã gõ tay (VD "90 Tô Hiệu" → chọn gợi ý vẫn giữ "90")
    const typedNo = street.match(/^\d[\d/\-\s]*/)?.[0]?.trim();
    let newStreet = s.short || s.label.split(',')[0];
    if (typedNo && !/^\d/.test(newStreet)) {
      newStreet = `${typedNo} ${newStreet}`;
    }
    const ver = bumpAddrVer();
    setStreet(newStreet);
    setSuggests([]);
    // Gói geocode lai NDAMaps (mục 2.2): chọn gợi ý NDAMaps → chốt ngay
    // tọa độ bản ghi làm điểm giao (source 'ndamaps_place', gắn cùng
    // phiên bản dòng chữ như điểm thang). Điểm không dùng được (lệch
    // tỉnh / quá xa / place lỗi) → chỉ điền chữ, điểm chốt do đường B
    // quyết ở bước tính phí (hiệu ứng theo street tự chạy bậc thang).
    // Chọn gợi ý Nominatim → giữ hành vi cũ: chỉ điền chữ, điểm chốt
    // vẫn tra bậc thang từ dòng chữ cuối cùng.
    if (!s.place_id) return;
    try {
      const p = await api.geocodePlace(s.place_id, suggestSessionRef.current, provName(), branch?.latitude, branch?.longitude);
      if (p?.lat && p?.lng) {
        if (addrVerRef.current !== ver) return;
        setDropoff({ lat: p.lat, lng: p.lng, step: null, source: 'ndamaps_place', ver });
        if (branch?.latitude && branch?.longitude) {
          const d = haversineKm(Number(branch.latitude), Number(branch.longitude), p.lat, p.lng);
          setKm(Math.round(d * 10) / 10);
          setGeoError(false);
        }
        // Phiên chọn đã chốt bằng place → đổi token mới cho phiên sau.
        suggestSessionRef.current = newSuggestSession();
      }
    } catch { /* chỉ điền chữ, không lỗi cho khách */ }
  };

  useEffect(() => {
    if (type !== 'delivery') return;
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(resolveDropoff, 800);
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
          api.addresses(c.id, c.phone, c.member_code).then((r) => setAddrBook(Array.isArray(r) ? r : [])).catch(() => {}); // Sổ phụ #31: r là mảng thuần (req đã bóc phong bì)
          return api.eligiblePromotions({ ...payload, customer_id: c.id, phone: formatPhone(phone), member_code: getProfile()?.member_code || '' });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setOffers).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [phone, subtotal, km, shipCfg, type]);

  // Xử lý coupon chọn sẵn từ Ví + tự nhả lựa chọn mất điều kiện khi danh
  // sách hợp nhất nạp lại: đã chuyển vào PromoPanel (component giữ lựa chọn).

  // Spec phí giao MỘT NGUỒN (2026-11-06): phí hiển thị = đúng công thức nội
  // bộ server sẽ chốt (haversine tọa độ điểm giao + bảng phí), trừ phần quán hỗ
  // trợ theo cấu hình — modal địa chỉ, tổng checkout và đơn đã tạo khớp nhau
  // theo cấu trúc. Không còn số nào từ báo giá hãng ở đường khách.
  const shipFeeGross = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
  const shipShopSupport = type === 'delivery' && shipCfg && subtotal >= (Number(shipCfg.support_threshold) || 0)
    ? Math.min(Number(shipCfg.support_amount) || 0, shipFeeGross) : 0;
  const shipFee = Math.max(0, shipFeeGross - shipShopSupport);

  // Gói mở COD giao hàng (2026-11-11): phí thu hộ COD cộng SAU hỗ trợ +
  // KM phí ship (không bị nuốt) — gương đúng thứ tự server chốt ở store().
  // Kênh hiệu dụng cho phí: cùng luật tự hiệu chỉnh của place() (BANK mất
  // khả dụng → COD và ngược lại; đơn giao + thu hộ tắt → BANK). Đơn chưa
  // tra được điểm (km null, phí khoảng cách 0) vẫn cộng như server.
  const feeChannel = (() => {
    if (!zaloCfg) return payChannel;
    let ch = payChannel;
    if (ch === 'BANK' && !zaloCfg.bank_available && zaloCfg.cod_enabled) ch = 'COD';
    if (ch === 'COD' && !zaloCfg.cod_enabled && zaloCfg.bank_available) ch = 'BANK';
    if (ch === 'COD' && type === 'delivery' && !codDeliveryOn) ch = 'BANK';
    return ch;
  })();
  const shipCodFee = type === 'delivery' && feeChannel === 'COD' && codDeliveryOn && shipCfg
    ? (Number(shipCfg.ship_cod_fee) || 0) : 0;

  // ===== Phân xử hiển thị §5d: PromoPanel chạy (gương store()) và trả
  // kết quả qua promoRes — bất biến sống còn: TỔNG HIỂN THỊ = SỐ SERVER THU.
  const shipDiscTotal = promoRes.shipDiscTotal;
  const moneyDiscTotal = promoRes.moneyDiscTotal;
  const totalDiscTotal = promoRes.totalDiscTotal;
  // Loyalty 2.0: bỏ pointDisc — tổng không còn dòng trừ điểm
  const total = Math.max(0, subtotal + shipFee - shipDiscTotal - moneyDiscTotal + shipCodFee);

  // Spec bỏ ghim (2026-11-12): cổng hiển thị của đơn giao — chưa có điểm
  // tra còn hiệu lực cho dòng chữ hiện tại → phí "Chưa tính được", tổng
  // "—", nút đặt khóa.
  const pointMissing = type === 'delivery' && !pointValid;

  // Chọn mã / validate voucher / tự nhả lựa chọn mất điều kiện: đã chuyển
  // vào PromoPanel. Đổi loại đơn → PromoPanel remount theo key={type} nên
  // lựa chọn ưu đãi tự reset (không áp dụng sang loại mới).
  const switchType = (t) => {
    setType(t);
  };

  // Validate bước 1 rồi sang tóm tắt
  const goSummary = async () => {
    setFormErr('');
    if (!name.trim() || !phone.trim()) { setFormErr('Nhập tên và số điện thoại ở phần thông tin nhận hàng phía trên.'); return; }
    // Luật SĐT 2026-11-07: bắt đầu bằng 0 thì phải đủ đúng 10 số.
    if (!validPhone(phone)) { setFormErr('Số điện thoại chưa đúng — cần bắt đầu bằng 0 và đủ 10 số.'); return; }
    // 🟠8: có mã voucher chưa validate → PromoPanel validate trước khi
    // sang bước 2 để tổng hiển thị ở bước 2 đã gồm số giảm/không gồm mã sai.
    const okVoucher = await promoRef.current?.ensureVoucher();
    if (okVoucher === false) return;
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
    // Spec bỏ ghim (2026-11-12): cổng client của luật cứng phía server
    // (422 dropoff_geocode_failed) — đơn giao chưa có điểm tra còn hiệu
    // lực cho dòng chữ hiện tại thì chặn ngay tại đây (nút đặt cũng khóa
    // sẵn; đây là lớp chặn cho đường gọi place() vòng qua nút).
    if (type === 'delivery' && !pointValid) {
      setFormErr('Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.');
      setShowAddrPop(true);
      return;
    }
    setPlacing(true);
    try {
      // Spec phí giao MỘT NGUỒN: không còn bước chờ/báo giá hãng ở đường
      // khách — phí chốt từ tọa độ điểm giao (một nguồn) ở server.
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
      // SPEC-01 + Gói Checkout SDK (Đ3, 2026-11-10): MỌI đơn đều đi qua
      // checkout-orders + Checkout SDK — zaloCfg chỉ còn để hiệu chỉnh
      // kênh theo cấu hình thật; không còn nhánh tạo đơn ngoài SDK.
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
        // Đơn giao khi thu hộ đang tắt: COD bị ẩn — kênh đang chọn rơi về BANK
        if (effChannel === 'COD' && type === 'delivery' && !codDeliveryOn) effChannel = 'BANK';
        if (effChannel !== payChannel) setPayChannel(effChannel);
      } else {
        // Gói Checkout SDK (Đ3): chưa tải được cấu hình kênh thì suy kênh
        // SDK từ chính lựa chọn PTTT của khách (transfer → BANK ·
        // pay_at_store → COD) — giữ nguyên luật ẩn COD cho đơn giao ở
        // hiệu ứng phía trên (đơn giao luôn ép về transfer).
        effChannel = payment === 'transfer' ? 'BANK' : 'COD';
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
        // Spec bỏ ghim (2026-11-12, mục 4): địa chỉ giao trên đơn = địa
        // chỉ chữ ghép từ 3 trường form (số nhà + đường, phường, tỉnh) —
        // đúng dòng điền sẵn của ô chi tiết cũ. KDS + chi tiết đơn Admin
        // đọc trường này để quán tự đặt ship. Ghi chú cho shipper đi ở
        // delivery_note như cũ.
        delivery_address: type === 'delivery' ? fullAddress() : null,
        province: type === 'delivery' ? provName() : null,
        ward: type === 'delivery' ? wardName() : null,
        distance_km: type === 'delivery' ? km : null,
        delivery_note: type === 'delivery' && deliveryNote.trim() ? deliveryNote.trim() : null,
        // Spec phí giao MỘT NGUỒN: khách không chọn hãng/gói nữa — quán điều
        // phối hãng sau khi có đơn; phí do server chốt theo bảng nội bộ.
        delivery_package: null,
        delivery_quoted_fee: null,
        delivery_provider: null,
        // Gói 61b + spec phí giao một nguồn: tọa độ điểm giao tại đây —
        // server tính phí từ đúng cặp tọa độ này. Nguồn điểm (spec bỏ
        // ghim 2026-11-12): tra bậc thang từ địa chỉ chữ, hoặc điểm đã
        // lưu của địa chỉ trong sổ.
        delivery_dropoff_lat: type === 'delivery' ? dropoff?.lat || null : null,
        delivery_dropoff_lng: type === 'delivery' ? dropoff?.lng || null : null,
        // Gói geocode lai NDAMaps (2026-11-13 mục 3.3): nguồn điểm giao
        // của đơn — server chỉ validate thuộc tập 4 giá trị rồi lưu.
        dropoff_source: type === 'delivery' ? dropoff?.source || null : null,
        scheduled_at: scheduledAt,
        payment_method: effChannel === 'BANK' ? 'transfer' : 'pay_at_store',
        // SPEC-01 + Gói Checkout SDK (Đ3): luôn gửi kênh SDK đã hiệu
        // chỉnh/suy ra ở trên — mọi đơn đều qua checkout-orders.
        pay_channel: effChannel,
        // Spec panel Ưu đãi (2026-11-14): chỉ gửi ĐÚNG những gì khách đã
        // chọn trong PromoPanel — voucher đã nhận nhưng chưa áp thì không
        // gửi (tránh server áp thay lựa chọn của khách); không chọn gì →
        // cả 3 trường rỗng, đơn không giảm. Cặp KM + coupon ví gửi cả
        // promotion_id + customer_coupon_id (§5d phía server đã mở).
        voucher_code: promoRes.voucher_code,
        promotion_id: promoRes.promotion_id,
        customer_coupon_id: promoRes.customer_coupon_id,
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
      // Gói Checkout SDK (Đ3): tạo đơn QUA checkout-orders trong MỌI
      // trường hợp → nhận SDK params. Đã bỏ hẳn đường api.createOrder
      // song song ngoài SDK cho luồng đặt đơn này.
      const res = await api.checkoutOrder(orderPayload);
      order = res.order;
      sdkParams = res.sdk_params;
      // Spec QR 2026-10-21: giữ thông tin CK để hiện màn "Chờ thanh toán"
      if (effChannel === 'BANK' && res.bank_info) {
        bankTransfer = {
          bank_info: res.bank_info,
          transfer_content: res.transfer_content,
          amount: Math.round(Number(order.total_amount) || 0),
        };
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
          // Spec bỏ ghim (2026-11-12, mục 3): địa chỉ mới lưu kèm điểm
          // đã dùng để lần sau khỏi tra lại.
          lat: dropoff?.lat ?? null, lng: dropoff?.lng ?? null,
        }).catch(() => {});
      }
      // Spec bỏ ghim (2026-11-12, mục 3): đơn đặt thành công bằng địa chỉ
      // ĐÃ CHỌN trong sổ → lưu điểm đã dùng (kèm dòng chữ đã dùng) vào
      // chính bản ghi đó để lần sau khỏi tra — chỉ PATCH khi điểm hoặc
      // chữ thật sự khác bản ghi. PATCH mang lat/lng tường minh nên luật
      // chống trôi phía server không xóa điểm này.
      if (type === 'delivery' && customerId && addrId && dropoff) {
        const a = addrBook.find((x) => String(x.id) === String(addrId));
        if (a && (Number(a.lat) !== dropoff.lat || Number(a.lng) !== dropoff.lng
          || String(a.street || '') !== street.trim()
          || String(a.ward || '') !== wardName()
          || String(a.province || '') !== provName())) {
          api.updateAddress(a.id, {
            customer_id: customerId, phone: formatPhone(phone), member_code: getProfile()?.member_code || '',
            label: a.label, province: provName(), ward: wardName(), street: street.trim(),
            lat: dropoff.lat, lng: dropoff.lng,
          }).then(() => {
            setAddrBook((prev) => prev.map((x) => (String(x.id) === String(a.id)
              ? { ...x, lat: dropoff.lat, lng: dropoff.lng, street: street.trim(), ward: wardName(), province: provName() }
              : x)));
          }).catch(() => {});
        }
      }
      // Gói vá sau vòng S — Mục 1 (2026-11-12): clearCart() KHÔNG còn xóa
      // tại đây (trước khi mở SDK) — SDK lỗi thì khách còn nhìn tóm tắt
      // 0 món · 0đ trong lúc chờ chuyển màn. Giỏ chỉ xóa ở các nhánh sắp
      // rời trang bên dưới, sau khi lượt mở SDK đã ngã ngũ.

      // Gói Checkout SDK: mở trang thanh toán Zalo qua CheckoutSDK
      // (utils/checkoutSdk — import từ 'zmp-sdk/apis'). Mở được và có
      // orderId phía SDK thì gắn về server để notify đối chiếu đơn
      // (lỗi gắn chỉ cảnh báo, không chặn khách). Trạng thái đơn thật do
      // server quyết qua notify/đối soát — kết quả client chỉ để hiển thị.
      let sdkFailed = false;
      let sdkErrDetail = ''; // Mục 2 gói vá sau vòng S: chi tiết lỗi gốc (chặng/name/message) nối vào banner
      if (sdkParams) {
        try {
          const sdkRes = await openCheckout(sdkParams);
          if (sdkRes?.orderId) {
            api.linkSdkOrder(order.code, sdkRes.orderId).catch((e) => console.warn('Gắn mã đơn SDK lỗi:', e));
          }
        } catch (sdkErr) {
          console.warn('Không mở được Checkout SDK:', sdkErr);
          sdkFailed = true;
          sdkErrDetail = sdkErr?.message || '';
        }
      }

      if (sdkFailed) {
        // Đ3 + spec §3 (thay hành vi cũ "rơi về CK tay"): SDK không mở
        // được → báo rõ tại trang, đơn GIỮ pending_payment chờ "Thanh
        // toán tiếp" trong mục Đơn hàng; dừng ít giây cho khách đọc rồi
        // BANK → màn trạng thái /pay-wait, COD → trang theo dõi đơn.
        setFormErr('Không mở được trang thanh toán của Zalo. Đơn của bạn đã được lưu — bạn có thể thanh toán tiếp trong mục Đơn hàng.' + (sdkErrDetail ? ` [${sdkErrDetail}]` : ''));
        setTimeout(() => {
          clearCart(); // Mục 1: rời trang mới xóa giỏ (sau khi khách đã đọc banner)
          if (bankTransfer) nav(`/pay-wait/${order.code}`, { state: { transfer: bankTransfer } });
          else nav(`/track?code=${order.code}`);
        }, 2600);
      } else if (bankTransfer) {
        // Spec QR 2026-10-21: đơn BANK (phương án A) luôn kết thúc ở màn "Chờ thanh toán";
        // gói vá sau vòng S (Mục 4): màn chờ chỉ còn trạng thái + Thanh toán
        // tiếp + Đã chuyển khoản — NV xác nhận tay sau khi đối chiếu sao kê.
        clearCart(); // Mục 1: rời trang mới xóa giỏ
        nav(`/pay-wait/${order.code}`, { state: { transfer: bankTransfer } });
      } else {
        clearCart(); // Mục 1: rời trang mới xóa giỏ
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

  // Kênh hiệu dụng ở màn tóm tắt — gương đúng luật tự hiệu chỉnh của
  // place() (BANK mất khả dụng → COD và ngược lại; đơn giao + thu hộ tắt
  // → BANK; chưa có cấu hình Zalo thì suy từ lựa chọn PTTT của khách).
  // Khối hướng dẫn chuyển khoản ở bước 2 bám theo kênh này.
  const summaryChannel = (() => {
    if (!zaloCfg) return payment === 'transfer' ? 'BANK' : 'COD';
    let ch = payChannel;
    if (ch === 'BANK' && !zaloCfg.bank_available && zaloCfg.cod_enabled) ch = 'COD';
    if (ch === 'COD' && !zaloCfg.cod_enabled && zaloCfg.bank_available) ch = 'BANK';
    if (ch === 'COD' && type === 'delivery' && !codDeliveryOn) ch = 'BANK';
    return ch;
  })();

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
              {phone && !validPhone(phone) && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>Số điện thoại cần bắt đầu bằng 0 và đủ 10 số.</div>
              )}
            </div>
            {type === 'delivery' && (
              <>
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
                        {[street, wardName(), provName()].filter(Boolean).join(', ') || 'Nhập địa chỉ'}
                      </div>
                      {pointValid && km != null && (
                        <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>✓ Đã tính phí giao theo địa chỉ — cách quán ~{km}km</div>
                      )}
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
        if (!id) { bumpAddrVer(); setDropoff(null); return; }
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
  {/* Spec bỏ ghim (2026-11-12, mục 1): Tỉnh/TP + Phường/Xã MỘT HÀNG HAI CỘT */}
  <div style={{ display: 'flex', gap: 8 }}>
    <div className="zm-field" style={{ flex: 1, minWidth: 0 }}>
      <label>Tỉnh / Thành phố *</label>
      <SearchSelect
        value={province} placeholder="— Chọn tỉnh/thành —"
        options={provinces.map((p) => ({ code: p.code, name: p.name }))}
        onChange={(c) => { fillingFromBookRef.current = false; bumpAddrVer(); setProvince(c); setAddrId(''); }}
      />
    </div>
    <div className="zm-field" style={{ flex: 1, minWidth: 0 }}>
      <label>Phường / Xã *</label>
      <SearchSelect
        value={ward} placeholder="— Chọn phường/xã —" disabled={!province}
        options={wards.map((w) => ({ code: w.code, name: w.name }))}
        onChange={(c) => { bumpAddrVer(); setWard(c); }}
      />
    </div>
  </div>
  <div className="zm-field" style={{ position: 'relative' }}>
    <label>Số nhà, tên đường *</label>
    <input
      value={street}
      onChange={(e) => onStreetChange(e.target.value)}
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
  {/* Spec bỏ ghim (2026-11-12, mục 2): tra rỗng cả bậc thang → khối lỗi
      ĐÚNG CÂU SPEC ngay trong form + nút Tính lại phí tra lại tại chỗ;
      nút đặt đơn khóa tới khi có điểm. */}
  {geoError && (
    <div className="zm-alert" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}>
      Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.
      <button type="button" onClick={resolveDropoff} style={{ display: 'block', marginTop: 8, fontWeight: 700, color: '#b91c1c', textDecoration: 'underline' }}>Tính lại phí</button>
    </div>
  )}
  <div className="zm-field">
    <label>Ghi chú cho shipper</label>
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
                      <button className="zm-btn-primary zm-pop-save" onClick={() => setShowAddrPop(false)}>Lưu</button>
                    </div>
                  </div>
                )}
              </>
            )}
            {/* Mục thu gọn (phán Đại Vương 2026-11-07): Email + Mã người giới
                thiệu dồn vào một mục riêng mặc định đóng cho gọn form. Giá trị
                đã nhập vẫn gửi đi y nguyên kể cả khi mục đang đóng. */}
            <div style={{ margin: '0 0 6px' }}>
              <button type="button" onClick={() => setMoreInfoOpen(!moreInfoOpen)} aria-expanded={moreInfoOpen}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 0, padding: '6px 0', cursor: 'pointer', color: '#24305E', fontSize: 13.5, fontWeight: 700, textAlign: 'left', minHeight: 44 }}>
                <span style={{ flex: 1 }}>Thêm email / mã giới thiệu (không bắt buộc)</span>
                <span style={{ fontSize: 12, color: '#888' }}>{moreInfoOpen ? '▾' : '▸'}</span>
              </button>
              {moreInfoOpen && (
                <>
                  {/* Spec mật khẩu §7.3: email tự nguyện ở checkout — chỉ điền
                      vào hồ sơ khi hồ sơ đang trống (server quyết). */}
                  <div className="zm-field">
                    <label>Email <span style={{ color: '#888', fontWeight: 400 }}>(không bắt buộc — chỉ dùng cho thông báo bảo mật)</span></label>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email của bạn" type="email" maxLength={150} />
                  </div>
                  {/* Gói Đón Bình Minh (2026-10-28): mã người giới thiệu; từ
                      link thì hiện sẵn mã đã gắn. Sửa 2026-11-07 (#11): bỏ
                      cổng ẩn !hasPriorOrders trong cụm thu gọn — cổng đó làm
                      ô biến mất với mọi tài khoản đã có đơn (kể cả đơn vừa
                      đặt trong cùng phiên thử) trong khi tiêu đề mục hứa có
                      ô này. Backend vẫn là nơi quyết: referred_by chỉ được
                      gắn khi TẠO khách mới, khách cũ nhập mã cũng không đổi
                      hồ sơ (OnlineOrderController) — payload gửi đi không đổi. */}
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
                </>
              )}
            </div>
            {/* Spec mật khẩu §5.4: ô đồng ý NĐ 13 ở đơn đầu — chưa tích thì
                nút đặt đơn khóa (cổng cứng ở server, xem place()). */}
            {consentNeeded && (
              <div style={{ margin: '4px 0 8px' }}>
                <ConsentCheck checked={consentChecked} onChange={setConsentChecked} />
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
                {/* Spec phí giao mục 5.2/5.3: đơn giao + thu hộ TẮT → ẩn hẳn lựa
                    chọn này; thu hộ BẬT → nhãn "Thanh toán khi nhận hàng" */}
                {zaloCfg.cod_enabled && !codHiddenForDelivery && (
                  <div
                    className={`zm-pay-opt ${payChannel === 'COD' ? 'on' : ''}`}
                    onClick={() => setPayChannel('COD')}
                  >
                    <div className="dot" /><div><b>{type === 'delivery' ? 'Thanh toán khi nhận hàng' : 'Trả tại quán'}</b><div style={{ fontSize: 12, color: '#888' }}>
                      {type === 'delivery' ? 'Trả tiền mặt cho shipper khi nhận món' : 'Trả tiền khi nhận món'}
                    </div>
                    {type === 'delivery' && shipCfg && Number(shipCfg.ship_cod_fee) > 0 && (
                      <div style={{ fontSize: 12, color: '#888' }}>Cộng phí thu hộ COD {fmt(Number(shipCfg.ship_cod_fee))}đ vào phí giao hàng</div>
                    )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Fallback luồng cũ khi chưa có cấu hình */
              (payMethods.length ? payMethods : [
                { value: 'transfer', label: 'Chuyển khoản / QR', desc: 'Quán xác nhận đã nhận tiền rồi mới làm món' },
                { value: 'pay_at_store', label: 'Thanh toán tại quán', desc: 'Trả tiền khi nhận món' },
              ])
                // Spec phí giao mục 5.2/5.3: nhánh dự phòng KHÔNG có thu hộ cho
                // đơn giao ở cả 2 giai đoạn — ẩn hẳn "Thanh toán tại quán".
                .filter((m) => !(m.value === 'pay_at_store' && type === 'delivery'))
                .map((m) => (
                  <div key={m.value}
                    className={`zm-pay-opt ${payment === m.value ? 'on' : ''}`}
                    onClick={() => setPayment(m.value)}>
                    <div className="dot" /><div><b>{m.label}</b><div style={{ fontSize: 12, color: '#888' }}>{m.desc}</div></div>
                  </div>
                ))
            )}

            {/* Gói 64: bỏ tick xuất VAT trên Mini App (hóa đơn đã kèm mã QR cho khách quét nhập thông tin) */}

            {/* ===== Spec panel Ưu đãi (2026-11-14): khối Ưu đãi + panel
                chọn do component dùng chung PromoPanel đảm nhiệm (dùng
                chung với Checkout đơn nhóm). key theo loại đơn: đổi loại
                → remount, lựa chọn ưu đãi reset như hành vi cũ. ===== */}
            <PromoPanel
              key={type}
              ref={promoRef}
              offers={offers}
              subtotal={subtotal}
              shipFee={shipFee}
              phone={phone}
              preselectCouponId={location.state?.couponId || null}
              onResolve={setPromoRes}
            />
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

          {/* Khối hướng dẫn thanh toán (Đại Vương chốt 2026-11-13 ~00:01):
              khách chọn Chuyển khoản (BANK) thì đọc TRƯỚC khi tờ QR của
              Zalo mở — biết trước chuyển xong thì đóng màn QR để về theo
              dõi đơn. Chỉ BANK, COD không hiện. Câu chữ nguyên văn ngài
              duyệt; v1 chưa nhắc nút "Đã chuyển khoản" (chờ hướng vá A2). */}
          {summaryChannel === 'BANK' && (
            <div style={{ background: '#f0f4ff', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#24305E', marginBottom: 4 }}>Thanh toán bằng chuyển khoản</div>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.55 }}>
                Zalo sẽ hiện mã QR để bạn quét bằng app ngân hàng. Chuyển khoản xong, bạn có thể đóng màn hình QR để tiếp tục theo dõi đơn hàng tại đây.
              </div>
            </div>
          )}

          {/* Phí & tổng */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Chi tiết thanh toán</div>
            {type === 'delivery' && (
              <div className="zm-total-row">
                <span>Phí vận chuyển{km != null ? ` (~${km}km)` : ''}</span>
                <span>{pointMissing ? 'Chưa tính được' : (km != null ? `${fmt(shipFeeGross + shipCodFee)}đ` : (shipCodFee > 0 ? `${fmt(shipCodFee)}đ` : 'Quán xác nhận'))}</span>
              </div>
            )}
            {type === 'delivery' && !pointMissing && shipCodFee > 0 && (
              <div style={{ fontSize: 12, color: '#888', margin: '-2px 0 6px' }}>
                {shipShopSupport > 0 ? 'Phí giao hàng đã được hỗ trợ · ' : ''}Đã gồm phí thu hộ COD {fmt(shipCodFee)}đ{km == null ? ' · Phí khoảng cách quán xác nhận sau' : ''}
              </div>
            )}
            {type === 'delivery' && shipShopSupport > 0 && (
              <div className="zm-total-row disc"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="store" size={14} />Quán hỗ trợ phí ship</span><span>−{fmt(shipShopSupport)}đ</span></div>
            )}
            {/* Spec panel Ưu đãi (2026-11-14): các dòng giảm do phân xử §5d
                của PromoPanel sinh ra — chỉ ưu đãi ĐANG ÁP mới có dòng */}
            {promoRes.shipApplied.filter((s) => s.amount > 0).map((s) => (
              <div key={`${s.kind}-${s.id}`} className="zm-total-row disc"><span>{s.kind === 'wallet_coupon' ? <CouponIcon size={14} /> : '🚚'} {s.name} (phí ship)</span><span>−{fmt(s.amount)}đ</span></div>
            ))}
            {promoRes.giftApplied.map((g) => (
              <div key={`${g.kind}-${g.id}`} className="zm-total-row disc"><span>🎁 {g.name}</span><span>Tặng {g.gift_product_name}</span></div>
            ))}
            {promoRes.promoApplied && (
              <div className="zm-total-row disc">
                <span>🎉 {promoRes.promoApplied.name}</span>
                <span>−{fmt(promoRes.promoApplied.amount)}đ</span>
              </div>
            )}
            {promoRes.couponApplied && (
              <div className="zm-total-row disc">
                <span><CouponIcon size={14} /> {promoRes.couponApplied.source === 'voucher' ? 'Voucher' : 'Coupon'} {promoRes.couponApplied.code}{promoRes.couponApplied.state === 'stacked' ? ' (cộng dồn)' : ''}</span>
                <span>−{fmt(promoRes.couponApplied.amount)}đ</span>
              </div>
            )}
            <div className="zm-total-row grand"><span>Tổng cộng</span><span>{pointMissing ? '—' : `${fmt(total)}đ`}</span></div>
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
            <button className="zm-btn-primary" style={{ flex: 2 }} disabled={placing || pointMissing} onClick={place}>
              {placing ? 'Đang đặt...' : (pointMissing ? 'Đặt đơn' : `Đặt hàng · ${fmt(total)}đ`)}
            </button>
          </div>
          {pointMissing && (
            <div onClick={() => { setStep(1); setShowAddrPop(true); }}
              style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 12, padding: '10px 12px', fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
              Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại. (Chạm vào đây để mở lại mục địa chỉ)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
