import React, { useState } from 'react';

// Gói phiên Hub (2026-11-05): hộp nhập PIN step-up dùng chung cho trang
// Kiểm kê (chốt phiếu) và Chế biến (chạy sản xuất) — 2 hành động chạy
// thẳng không qua duyệt nên phải xác nhận lại PIN của chính NV.
// Props: title, message, busy, err, onSubmit(pin), onClose.
export default function HubPinPrompt({ title, message, busy, err, onSubmit, onClose }) {
  const [pin, setPin] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 80 }}
      onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '18px 16px 22px', width: '100%', maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}>
        <h4 style={{ margin: '0 0 6px', color: '#24305E', fontSize: 15 }}>{title}</h4>
        {message && <p style={{ margin: '0 0 10px', fontSize: 13, color: '#1f2937' }}>{message}</p>}
        <label style={{ fontSize: 12.5, fontWeight: 700, color: '#24305E', display: 'block' }}>Mã PIN của bạn (xác nhận lại)</label>
        <input type="password" inputMode="numeric" maxLength={6} autoComplete="off"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••" autoFocus
          style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid #e3e8f2', borderRadius: 12, padding: 12, fontSize: 22, fontWeight: 800, letterSpacing: 10, textAlign: 'center', color: '#24305E', margin: '6px 0' }} />
        <div style={{ fontSize: 11.5, color: '#8a93a6', marginBottom: 4 }}>Nhập 1 lần, miễn nhắc lại trong 5 phút.</div>
        {err && <div style={{ background: '#fdecec', color: '#b91c1c', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, margin: '8px 0' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 9, marginTop: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, borderRadius: 13, padding: '15px 8px', fontSize: 14.5, fontWeight: 800, background: '#fff', color: '#24305E', border: '1.5px solid #e3e8f2', minHeight: 52, cursor: 'pointer' }}>
            Hủy bỏ
          </button>
          <button onClick={() => onSubmit(pin)} disabled={busy || pin.length !== 6}
            style={{ flex: 1, borderRadius: 13, padding: '15px 8px', fontSize: 14.5, fontWeight: 800, background: '#F5A623', color: '#3a2a00', border: 0, minHeight: 52, cursor: 'pointer', opacity: (busy || pin.length !== 6) ? 0.45 : 1 }}>
            {busy ? 'Đang xử lý...' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  );
}
