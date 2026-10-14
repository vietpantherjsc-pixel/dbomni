// Tiện ích giờ mở cửa — dùng chung cho Home (hiển thị trạng thái) và Checkout (hẹn giờ).
// branch.opening_hours: {mode:'all', open:'HH:MM', close:'HH:MM'} hoặc {mode:'daily', days:{0:{open,close,off},...}}

const toMin = (s) => { const [h, m] = String(s || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const pad = (n) => String(n).padStart(2, '0');

export function openStatus(branch) {
  const oh = branch?.opening_hours;
  if (!oh) return null;
  if (oh.mode === 'daily' && oh.days) {
    const d = new Date().getDay(); // 0=Chủ nhật
    const cfg = oh.days[d];
    if (!cfg || cfg.off) return { open: false, hours: 'Nghỉ hôm nay' };
    if (!cfg.open || !cfg.close) return null;
    return checkOpen(cfg.open, cfg.close);
  }
  if (!oh.open || !oh.close) return null;
  return checkOpen(oh.open, oh.close);
}

function checkOpen(open, close) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const o = toMin(open), c = toMin(close);
  const isOpen = o <= c ? (cur >= o && cur < c) : (cur >= o || cur < c); // qua đêm
  return { open: isOpen, hours: `${open} - ${close}` };
}

// Lấy cấu hình giờ của 1 ngày (Date) — null nếu nghỉ/không cấu hình
function dayConfig(branch, date) {
  const oh = branch?.opening_hours;
  if (!oh) return null;
  if (oh.mode === 'daily' && oh.days) {
    const cfg = oh.days[date.getDay()];
    if (!cfg || cfg.off || !cfg.open || !cfg.close) return null;
    return { open: cfg.open, close: cfg.close };
  }
  if (!oh.open || !oh.close) return null;
  return { open: oh.open, close: oh.close };
}

// Tìm thời điểm mở cửa gần nhất từ bây giờ (Date) — để hẹn giờ khi quán đóng cửa.
// Trả về { date: 'dd/mm/yyyy', time: 'HH:MM', label } hoặc null nếu không tìm được trong 7 ngày.
export function nextOpenSlot(branch) {
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const cfg = dayConfig(branch, d);
    if (!cfg) continue;
    const o = toMin(cfg.open);
    if (i === 0) {
      const cur = now.getHours() * 60 + now.getMinutes();
      if (cur < o) {
        return { date: fmtDate(d), time: cfg.open, label: `Hôm nay lúc ${cfg.open}` };
      }
      // Đã qua giờ mở hôm nay → ngày mai
      continue;
    }
    return { date: fmtDate(d), time: cfg.open, label: `${fmtDate(d)} lúc ${cfg.open}` };
  }
  return null;
}

// Danh sách khung giờ (cách 30 phút) cho 1 ngày — chỉ trong giờ mở cửa
export function timeSlots(branch, dateStr) {
  // dateStr: dd/mm/yyyy
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dateStr || ''));
  if (!m) return [];
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  const cfg = dayConfig(branch, d);
  if (!cfg) return [];
  const slots = [];
  let cur = toMin(cfg.open);
  const end = toMin(cfg.close);
  // Xử lý ca qua đêm đơn giản: nếu close < open thì end = close + 24h
  const endMin = end <= cur ? end + 24 * 60 : end;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const nowMin = now.getHours() * 60 + now.getMinutes() + 30; // hẹn tối thiểu sau 30 phút
  while (cur <= endMin) {
    const hh = Math.floor((cur % (24 * 60)) / 60);
    const mm = cur % 60;
    if (!isToday || cur >= nowMin) {
      slots.push(`${pad(hh)}:${pad(mm)}`);
    }
    cur += 30;
  }
  return slots;
}

// Kiểm tra 1 thời điểm hẹn có nằm trong giờ mở cửa không
export function isWithinOpening(branch, dateStr, timeStr) {
  return timeSlots(branch, dateStr).includes(timeStr);
}

function fmtDate(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
