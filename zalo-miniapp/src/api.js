// Gói 6 (2026-10-05): Zalo Mini App đặt món — mobile-first, phong cách GrabFood.
export const API = 'http://localhost/api/online';
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
  customerByPhone: (phone, memberCode) => req(`/customer?phone=${encodeURIComponent(phone)}&member_code=${encodeURIComponent(memberCode)}`),
  createOrder: (payload) => req('/orders', { method: 'POST', body: JSON.stringify(payload) }),
  trackOrder: (code) => req(`/orders/${encodeURIComponent(code)}`),
  cancelOrder: (code) => req(`/orders/${encodeURIComponent(code)}/cancel`, { method: 'POST' }),
};

export const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');

export const getBranch = () => {
  try { return JSON.parse(localStorage.getItem('zm_branch') || 'null'); } catch { return null; }
};
export const setBranch = (b) => localStorage.setItem('zm_branch', JSON.stringify(b));

export const getProfile = () => {
  try { return JSON.parse(localStorage.getItem('zm_profile') || 'null'); } catch { return null; }
};
export const setProfile = (p) => localStorage.setItem('zm_profile', JSON.stringify(p));

// Gói 9: mã giới thiệu (?ref=) — lưu để gửi kèm khi đặt đơn
export const getRef = () => {
  try { return localStorage.getItem('zm_ref') || ''; } catch { return ''; }
};
export const captureRef = () => {
  try {
    const m = new URLSearchParams(window.location.search).get('ref');
    if (m) localStorage.setItem('zm_ref', m.trim().toUpperCase());
  } catch { /* ignore */ }
};
// Nhóm đơn của tôi đã tạo/tham gia: {code: {role, name}}
export const getMyGroups = () => {
  try { return JSON.parse(localStorage.getItem('zm_groups') || '{}'); } catch { return {}; }
};
export const saveMyGroup = (code, info) => {
  try {
    const g = getMyGroups();
    g[code.toUpperCase()] = info;
    localStorage.setItem('zm_groups', JSON.stringify(g));
  } catch { /* ignore */ }
};

// Gói 7p: đồng bộ màu chủ đạo từ Thiết lập (Đại Vương pick)
export async function loadTheme() {
  try {
    const res = await fetch(`${API}/theme`, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    const primary = data && (data.primary || (data.data && data.data.primary));
    if (primary && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primary)) {
      document.documentElement.style.setProperty('--zm-primary', primary.toUpperCase());
    }
  } catch (e) { /* giữ màu mặc định */ }
}
