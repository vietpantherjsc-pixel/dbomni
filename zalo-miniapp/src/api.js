// Gói 6 (2026-10-05): Zalo Mini App đặt món — mobile-first, phong cách GrabFood.
// API tương đối để chạy được trên điện thoại thật (qua proxy Vite lúc dev,
// hoặc cùng host lúc production). Build cho server riêng:
// VITE_API_BASE=https://ten-mien.com/api/online npm run build
import { storage } from './utils/storage'; // Spec P4-P5: qua module storage (zmp-sdk) — TESTER P5: thiếu import gây ReferenceError
import appConfig from '../app-config.json'; // Gói Đón Bình Minh: app_id lấy từ file cấu hình, không ghi cứng rải rác
export const API = import.meta.env.VITE_API_BASE || '/api/online';
// Link mở Mini App chính thức của Zalo (deep-link chia sẻ kèm mã mời).
// Nguồn ID đúng (2026-11-07): biến môi trường lúc dựng VITE_MINIAPP_ID
// (Mini App ID lấy tại mini.zalo.me/developers) — app-config do zmp init
// sinh KHÔNG còn mục app.id, còn file app-config cũ trên cây mang Zalo
// App ID (không phải Mini App ID) nên chỉ để làm dự phòng cuối.
export const MINI_APP_ID = import.meta.env.VITE_MINIAPP_ID || appConfig?.app?.id || '';
export const miniAppLink = (refCode) => `https://zalo.me/s/${MINI_APP_ID}${refCode ? `?ref=${encodeURIComponent(refCode)}` : ''}`;
export const GREEN = '#24305E'; // fallback; màu thật lấy từ /theme qua loadTheme()

// Spec đăng nhập SĐT + mật khẩu §3.1: phiên token (khóa zm_session) gửi
// qua header Authorization: Bearer — không đưa token vào URL.
async function req(path, opts = {}) {
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const sess = getSession();
  if (sess?.token) headers['Authorization'] = `Bearer ${sess.token}`;
  const res = await fetch(`${API}${path}`, {
    headers,
    ...opts,
  });
  const data = await res.json();
  if (!data.success) {
    const e = new Error(data.message || 'Có lỗi xảy ra');
    e.code = data.code || null; // vd consent_required, account_locked
    e.status = res.status;
    e.errors = data.errors || null; // danh sách lỗi validator mật khẩu
    throw e;
  }
  return data.data;
}

// Như req() nhưng trả nguyên JSON (kể cả lỗi) — cho các luồng mật khẩu cần
// đọc mã lỗi / danh sách lỗi / số phút khóa.
async function reqRaw(path, opts = {}) {
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const sess = getSession();
  if (sess?.token) headers['Authorization'] = `Bearer ${sess.token}`;
  const res = await fetch(`${API}${path}`, {
    headers,
    ...opts,
  });
  return res.json();
}

