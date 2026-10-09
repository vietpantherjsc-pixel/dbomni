import React from 'react';

// Gói 36: ô nhập giờ 24h dùng chung (tách từ Gói 35c).
// Thay <input type="time"> vì trình duyệt hiển thị 12h (AM/PM) theo locale Windows, không ép được.
// value/onChange: chuỗi "HH:MM". Gõ "0700" → "07:00".
export const fmt24 = (v) => {
  const d = String(v || '').replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return d.slice(0, 2) + ':' + d.slice(2);
};

export const valid24 = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');

export default function TimeInput({ value, onChange, className, placeholder, ...rest }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder || 'HH:MM'}
      maxLength={5}
      value={value || ''}
      onChange={(e) => onChange(fmt24(e.target.value))}
      className={className}
      {...rest}
    />
  );
}
