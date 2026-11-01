import React from 'react';

// UX 2026-10-26 (🟡 Hub): hộp xác nhận tự chế dùng chung cho các trang Hub,
// thay window.confirm/alert native (ngoài Zalo/Zalo Mini App hay bị chặn hoặc hiện xấu).
// Dạng bottom-sheet bo 16px theo thang hệ thống, nút bấm ≥48px.
export default function HubConfirm({ open, title, message, confirmLabel = 'Xác nhận', cancelLabel = 'Quay lại', danger = false, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,12,20,.55)', zIndex: 90, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onCancel}
    >
      <div
        style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div style={{ fontSize: 16, fontWeight: 800, color: '#24305E', marginBottom: 8 }}>{title}</div>}
        <div style={{ fontSize: 14, lineHeight: 1.55, color: '#374151', whiteSpace: 'pre-line' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, minHeight: 48, borderRadius: 12, border: '1px solid #d1d5db', background: '#fff', fontWeight: 700, fontSize: 14.5 }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{ flex: 1.4, minHeight: 48, borderRadius: 12, border: 'none', background: danger ? '#b42318' : '#24305E', color: '#fff', fontWeight: 800, fontSize: 14.5 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
