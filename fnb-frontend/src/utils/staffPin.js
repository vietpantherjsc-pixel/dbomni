import axios from 'axios';
import { API } from './api';

// Gói phiên Hub (2026-11-05): PIN step-up cho 2 hành động chạy thẳng không
// qua duyệt — chốt kiểm kê (purpose 'stocktake_confirm') và chạy sản xuất
// ('production'). Cùng cơ chế pin-verify + token Cache 5 phút của cụm duyệt
// (approval), khóa Cache server riêng theo purpose; phía client cũng cache
// riêng theo purpose 4,5 phút để khỏi bắt NV nhập lại PIN liên tục.
const pinCache = {}; // purpose -> { token, ts }

export function cachedPinToken(purpose) {
  const c = pinCache[purpose];
  if (c && c.token && Date.now() - c.ts < 4.5 * 60 * 1000) return c.token;
  return '';
}

export function clearPinToken(purpose) {
  delete pinCache[purpose];
}

// Lấy pin_token cho purpose: dùng cache nếu còn hạn, chưa có thì đổi PIN
// người dùng vừa nhập qua /employee/pin-verify. Ném Error('NEED_PIN') khi
// chưa có cache mà cũng không có PIN để đổi.
export async function ensurePinToken(token, purpose, pin) {
  const hit = cachedPinToken(purpose);
  if (hit) return hit;
  if (!pin || pin.length !== 6) { const e = new Error('NEED_PIN'); throw e; }
  const r = await axios.post(API + '/employee/pin-verify',
    { pin_code: pin, purpose },
    { headers: { Authorization: 'Bearer ' + token } });
  const t = r.data && r.data.data && r.data.data.pin_token;
  if (!t) throw new Error('Không lấy được mã xác nhận PIN.');
  pinCache[purpose] = { token: t, ts: Date.now() };
  return t;
}
