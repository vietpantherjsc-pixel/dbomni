// Gói 36: chuẩn hóa hiển thị ngày dd/mm/yyyy, giờ HH:MM (24h) toàn hệ thống.
// CHỈ dùng cho TẦNG HIỂN THỊ — API/backend vẫn trao đổi yyyy-mm-dd / ISO.

const pad = (n) => String(n).padStart(2, '0');

// Tách chuỗi thành {y, m, d, h, mi}.
// - Chuỗi có timezone (Z / +07:00): dùng new Date để convert đúng giờ địa phương (giữ nguyên hành vi toLocaleString cũ).
// - Các dạng còn lại: parse thủ công theo giờ địa phương, tránh lệch ngày do UTC.
function parts(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), h: v.getHours(), mi: v.getMinutes() };
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes() };
  }
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : null };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/mm/yyyy (đã là dạng hiển thị)
  if (m) return { y: +m[3], m: +m[2], d: +m[1], h: null, mi: null };
  m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/); // chỉ giờ
  if (m) return { y: null, m: null, d: null, h: +m[1], mi: +m[2] };
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes() };
}

// Kiểm tra ngày thật (kể cả năm nhuận)
export function isValidDate(y, m, d) {
  if (!y || !m || !d) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// "2026-10-09" / ISO / Date → "09/10/2026". null/sai → ''.
export function fmtDate(v) {
  const p = parts(v);
  if (!p || !isValidDate(p.y, p.m, p.d)) return '';
  return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

// "14:30[:00]" / ISO → "14:30" (24h). null/sai → ''.
export function fmtTime(v) {
  const p = parts(v);
  if (!p || p.h == null || p.mi == null) return '';
  if (p.h < 0 || p.h > 23 || p.mi < 0 || p.mi > 59) return '';
  return `${pad(p.h)}:${pad(p.mi)}`;
}

// ISO / "yyyy-mm-dd HH:MM:SS" → "09/10/2026 14:30". Không có giờ → chỉ ngày.
export function fmtDateTime(v) {
  const p = parts(v);
  if (!p || !isValidDate(p.y, p.m, p.d)) return '';
  if (p.h == null || p.mi == null) return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  return `${pad(p.d)}/${pad(p.m)}/${p.y} ${pad(p.h)}:${pad(p.mi)}`;
}

// dd/mm/yyyy (hoặc yyyy-mm-dd) → "yyyy-mm-dd" để gửi API. Sai → ''.
export function toApiDate(v) {
  const p = parts(v);
  if (!p || !isValidDate(p.y, p.m, p.d)) return '';
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// Thứ 2 của tuần chứa ngày (nhận yyyy-mm-dd / Date) → "yyyy-mm-dd"
export function startOfWeek(v) {
  const p = parts(v);
  if (!p || !isValidDate(p.y, p.m, p.d)) return '';
  const dt = new Date(p.y, p.m - 1, p.d);
  const dow = (dt.getDay() + 6) % 7; // 0 = Thứ 2
  dt.setDate(dt.getDate() - dow);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