export const api = {
  branches: () => req('/branches'),
  menu: (branchId) => req(`/display-menus?unique=1${branchId ? `&branch_id=${branchId}` : ''}`), // Gói 7g: theo Thực đơn; unique=1: món trùng chỉ hiện 1 lần ở thực đơn trên cùng. Gói 25: lọc món/thực đơn bị ẩn ở CN
  shipConfig: () => req('/ship-config'),
  // Gói 50e: geocode qua backend (tránh Zalo chặn domain OSM)
  geocode: (q) => req(`/geocode?q=${encodeURIComponent(q)}`),
  geocodeReverse: (lat, lon) => req(`/geocode/reverse?lat=${lat}&lon=${lon}`), // Gói 55 p3
  // Gói 55 p11ac: tỉnh/thành + xã/phường qua backend (Zalo WebView chặn domain lạ)
  provinces: () => req('/provinces'),
  wards: (provinceCode) => req(`/wards?province=${provinceCode}`),
  // Gói 55 p11ac: PTTT cho Mini App (map type -> value backend chấp nhận)
  // Spec QR 2026-10-21: ẩn HẲN kênh ZaloPay (chưa dùng được) khỏi danh sách PTTT.
  payMethods: () => req('/payment-methods/active?channel=zalo&active=1').then((list) =>
    (list || [])
      .filter((m) => !String(m.type || '').toLowerCase().includes('zalo'))
      .map((m) => ({
        value: m.type === 'cash' ? 'pay_at_store' : m.type,
        label: m.name,
        desc: m.type === 'transfer' ? 'Quán xác nhận đã nhận tiền rồi mới làm món' : 'Trả tiền khi nhận món',
      }))
      // Chốt chặn khử trùng (2026-11-07): bảng cấu hình PTTT có dòng trùng
      // value (vd 2 dòng chuyển khoản cùng bật cho kênh Zalo) thì checkout
      // chỉ hiện 1 mục — giữ đúng dòng đầu tiên của mỗi value.
      .filter((m, i, arr) => arr.findIndex((x) => x.value === m.value) === i)
  ),
  // Gói 50f: gợi ý địa chỉ khi gõ
  geocodeSuggest: (q, lat, lon) => req(`/geocode/suggest?q=${encodeURIComponent(q)}${lat ? `&lat=${lat}&lon=${lon}` : ''}`),
  // Gói 9: trang chủ kiểu GrabFood
  // Gói 10f: shopInfo theo chi nhánh -> cover riêng (chưa có thì cover chung)
  shopInfo: (branchId) => req(`/shop-info${branchId ? `?branch_id=${branchId}` : ''}`),
  // Gói chính sách Mini App vào Cài đặt Admin: nội dung chính sách mới nhất
  // (Admin tự sửa ở Thiết lập); popup mở mới gọi, lỗi thì dùng bản dự phòng.
  privacyPolicy: () => req('/privacy-policy'),
  saleProducts: () => req('/sale-products'),
  topProducts: (branchId) => req(`/top-products${branchId ? `?branch_id=${branchId}` : ''}`), // Gói 34: top 10 bán chạy
  // Gói 9: đặt đơn nhóm
  groupCreate: (payload) => req('/group-orders', { method: 'POST', body: JSON.stringify(payload) }),
  groupGet: (code) => req(`/group-orders/${encodeURIComponent(code)}`),
  groupAddItem: (code, payload) => req(`/group-orders/${encodeURIComponent(code)}/items`, { method: 'POST', body: JSON.stringify(payload) }),
  groupUpdateItem: (code, id, payload) => req(`/group-orders/${encodeURIComponent(code)}/items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  groupRemoveItem: (code, id) => req(`/group-orders/${encodeURIComponent(code)}/items/${id}`, { method: 'DELETE' }),
  groupCheckout: (code, payload) => req(`/group-orders/${encodeURIComponent(code)}/checkout`, { method: 'POST', body: JSON.stringify(payload) }),
  // Gói 11: nhận đơn POS vào tài khoản qua QR tích điểm
  claimOrder: (code, payload) => req(`/orders/${encodeURIComponent(code)}/claim`, { method: 'POST', body: JSON.stringify(payload) }),
  shippingFee: (distance_km) => req('/shipping-fee', { method: 'POST', body: JSON.stringify({ distance_km }) }),
  eligiblePromotions: (payload) => req('/promotions/eligible', { method: 'POST', body: JSON.stringify(payload) }),
  // Audit 2026-10-21 🟠8: validate voucher gõ tay để hiện số giảm vào tổng trước khi đặt
  validateVoucher: (payload) => req('/voucher/validate', { method: 'POST', body: JSON.stringify(payload) }),
  promoBanners: () => req('/promo-banners'), // Gói 48: banner KM carousel
  // Gói 49: sổ địa chỉ giao hàng
  addresses: (customerId, phone, memberCode) => req(`/addresses?customer_id=${customerId}&phone=${encodeURIComponent(phone || '')}&member_code=${encodeURIComponent(memberCode || '')}`),
  saveAddress: (payload) => req('/addresses', { method: 'POST', body: JSON.stringify(payload) }),
  updateAddress: (id, payload) => req(`/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteAddress: (id, customerId, phone, memberCode) => req(`/addresses/${id}?customer_id=${customerId}&phone=${encodeURIComponent(phone || '')}&member_code=${encodeURIComponent(memberCode || '')}`, { method: 'DELETE' }),
  customerByPhone: (phone, memberCode) => req(`/customer?phone=${encodeURIComponent(phone)}&member_code=${encodeURIComponent(memberCode)}`),
  // Spec đăng nhập SĐT + mật khẩu §3–§4: hồ sơ theo phiên token hiện tại.
  customerMe: () => req('/customer'),
  // Spec đăng nhập SĐT + mật khẩu §4: các endpoint mật khẩu/phiên — dùng
  // reqRaw để phía gọi đọc được mã lỗi (account_locked, weak_password…)
  // và danh sách lỗi validator.
  passwordLogin: (payload) => reqRaw('/customer/password/login', { method: 'POST', body: JSON.stringify(payload) }),
  passwordZaloSet: (payload) => reqRaw('/customer/password/zalo-set', { method: 'POST', body: JSON.stringify(payload) }),
  passwordSet: (payload) => reqRaw('/customer/password/set', { method: 'POST', body: JSON.stringify(payload) }),
  passwordChange: (payload) => reqRaw('/customer/password/change', { method: 'PATCH', body: JSON.stringify(payload) }),
  passwordCounterSet: (payload) => reqRaw('/customer/password/counter-set', { method: 'POST', body: JSON.stringify(payload) }),
  codeLogin: (payload) => reqRaw('/customer/session/code-login', { method: 'POST', body: JSON.stringify(payload) }),
  sessionLogout: () => reqRaw('/customer/session/logout', { method: 'POST' }),
  updateProfileEmail: (payload) => reqRaw('/customer/profile/email', { method: 'PATCH', body: JSON.stringify(payload) }),
  createOrder: (payload) => req('/orders', { method: 'POST', body: JSON.stringify(payload) }),
  trackOrder: (code, phone) => req(`/orders/${encodeURIComponent(code)}?phone=${encodeURIComponent(phone || '')}`),
  cancelOrder: (code, phone) => req(`/orders/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: JSON.stringify({ phone }) }),
  // Spec QR 2026-10-21: khách báo đã chuyển khoản (phương án A — NV đối chiếu rồi xác nhận tay)
  transferNotified: (code, phone) => req(`/orders/${encodeURIComponent(code)}/transfer-notified`, { method: 'POST', body: JSON.stringify({ phone }) }),
  // Gói 60: báo giá giao hàng live từ AhaMove/Lalamove qua backend
  deliveryQuote: (payload) => req('/delivery/quote', { method: 'POST', body: JSON.stringify(payload) }),
  deliveryConfig: () => req('/delivery/config'),
  // SPEC-01: thanh toán Zalo Mini App
  zaloPayConfig: () => req('/payment/zalo-config'),
  checkoutOrder: (payload) => req('/checkout-orders', { method: 'POST', body: JSON.stringify(payload) }),
  // SPEC-02: ví coupon + referral + tích tem
  // Spec KM chống mã (2026-10-21) Phần B: định danh bằng SĐT + mã TV hoặc zalo_id
  // (server KHÔNG nhận customer_id trần nữa).
  myCoupons: (identity, status) => req(`/coupons/my?${identityQuery(identity)}${status ? `&status=${status}` : ''}`),
  // Loyalty 2.0: Cửa hàng điểm + lịch sử điểm
  pointsExchangeItems: (identity) => req(`/points/exchange-items?${identityQuery(identity)}`),
  pointsExchange: (identity, itemId) => req('/points/exchange', { method: 'POST', body: JSON.stringify({ ...identity, item_id: itemId }) }),
  pointsHistory: (identity) => req(`/points/history?${identityQuery(identity)}`),
  // Minigame (2026-11-01): trạng thái/phiên/nộp kết quả/kỷ lục giải trí/thẻ chia sẻ
  minigameState: (identity) => req(`/minigame/state?${identityQuery(identity)}`),
  minigameSession: (identity, gameId) => req('/minigame/session', { method: 'POST', body: JSON.stringify({ ...identity, game_id: gameId }) }),
  minigameSubmit: (identity, payload) => req('/minigame/submit', { method: 'POST', body: JSON.stringify({ ...identity, ...payload }) }),
  minigameBest: (identity, payload) => req('/minigame/best', { method: 'POST', body: JSON.stringify({ ...identity, ...payload }) }),
  minigameShareCard: (identity, image) => req('/minigame/share-card', { method: 'POST', body: JSON.stringify({ ...identity, image }) }),
  myStamps: (identity) => req(`/coupons/stamps?${identityQuery(identity)}`),
  myReferral: (identity) => req(`/coupons/referral?${identityQuery(identity)}`),
  validateCoupon: (payload) => req('/coupons/validate', { method: 'POST', body: JSON.stringify(payload) }),
};

// Dựng query định danh khách từ profile/thông tin đã xác thực
const identityQuery = (idn) => {
  const p = new URLSearchParams();
  if (!idn) return '';
  if (idn.phone) p.set('phone', idn.phone);
  if (idn.member_code) p.set('member_code', idn.member_code);
  if (idn.zalo_id) p.set('zalo_id', idn.zalo_id);
  return p.toString();
};
export const profileIdentity = (profile) => profile ? {
  phone: profile.phone || '',
  member_code: profile.member_code || '',
  zalo_id: profile.zalo_id || '',
} : {};

export const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');

export const getBranch = () => {
  return storage.getJSON('zm_branch', null);
};
export const setBranch = (b) => storage.set('zm_branch', b);

export const getProfile = () => {
  return storage.getJSON('zm_profile', null);
};
export const setProfile = (p) => storage.set('zm_profile', p);

// Spec đăng nhập SĐT + mật khẩu §3.1: token phiên lưu ở khóa riêng
// (zm_session), không đưa vào URL, không lưu cùng hồ sơ hiển thị.
export const getSession = () => {
  return storage.getJSON('zm_session', null);
};
export const setSession = (s) => storage.set('zm_session', s);
export const clearSession = () => storage.remove('zm_session');

// Gói 49i: giá bán — ưu tiên giá kênh online, fallback về giá gốc
export const priceOf = (p) => Number(p?.online_price ?? p?.base_price ?? 0);

// Gói 50b: backend đã trả URL tuyệt đối đúng host — dùng trực tiếp.
// Giữ fallback cho dữ liệu cũ (relative hoặc localhost).
export const imgUrl = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) {
    // Sửa URL localhost cũ (dữ liệu trước 50b) — chỉ khi API là tuyệt đối mới biết host thật
    try {
      const apiUrl = new URL(API, window.location.href);
      if (/^https?:\/\/localhost(:\d+)?/i.test(u) && !/^https?:\/\/localhost(:\d+)?/i.test(apiUrl.origin)) {
        return u.replace(/^https?:\/\/localhost(:\d+)?/i, apiUrl.origin);
      }
    } catch { /* giữ nguyên */ }
    return u;
  }
  try {
    return new URL(API, window.location.href).origin + (u.startsWith('/') ? u : '/' + u);
  } catch { return u; }
};

// Gói 9: mã giới thiệu (?ref=) — lưu để gửi kèm khi đặt đơn
export const getRef = () => {
  return storage.get('zm_ref') || '';
};
// Spec đăng ký Zalo B §2.1 + spec mật khẩu §5.1(b)/§5.2: lấy token Zalo
// (access_token + phone_token) qua zmp-sdk — dùng chung cho /zalo/auth
// và /customer/password/zalo-set, không viết luồng thứ hai.
export const getZaloTokens = async () => {
  if (!storage.isZalo()) return { ok: false, code: 'not_zalo' };
  const { getUserInfo, getAccessToken, getPhoneNumber } = await import('zmp-sdk/apis');
  const { userInfo } = await getUserInfo({});
  const accessToken = await getAccessToken({});
  let phoneToken = null;
  // Châm chẩn đoán SĐT (Đại Vương chốt 2026-11-07): GIỮ LẠI lỗi của
  // getPhoneNumber thay vì nuốt trắng — luồng vẫn đi tiếp như cũ (server
  // trả B3 nếu cần tạo mới); mã lỗi chỉ phục vụ chẩn đoán ở khung B3.
  let phoneError = null;
  try {
    const ph = await getPhoneNumber({});
    phoneToken = ph?.token || null;
    if (!phoneToken) phoneError = { code: 'empty_token', message: 'getPhoneNumber không trả token và không báo lỗi' };
  } catch (e) { phoneError = { code: String(e?.code ?? e?.error_code ?? e?.error ?? 'unknown'), message: String(e?.message ?? e?.error_message ?? e?.errorMessage ?? '') }; }
  return { ok: true, accessToken, phoneToken, phoneError, userInfo };
};

// Spec đăng ký Zalo B §2.1: HÀM XÁC THỰC ZALO DÙNG CHUNG — trang Tài khoản
// (thẻ đăng ký mới + mục Quản lý quyền) và trang Minigame đều gọi đúng hàm này,
// không viết luồng thứ hai. Trả về json thô của /zalo/auth (success/code/data)
// để phía gọi tự chọn UI (chào mừng/B3/thông báo mã mới); từ chối hộp thoại
// quyền Zalo → ném lỗi cho phía gọi xử lý im lặng như trước.
// Spec mật khẩu §3.4: thành công kèm session_token → lưu phiên token
// (member_code chỉ còn để hiển thị, không làm chứng thực nữa).
export const authWithZalo = async () => {
  const tk = await getZaloTokens();
  if (!tk.ok) return { success: false, code: 'not_zalo' };
  const res = await fetch(`${API}/zalo/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      access_token: tk.accessToken,
      phone_token: tk.phoneToken,
      name: tk.userInfo?.name,
      avatar: tk.userInfo?.avatar,
      referred_by: getRef() || null,
    }),
  });
  const json = await res.json();
  if (json.success) {
    storage.set('zm_zalo_profile', { zalo_id: json.data.zalo_id, name: json.data.name });
    if (json.data.session_token) {
      setSession({ token: json.data.session_token, expires_at: json.data.session_expires_at || null });
    }
    // Audit 2026-10-23 BM-01/BM-02: server đã xác thực phone_token — lưu SĐT +
    // mã TV server trả vào hồ sơ (để hiển thị thẻ thành viên).
    if (json.data.phone && json.data.member_code) {
      setProfile({ ...(getProfile() || {}), phone: json.data.phone, member_code: json.data.member_code, customer_id: json.data.customer_id, zalo_id: json.data.zalo_id });
    }
  }
  // Châm chẩn đoán SĐT (2026-11-07): gắn kèm trạng thái bước lấy SĐT phía
  // client để khung B3 phân định nhánh (a) SDK lỗi / (b) server đổi số hỏng.
  json._phoneSent = !!tk.phoneToken;
  json._phoneError = tk.phoneError;
  return json;
};

