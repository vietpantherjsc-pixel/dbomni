import React from 'react';

// UX 2026-10-26 (🟡T4): ô nhập tháng dùng chung, thay <input type="month"> (định dạng hiển thị
// phụ thuộc locale trình duyệt, không đồng nhất với dd/mm/yyyy của hệ thống).
// Hiển thị "MM/YYYY"; value/onChange giữ định dạng API "YYYY-MM" như input month gốc.
// Gõ "102026" → hiện "10/2026", onChange nhận "2026-10".
export const validMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '');

const toDisplay = (v) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v || '');
  return m ? `${m[2]}/${m[1]}` : '';
};

export default function MonthInput({ value, onChange, className, style, disabled, ...rest }) {
  const [text, setText] = React.useState(() => toDisplay(value));
  const [focus, setFocus] = React.useState(false);
  // Spec ô ngày toàn hệ (mục 7, 2026-11-15): icon lịch ở cuối ô mở lưới chọn
  // tháng ngay dưới ô; chọn tháng đi qua ĐÚNG onChange hiện hữu ("YYYY-MM"),
  // gõ tay MM/YYYY giữ nguyên cơ chế dưới đây.
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(() => { const m = /^(\d{4})-/.exec(value || ''); return m ? +m[1] : new Date().getFullYear(); });
  const [alignRight, setAlignRight] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const togglePicker = () => {
    if (open) { setOpen(false); return; }
    const m = /^(\d{4})-/.exec(value || '');
    setViewYear(m ? +m[1] : new Date().getFullYear());
    const rect = wrapRef.current ? wrapRef.current.getBoundingClientRect() : null;
    setAlignRight(!!rect && rect.left + 264 > window.innerWidth - 8);
    setOpen(true);
  };
  const pickMonth = (mo) => {
    const mm = String(mo).padStart(2, '0');
    setText(`${mm}/${viewYear}`);
    onChange(`${viewYear}-${mm}`);
    setOpen(false);
  };
  React.useEffect(() => { if (!focus) setText(toDisplay(value)); }, [value, focus]);

  const handle = (raw) => {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 6);
    const disp = d.length <= 2 ? d : d.slice(0, 2) + '/' + d.slice(2);
    setText(disp);
    const m = /^(\d{2})\/(\d{4})$/.exec(disp);
    if (m && +m[1] >= 1 && +m[1] <= 12) onChange(`${m[2]}-${m[1]}`);
    else if (disp === '') onChange('');
  };

  const today = new Date();
  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'flex', minWidth: 0, ...(className && className.includes('flex-1') ? { flex: '1 1 auto' } : {}) }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="MM/YYYY"
        maxLength={7}
        value={text}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); setText(toDisplay(value)); }}
        onChange={(e) => handle(e.target.value)}
        className={className}
        disabled={disabled}
        style={{ flex: '1 1 auto', minWidth: 0, paddingRight: 44, ...style }}
        {...rest}
      />
      <button type="button" aria-label="Mở bảng chọn tháng" aria-expanded={open} disabled={disabled}
        onMouseDown={(e) => e.preventDefault()} onClick={togglePicker}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#24305E' }}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /></svg>
      </button>
      {open && (
        <div onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'absolute', top: 'calc(100% + 6px)', ...(alignRight ? { right: 0 } : { left: 0 }), width: 256, maxWidth: 'calc(100vw - 16px)', background: '#fff', border: '1px solid #E4E8F0', borderRadius: 12, padding: 10, boxShadow: '0 10px 28px rgba(36,48,94,.14)', zIndex: 70, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button type="button" aria-label="Năm trước" onClick={() => setViewYear((y) => y - 1)}
              style={{ width: 36, height: 36, border: 0, borderRadius: 8, background: '#F5F6FA', color: '#24305E', fontSize: 17, cursor: 'pointer' }}>‹</button>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#24305E' }}>Năm {viewYear}</div>
            <button type="button" aria-label="Năm sau" onClick={() => setViewYear((y) => y + 1)}
              style={{ width: 36, height: 36, border: 0, borderRadius: 8, background: '#F5F6FA', color: '#24305E', fontSize: 17, cursor: 'pointer' }}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((mo) => {
              const mm = String(mo).padStart(2, '0');
              const isSel = value === `${viewYear}-${mm}`;
              const isCur = viewYear === today.getFullYear() && mo === today.getMonth() + 1;
              return (
                <button key={mo} type="button" onClick={() => pickMonth(mo)}
                  style={{ position: 'relative', height: 38, border: 0, borderRadius: 8, fontSize: 13, fontWeight: isSel || isCur ? 700 : 400, background: isSel ? '#24305E' : '#F5F6FA', color: isSel ? '#fff' : '#23283B', cursor: 'pointer' }}>
                  Th {mo}
                  {isCur && <span style={{ position: 'absolute', left: '50%', bottom: 4, transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: isSel ? '#fff' : '#F5A623' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}
