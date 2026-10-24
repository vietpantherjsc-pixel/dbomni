// Gói 6 (2026-10-05): Zalo Mini App đặt món — mobile-first, phong cách GrabFood.
// API tương đối để chạy được trên điện thoại thật (qua proxy Vite lúc dev,
// hoặc cùng host lúc production). Build cho server riêng:
// VITE_API_BASE=https://ten-mien.com/api/online npm run build
import { storage } from './utils/storage'; // Spec P4-P5: qua module storage (zmp-sdk) — TESTER P5: thiếu import gây ReferenceError
export const API = import.meta.env.VITE_API_BASE || '/api/online';
export const GREEN = '#24305E'; // fallback; màu thật lấy từ /theme qua loadTheme()

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Có lỗi xảy ra');
  return data.data;
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
  ),
  // Gói 50f: gợi ý địa chỉ khi gõ
  geocodeSuggest: (q, lat, lon) => req(`/geocode/suggest?q=${encodeURIComponent(q)}${lat ? `&lat=${lat}&lon=${lon}` : ''}`),
  // Gói 9: trang chủ kiểu GrabFood
  // Gói 10f: shopInfo theo chi nhánh -> cover riêng (chưa có thì cover chung)
  shopInfo: (branchId) => req(`/shop-info${branchId ? `?branch_id=${branchId}` : ''}`),
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
export const captureRef = () => {
  try {
    const m = new URLSearchParams(window.location.search).get('ref');
    if (m) storage.set('zm_ref', m.trim().toUpperCase());
  } catch { /* ignore */ }
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
