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

export default function MonthInput({ value, onChange, className, style, ...rest }) {
  const [text, setText] = React.useState(() => toDisplay(value));
  const [focus, setFocus] = React.useState(false);
  React.useEffect(() => { if (!focus) setText(toDisplay(value)); }, [value, focus]);

  const handle = (raw) => {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 6);
    const disp = d.length <= 2 ? d : d.slice(0, 2) + '/' + d.slice(2);
    setText(disp);
    const m = /^(\d{2})\/(\d{4})$/.exec(disp);
    if (m && +m[1] >= 1 && +m[1] <= 12) onChange(`${m[2]}-${m[1]}`);
    else if (disp === '') onChange('');
  };

  return (
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
      style={style}
      {...rest}
    />
  );
}
