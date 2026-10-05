// Gói 8f (2026-10-05): Số thập phân tùy chỉnh cho từng loại số liệu.
// Đại Vương cấu hình tại Thiết lập → Số thập phân.

const STORAGE_KEY = 'number_decimals';

const DEFAULTS = {
  price: 0,      // Giá bán
  quantity: 1,   // Định lượng
  tax: 0,        // Tiền thuế
  discount: 0,   // Giảm giá
};

let cache = null;

function readCache() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch (e) {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function getDecimals(kind) {
  const c = readCache();
  const v = Number(c[kind]);
  return Number.isFinite(v) && v >= 0 && v <= 4 ? Math.floor(v) : (DEFAULTS[kind] ?? 0);
}

// Định dạng số theo loại: fmt(52000, 'price') → "52.000"
export function fmt(n, kind = 'price') {
  const d = getDecimals(kind);
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const fmtPrice = (n) => fmt(n, 'price');
export const fmtQty = (n) => fmt(n, 'quantity');
export const fmtTax = (n) => fmt(n, 'tax');
export const fmtDiscount = (n) => fmt(n, 'discount');

// Nạp từ server (gọi lúc app khởi động, chung với loadTheme)
export async function loadNumberSettings(api) {
  try {
    const res = await api.get('http://localhost/api/settings');
    const d = res.data || {};
    const next = {
      price: d.decimals_price ?? DEFAULTS.price,
      quantity: d.decimals_quantity ?? DEFAULTS.quantity,
      tax: d.decimals_tax ?? DEFAULTS.tax,
      discount: d.decimals_discount ?? DEFAULTS.discount,
    };
    cache = {
      price: Number(next.price) || 0,
      quantity: Number(next.quantity) || 0,
      tax: Number(next.tax) || 0,
      discount: Number(next.discount) || 0,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
  } catch (e) { /* giữ mặc định */ }
}

export const DECIMAL_LABELS = [
  { key: 'price', label: 'Giá bán', hint: 'VD: 52.000 đ' },
  { key: 'quantity', label: 'Định lượng', hint: 'VD: 20,5 g' },
  { key: 'tax', label: 'Tiền thuế', hint: 'VD: 4.160 đ' },
  { key: 'discount', label: 'Giảm giá', hint: 'VD: 10.000 đ' },
];
