import React, { useEffect, useRef, useState } from 'react';

// Dùng chung Checkout đơn thường + GroupCheckout đơn nhóm (Spec đơn nhóm đồng bộ 2026-10-21).
// Trước đây các helper này nằm trong Checkout.jsx; tách ra để 2 form dùng cùng 1 bản.
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const parseDMY = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return (d.getFullYear() === Number(m[3]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1])) ? d : null;
};
const DATE_FIELD_OPEN_EVENT = 'daybreak-datefield-open';
let dateFieldSequence = 0;

// Bảng lịch tháng trong app theo mẫu đã duyệt: mở ngay dưới ô, tuần bắt
// đầu thứ 2, ngày quá khứ bị khóa, hôm nay có chấm cam và ngày đang chọn
// có nền navy. Chọn ngày chỉ đi qua onChange chung với đường gõ tay.
function CalendarPanel({ view, selected, onViewChange, onPick }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = new Date(view.year, view.month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Thứ 2 là cột đầu tiên.
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(view.year, view.month, 0).getDate();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < cellCount; i += 1) {
    const dayNumber = i - startOffset + 1;
    if (dayNumber < 1) {
      cells.push({ key: `prev-${i}`, date: null, label: daysInPreviousMonth + dayNumber, other: true });
    } else if (dayNumber > daysInMonth) {
      cells.push({ key: `next-${i}`, date: null, label: dayNumber - daysInMonth, other: true });
    } else {
      const date = new Date(view.year, view.month, dayNumber);
      cells.push({ key: date.getTime(), date, label: dayNumber, other: false });
    }
  }
  const canPrev = view.year > today.getFullYear()
    || (view.year === today.getFullYear() && view.month > today.getMonth());
  const stepMonth = (delta) => {
    const next = new Date(view.year, view.month + delta, 1);
    onViewChange({ year: next.getFullYear(), month: next.getMonth() });
  };
  const navBtn = {
    width: 44, height: 44, border: 'none', borderRadius: 8, background: '#F5F6FA',
    color: '#24305E', fontSize: 19, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };
  return (
    <div style={{
      marginTop: 10, background: '#fff', border: '1px solid #E4E8F0', borderRadius: 12,
      padding: 10, boxShadow: '0 4px 16px rgba(36,48,94,.10)', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button type="button" aria-label="Tháng trước" disabled={!canPrev} onClick={() => stepMonth(-1)}
          style={{ ...navBtn, opacity: canPrev ? 1 : 0.35, cursor: canPrev ? 'pointer' : 'default' }}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#24305E' }}>Tháng {view.month + 1} · {view.year}</div>
        <button type="button" aria-label="Tháng sau" onClick={() => stepMonth(1)} style={navBtn}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((weekday) => (
          <div key={weekday} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#9AA0B4', padding: '6px 0' }}>{weekday}</div>
        ))}
        {cells.map((cell) => {
          if (cell.other) {
            return (
              <button key={cell.key} type="button" disabled
                style={{
                  position: 'relative', height: 44, border: 'none', borderRadius: 8, background: 'transparent',
                  color: '#C3CADB', fontSize: 14.5, cursor: 'default', fontVariantNumeric: 'tabular-nums',
                }}>
                {cell.label}
              </button>
            );
          }
          const isPast = cell.date < today;
          const isToday = cell.date.getTime() === today.getTime();
          const isSelected = selected && cell.date.getTime() === selected.getTime();
          return (
            <button key={cell.key} type="button" disabled={isPast}
              onClick={() => onPick(cell.date)}
              style={{
                position: 'relative', height: 44, border: 'none', borderRadius: 8,
                background: isSelected ? '#24305E' : 'transparent',
                color: isSelected ? '#fff' : isPast ? '#C3CADB' : isToday ? '#24305E' : '#1A1A1A',
                fontSize: 14.5, fontWeight: isSelected || isToday ? 800 : 400,
                cursor: isPast ? 'default' : 'pointer', fontVariantNumeric: 'tabular-nums',
              }}>
              {cell.label}
              {isToday && (
                <span style={{
                  position: 'absolute', left: '50%', bottom: 5, transform: 'translateX(-50%)',
                  width: 5, height: 5, borderRadius: '50%', background: isSelected ? '#fff' : '#F5A623',
                }} />
              )}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: '#888', marginTop: 8, textAlign: 'center' }}>
        Ngày đã qua được làm mờ và không chọn được · chấm cam là hôm nay
      </div>
    </div>
  );
}

export function DateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const wrapRef = useRef(null);
  const instanceRef = useRef(null);
  if (instanceRef.current === null) {
    dateFieldSequence += 1;
    instanceRef.current = dateFieldSequence;
  }
  const selected = parseDMY(value);
  const selectedTime = selected ? selected.getTime() : null;
  const mask = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    if (d.length > 2) return d.slice(0, 2) + '/' + d.slice(2);
    return d;
  };

  useEffect(() => {
    const closeOther = (event) => {
      if (event.detail !== instanceRef.current) setOpen(false);
    };
    window.addEventListener(DATE_FIELD_OPEN_EVENT, closeOther);
    return () => window.removeEventListener(DATE_FIELD_OPEN_EVENT, closeOther);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('mousedown', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('mousedown', closeOutside);
    };
  }, [open]);

  useEffect(() => {
    if (open && selectedTime !== null) {
      const next = new Date(selectedTime);
      setView((current) => (
        current.year === next.getFullYear() && current.month === next.getMonth()
          ? current
          : { year: next.getFullYear(), month: next.getMonth() }
      ));
    }
  }, [open, selectedTime]);

  const toggleCalendar = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (selected) setView({ year: selected.getFullYear(), month: selected.getMonth() });
    else setView({ year: today.getFullYear(), month: today.getMonth() });
    window.dispatchEvent(new CustomEvent(DATE_FIELD_OPEN_EVENT, { detail: instanceRef.current }));
    setOpen(true);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input value={value} onChange={(e) => onChange(mask(e.target.value))}
        placeholder="dd/mm/yyyy" inputMode="numeric" maxLength={10}
        style={{
          width: '100%', minHeight: 46, padding: '10px 48px 10px 12px',
          border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
        }} />
      <button type="button" aria-label="Mở lịch chọn ngày" aria-expanded={open} onClick={toggleCalendar}
        style={{
          position: 'absolute', right: 3, top: 3, width: 40, height: 40, border: 0, borderRadius: 8,
          background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#24305E',
        }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /></svg>
      </button>
      {open && (
        <CalendarPanel
          view={view}
          selected={selected}
          onViewChange={setView}
          onPick={(date) => { onChange(fmtDMY(date)); setOpen(false); }}
        />
      )}
    </div>
  );
}

// Bảng chọn giờ kiểu bánh xe (Đại Vương duyệt mẫu 15/11, sổ kiểm kê mục
// D.6): 2 cột Giờ 00–23 · Phút 00–59, mỗi cột hiện ~5 dòng 36px, cuộn bám
// dòng (scroll-snap), dòng đang chọn là pill nền navy chữ trắng, bấm thẳng
// vào số cũng chọn được, cuộn tới đâu điền vào ô tới đó. Đáy bảng chỉ có
// "Bây giờ" + "Xác nhận" — KHÔNG có nút Xóa (muốn trống thì xóa trong ô).
// Gõ tay giữ nguyên mask 24h như cũ; dùng chung sự kiện mở với DateField
// để cả trang tối đa 1 bảng (lịch hoặc giờ) mở tại một thời điểm.
const TIME_ROW = 36;
const TIME_PAD = TIME_ROW * 2; // chừa 2 dòng trên/dưới để mọi số đều cuộn vào giữa được
const parseTime = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  return h <= 23 && min <= 59 ? { h, m: min } : null;
};

