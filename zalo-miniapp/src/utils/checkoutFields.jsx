import React from 'react';

// Dùng chung Checkout đơn thường + GroupCheckout đơn nhóm (Spec đơn nhóm đồng bộ 2026-10-21).
// Trước đây các helper này nằm trong Checkout.jsx; tách ra để 2 form dùng cùng 1 bản.
export function DateField({ value, onChange }) {
  const mask = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 8);
    if (d.length > 4) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
    if (d.length > 2) return d.slice(0, 2) + '/' + d.slice(2);
    return d;
  };
  return (
    <input value={value} onChange={(e) => onChange(mask(e.target.value))}
      placeholder="dd/mm/yyyy" inputMode="numeric" maxLength={10}
      style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
  );
}
export function TimeField({ value, onChange }) {
  const mask = (raw) => {
    const d = String(raw).replace(/\D/g, '').slice(0, 4);
    if (d.length > 2) return d.slice(0, 2) + ':' + d.slice(2);
    return d;
  };
  return (
    <input value={value} onChange={(e) => onChange(mask(e.target.value))}
      placeholder="HH:MM" inputMode="numeric" maxLength={5}
      style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
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
