import React, { useState, useEffect, useRef } from 'react';
import { fmtDate, toApiDate } from '../utils/format';

// Gói 36d: ô nhập ngày dd/mm/yyyy — viết lại để KHÔNG BAO GIỜ kẹt.
// Nguyên nhân bản cũ: state text + useEffect đồng bộ từ parent đánh nhau khi
// sửa giữa chuỗi, mask vị trí cứng (2-2-4) làm hỏng khi gõ "1/2/2026".
// Bản mới:
// - value/onChange: chuỗi "yyyy-mm-dd" (giữ nguyên để gửi API).
// - Đang focus: không ép đồng bộ từ parent → gõ/sửa tự do.
// - Tôn trọng dấu "/" người dùng tự gõ ("1/2/2026" vẫn đúng).
// - Blur: chuẩn hóa về dd/mm/yyyy; sai định dạng → hoàn về giá trị đúng gần nhất.
export default function DateInput({ value, onChange, className, placeholder, min, max, style, disabled, ...rest }) {
  const [text, setText] = useState(() => fmtDate(value));
  const focused = useRef(false);
  const lastGood = useRef(fmtDate(value)); // text đúng gần nhất

  // Spec ô ngày toàn hệ (mục 7, 2026-11-15): icon lịch ở cuối ô mở bảng lịch
  // popup ngay dưới ô. Gõ tay giữ nguyên toàn bộ cơ chế trên; chọn từ lịch
  // đi qua ĐÚNG onChange hiện hữu (kèm clamp min/max như khi gõ). KHÔNG khóa
  // cứng quá khứ — chỉ khóa theo min/max của từng ô như luật hiện hành.
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const d = parseApi(value) || new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Đang mở mà giá trị đổi từ gõ tay/parent → lịch nhảy đúng tháng của ngày chọn
  const selectedDate = parseApi(value);
  const selectedTime = selectedDate ? selectedDate.getTime() : null;
  useEffect(() => {
    if (open && selectedTime !== null) {
      const d = new Date(selectedTime);
      setView((v) => (v.year === d.getFullYear() && v.month === d.getMonth() ? v : { year: d.getFullYear(), month: d.getMonth() }));
    }
  }, [open, selectedTime]);

  const toggleCalendar = () => {
    if (open) { setOpen(false); return; }
    const base = selectedDate || new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    const rect = wrapRef.current ? wrapRef.current.getBoundingClientRect() : null;
    setAlignRight(!!rect && rect.left + 296 > window.innerWidth - 8);
    setOpen(true);
  };

  const pickDay = (d) => {
    const api = clamp(toApiStr(d));
    if (!api) return;
    lastGood.current = fmtDate(api);
    setText(fmtDate(api));
    onChange(api);
    setOpen(false);
  };

  // Chỉ đồng bộ từ parent khi KHÔNG focus (mở form, reset từ ngoài...)
  useEffect(() => {
    if (!focused.current) {
      const f = fmtDate(value);
      lastGood.current = f;
      setText(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clamp = (api) => {
    if (!api) return api;
    if (min && api < min) return min;
    if (max && api > max) return max;
    return api;
  };

  // Mask thông minh:
  // - Paste dạng yyyy-mm-dd (VD từ Excel): convert thẳng sang dd/mm/yyyy trước.
  // - Nếu dấu "/" trong chuỗi tạo thành cấu trúc dd/mm/yyyy hợp lệ (mỗi phần ≤ 2/2/4 số)
  //   → tôn trọng cách người dùng gõ ("1/2/2026", "01/8/2026" khi sửa giữa chuỗi).
  // - Ngược lại (VD đang gõ dở "01/022") → mask theo vị trí 2-2-4 trên dãy số.
  const mask = (raw) => {
    let r = String(raw);
    const isoM = r.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoM) r = isoM[3] + '/' + isoM[2] + '/' + isoM[1];
    const clean = r.replace(/[^\d/]/g, '');
    if (clean.includes('/')) {
      const parts = clean.split('/').slice(0, 3);
      const lim = [2, 2, 4];
      if (parts.every((p, i) => /^\d*$/.test(p) && p.length <= lim[i])) {
        return parts.join('/');
      }
    }
    const d = clean.replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    if (d.length > 2) return d.slice(0, 2) + '/' + d.slice(2);
    return d;
  };

  const handleChange = (e) => {
    const out = mask(e.target.value);
    setText(out);
    // Chỉ propagate khi là ngày ĐẦY ĐỦ dd/mm/yyyy — chuỗi dở dang ("01/02")
    // mà đưa qua toApiDate sẽ rơi vào fallback new Date() mơ hồ (VD "01/02" → năm 2001).
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(out)) return;
    const api = toApiDate(out);
    if (api) {
      lastGood.current = out;
      onChange(clamp(api));
    }
  };

  const handleBlur = () => {
    focused.current = false;
    const api = toApiDate(text);
    if (api) {
      const f = fmtDate(api);
      lastGood.current = f;
      setText(f);
      onChange(clamp(api));
    } else if (text.trim() === '') {
      lastGood.current = '';
      setText('');
      onChange('');
    } else {
      // Sai định dạng → hoàn về giá trị đúng gần nhất, không bao giờ kẹt
      setText(lastGood.current);
    }
  };

  const minDate = parseApi(min);
  const maxDate = parseApi(max);
  const prevDisabled = !!minDate && (view.year < minDate.getFullYear() || (view.year === minDate.getFullYear() && view.month <= minDate.getMonth()));
  const nextDisabled = !!maxDate && (view.year > maxDate.getFullYear() || (view.year === maxDate.getFullYear() && view.month >= maxDate.getMonth()));

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'flex', minWidth: 0, ...(className && className.includes('flex-1') ? { flex: '1 1 auto' } : {}) }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder || 'dd/mm/yyyy'}
        maxLength={10}
        value={text}
        onChange={handleChange}
        onFocus={() => { focused.current = true; }}
        onBlur={handleBlur}
        className={className}
        disabled={disabled}
        style={{ flex: '1 1 auto', minWidth: 0, paddingRight: 44, ...style }}
        {...rest}
      />
      <button type="button" aria-label="Mở lịch chọn ngày" aria-expanded={open} disabled={disabled}
        onMouseDown={(e) => e.preventDefault()} onClick={toggleCalendar}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#24305E' }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /></svg>
      </button>
      {open && (
        <div onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'absolute', top: 'calc(100% + 6px)', ...(alignRight ? { right: 0 } : { left: 0 }), width: 292, maxWidth: 'calc(100vw - 16px)', background: '#fff', border: '1px solid #E4E8F0', borderRadius: 12, padding: 10, boxShadow: '0 10px 28px rgba(36,48,94,.14)', zIndex: 70, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button type="button" aria-label="Tháng trước" disabled={prevDisabled}
              onClick={() => setView((v) => { const d = new Date(v.year, v.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
              style={{ width: 36, height: 36, border: 0, borderRadius: 8, background: '#F5F6FA', color: '#24305E', fontSize: 17, cursor: prevDisabled ? 'not-allowed' : 'pointer', opacity: prevDisabled ? 0.35 : 1 }}>‹</button>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#24305E' }}>Tháng {view.month + 1} · {view.year}</div>
            <button type="button" aria-label="Tháng sau" disabled={nextDisabled}
              onClick={() => setView((v) => { const d = new Date(v.year, v.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
              style={{ width: 36, height: 36, border: 0, borderRadius: 8, background: '#F5F6FA', color: '#24305E', fontSize: 17, cursor: nextDisabled ? 'not-allowed' : 'pointer', opacity: nextDisabled ? 0.35 : 1 }}>›</button>
          </div>
          <CalGrid view={view} selected={selectedDate} minDate={minDate} maxDate={maxDate} onPick={pickDay} />
        </div>
      )}
    </span>
  );
}

const pad2 = (n) => String(n).padStart(2, '0');
const parseApi = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const toApiStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function CalGrid({ view, selected, minDate, maxDate, onPick }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = new Date(view.year, view.month, 1);
  const startOffset = (first.getDay() + 6) % 7; // tuần bắt đầu Thứ 2
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < cellCount; i += 1) {
    const d = new Date(view.year, view.month, i - startOffset + 1);
    const inMonth = d.getMonth() === view.month;
    const outOfBounds = (minDate && d < minDate) || (maxDate && d > maxDate);
    cells.push({ d, inMonth, disabled: !inMonth || !!outOfBounds });
  }
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 2 }}>
        {WEEKDAYS.map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#8A93A8', padding: '3px 0' }}>{w}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map(({ d, inMonth, disabled }) => {
          const isToday = d.getTime() === today.getTime();
          const isSel = !!selected && d.getTime() === selected.getTime();
          return (
            <button key={d.toISOString()} type="button" disabled={disabled} onClick={() => onPick(d)}
              style={{ position: 'relative', height: 36, border: 0, borderRadius: 8, fontSize: 13, fontWeight: isToday || isSel ? 700 : 400, background: isSel ? '#24305E' : 'transparent', color: isSel ? '#fff' : (!inMonth || disabled ? '#C3CADB' : (isToday ? '#24305E' : '#23283B')), cursor: disabled ? 'not-allowed' : 'pointer' }}>
              {d.getDate()}
              {isToday && <span style={{ position: 'absolute', left: '50%', bottom: 3, transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: isSel ? '#fff' : '#F5A623' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