function WheelColumn({ count, index, onPick, onScrollIndex, colRef, label }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#9AA0B4', padding: '2px 0 6px' }}>{label}</div>
      <div ref={colRef} className="db-time-wheel" onScroll={(e) => onScrollIndex(Math.round(e.target.scrollTop / TIME_ROW))}
        style={{
          height: TIME_ROW * 5, overflowY: 'auto', scrollSnapType: 'y mandatory',
          paddingTop: TIME_PAD, paddingBottom: TIME_PAD, boxSizing: 'border-box',
        }}>
        {Array.from({ length: count }, (_, i) => {
          const active = i === index;
          return (
            <div key={i} onClick={() => onPick(i)}
              style={{
                height: TIME_ROW, scrollSnapAlign: 'center', display: 'flex',
                alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>
              <span style={{
                width: 58, textAlign: 'center', padding: '4px 0', borderRadius: 999,
                background: active ? '#24305E' : 'transparent',
                color: active ? '#fff' : '#55596B',
                fontSize: 15.5, fontWeight: active ? 800 : 400, fontVariantNumeric: 'tabular-nums',
              }}>{pad2(i)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [wheel, setWheel] = useState({ h: 0, m: 0 });
  const wrapRef = useRef(null);
  const hourRef = useRef(null);
  const minRef = useRef(null);
  const programmaticRef = useRef(false);
  const programmaticTimer = useRef(null);
  const instanceRef = useRef(null);
  if (instanceRef.current === null) {
    dateFieldSequence += 1;
    instanceRef.current = dateFieldSequence;
  }
  const mask = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 4);
    if (d.length > 2) return d.slice(0, 2) + ':' + d.slice(2);
    return d;
  };
  const emit = (h, m) => onChange(`${pad2(h)}:${pad2(m)}`);

  const scrollToIndex = (el, idx, smooth) => {
    if (!el) return;
    programmaticRef.current = true;
    if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
    programmaticTimer.current = setTimeout(() => { programmaticRef.current = false; }, smooth ? 350 : 80);
    el.scrollTo({ top: idx * TIME_ROW, behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    const closeOther = (event) => {
      if (event.detail !== instanceRef.current) setOpen(false);
    };
    window.addEventListener(DATE_FIELD_OPEN_EVENT, closeOther);
    return () => window.removeEventListener(DATE_FIELD_OPEN_EVENT, closeOther);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('mousedown', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('mousedown', closeOutside);
    };
  }, [open ]);

  // Vừa mở bảng: đặt bánh xe theo giá trị ô (rỗng/không hợp lệ → giờ hiện
  // tại, nhưng CHƯA điền vào ô — chỉ điền khi cuộn/bấm/Bây giờ/Xác nhận).
  useEffect(() => {
    if (!open) return undefined;
    const parsed = parseTime(value);
    const now = new Date();
    const init = parsed || { h: now.getHours(), m: now.getMinutes() };
    setWheel(init);
    const raf = requestAnimationFrame(() => {
      scrollToIndex(hourRef.current, init.h, false);
      scrollToIndex(minRef.current, init.m, false);
    });
    return () => cancelAnimationFrame(raf);
    // Chỉ chạy lúc mở bảng; value đổi lúc đang mở xử lý ở effect dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  // Gõ tay trong lúc bảng đang mở → bánh xe bám theo giá trị ô.
  const parsedValue = parseTime(value);
  const parsedKey = parsedValue ? `${parsedValue.h}:${parsedValue.m}` : '';
  useEffect(() => {
    if (!open || !parsedValue) return;
    setWheel((current) => {
      if (current.h === parsedValue.h && current.m === parsedValue.m) return current;
      scrollToIndex(hourRef.current, parsedValue.h, false);
      scrollToIndex(minRef.current, parsedValue.m, false);
      return parsedValue;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parsedKey]);

  const toggleWheel = () => {
    if (open) {
      setOpen(false);
      return;
    }
    window.dispatchEvent(new CustomEvent(DATE_FIELD_OPEN_EVENT, { detail: instanceRef.current }));
    setOpen(true);
  };

  const handleScrollIndex = (which, idx) => {
    if (programmaticRef.current) return;
    const clamped = Math.max(0, Math.min(which === 'h' ? 23 : 59, idx));
    setWheel((current) => {
      if (current[which] === clamped) return current;
      const next = { ...current, [which]: clamped };
      emit(next.h, next.m);
      return next;
    });
  };

  const handlePick = (which, idx) => {
    const next = { ...wheel, [which]: idx };
    setWheel(next);
    emit(next.h, next.m);
    scrollToIndex(which === 'h' ? hourRef.current : minRef.current, idx, true);
  };

  const handleNow = () => {
    const now = new Date();
    const next = { h: now.getHours(), m: now.getMinutes() };
    setWheel(next);
    emit(next.h, next.m);
    scrollToIndex(hourRef.current, next.h, true);
    scrollToIndex(minRef.current, next.m, true);
  };

  const handleConfirm = () => {
    emit(wheel.h, wheel.m);
    setOpen(false);
  };

  const footBtn = {
    flex: 1, minHeight: 44, borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input value={value} onChange={(e) => onChange(mask(e.target.value))}
        placeholder="HH:MM" inputMode="numeric" maxLength={5}
        style={{
          width: '100%', minHeight: 46, padding: '10px 48px 10px 12px',
          border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
        }} />
      <button type="button" aria-label="Mở bảng chọn giờ" aria-expanded={open} onClick={toggleWheel}
        style={{
          position: 'absolute', right: 3, top: 3, width: 40, height: 40, border: 0, borderRadius: 8,
          background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#24305E',
        }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      </button>
      {open && (
        <div style={{
          // Neo tuyệt đối mép phải của ô: cả 4 điểm dùng đều đặt ô giờ trong
          // hộp 110px cạnh ô ngày — bảng trong luồng sẽ bị bóp còn 110px
          // (nút chân bảng phải xuống dòng, pill tràn cột). Bảng rộng 250px
          // tràn sang trái, vẫn gọn trong bề ngang form điện thoại.
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: 250, zIndex: 40,
          background: '#fff', border: '1px solid #E4E8F0', borderRadius: 12,
          padding: 10, boxShadow: '0 4px 16px rgba(36,48,94,.10)', boxSizing: 'border-box',
        }}>
          <style>{'.db-time-wheel{scrollbar-width:none;-ms-overflow-style:none}.db-time-wheel::-webkit-scrollbar{display:none}'}</style>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <WheelColumn label="Giờ" count={24} index={wheel.h} colRef={hourRef}
              onPick={(i) => handlePick('h', i)} onScrollIndex={(i) => handleScrollIndex('h', i)} />
            <div style={{
              width: 14, height: TIME_ROW * 5, marginTop: 25, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 800, color: '#24305E',
            }}>:</div>
            <WheelColumn label="Phút" count={60} index={wheel.m} colRef={minRef}
              onPick={(i) => handlePick('m', i)} onScrollIndex={(i) => handleScrollIndex('m', i)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={handleNow}
              style={{ ...footBtn, border: '1.5px solid #24305E', background: '#F0F4FF', color: '#24305E' }}>Bây giờ</button>
            <button type="button" onClick={handleConfirm}
              style={{ ...footBtn, border: '1.5px solid #24305E', background: '#24305E', color: '#fff' }}>Xác nhận</button>
          </div>
        </div>
      )}
    </div>
  );
}
export const toApiDate = (v) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
export const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');
// Chuẩn hóa SĐT VN: bỏ khoảng trắng/ký tự lạ, +84/84 → 0
export const formatPhone = (v) => {
  let p = String(v || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+84')) p = '0' + p.slice(3);
  else if (p.startsWith('84') && p.length >= 11) p = '0' + p.slice(2);
  return p;
};
// Luật SĐT (Đại Vương chốt 2026-11-07): bắt đầu bằng 0 thì phải đủ đúng
// 10 chữ số. Kiểm trên số đã chuẩn hóa (+84 → 0) nên gõ dạng quốc tế
// vẫn qua; thiếu/thừa số đều chặn ngay tại ô nhập.
export const validPhone = (v) => /^0\d{9}$/.test(formatPhone(v));