// Gói Đón Bình Minh (2026-10-28): ghi/gỡ mã mời từ ô nhập tay ở Checkout —
// đi cùng 1 kho zm_ref với đường link để payload đặt đơn không đổi.
export const setRef = (code) => {
  const v = (code || '').trim().toUpperCase();
  if (v) storage.set('zm_ref', v);
  else storage.remove('zm_ref');
};
export const captureRef = () => {
  // Nguồn 1: tham số trên URL hiện tại (mở qua link web / trình duyệt)
  try {
    const m = new URLSearchParams(window.location.search).get('ref');
    if (m) { storage.set('zm_ref', m.trim().toUpperCase()); return; }
  } catch { /* ignore */ }
  // Nguồn 2: tham số khởi động do SDK Zalo cấp khi mở app qua deep-link
  // zalo.me/s/<app_id>?ref=... — getRouteParams() của zmp-sdk.
  // LƯU Ý KIỂM CHỨNG: Zalo có chuyển nguyên tham số của link mở app vào
  // getRouteParams hay không phải xác nhận trên THIẾT BỊ THẬT (checklist
  // nghiệm thu gói Đón Bình Minh mục 6). Nếu nguồn này không mang được mã,
  // đường dự phòng là ô nhập tay ở Checkout + mã dạng chữ trong text chia sẻ.
  import('zmp-sdk/apis')
    .then(({ getRouteParams }) => {
      try {
        const ref = getRouteParams()?.ref;
        if (ref) storage.set('zm_ref', String(ref).trim().toUpperCase());
      } catch { /* ngoài môi trường Zalo thì bỏ qua */ }
    })
    .catch(() => { /* zmp-sdk không sẵn sàng (dev browser) — bỏ qua */ });
};
// Nhóm đơn của tôi đã tạo/tham gia: {code: {role, name}}
export const getMyGroups = () => {
  return storage.getJSON('zm_groups', {});
};
export const saveMyGroup = (code, info) => {
  try {
    const g = getMyGroups();
    g[code.toUpperCase()] = info;
    storage.set('zm_groups', g);
  } catch { /* ignore */ }
};

// Gói 7p: đồng bộ màu chủ đạo từ Thiết lập (Đại Vương pick)
// Gói 47: đồng bộ font chữ (chỉ các font đã verify tiếng Việt)
const FONT_ALLOW = ['Inter', "'Be Vietnam Pro'", 'Nunito', 'Quicksand', "'Plus Jakarta Sans'", 'Manrope', 'Lexend'];
const loadedMiniFonts = new Set();
function applyMiniFont(family) {
  if (!FONT_ALLOW.includes(family)) return;
  if (!loadedMiniFonts.has(family)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family.replace(/'/g, '')) + ':wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
    loadedMiniFonts.add(family);
  }
  document.body.style.fontFamily = family + ", -apple-system, 'Segoe UI', Roboto, sans-serif";
}
export async function loadTheme() {
  try {
    const res = await fetch(`${API}/theme`, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    const d = data && (data.data || data);
    const primary = d && d.primary;
    if (primary && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primary)) {
      document.documentElement.style.setProperty('--zm-primary', primary.toUpperCase());
    }
    if (d && d.font_family) applyMiniFont(d.font_family);
  } catch (e) { /* giữ mặc định */ }
}
