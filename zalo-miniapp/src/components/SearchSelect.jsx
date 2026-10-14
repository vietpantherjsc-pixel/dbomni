import React, { useState, useMemo } from 'react';

// Gói 50f: ô chọn có tìm kiếm cho Tỉnh/Phường (danh sách dài, chọn nhanh trên mobile).
// Props: label, value (code), options [{code, name}], placeholder, onChange(code), disabled
export default function SearchSelect({ label, value, options, placeholder, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');

  const selected = options.find((o) => String(o.code) === String(value));
  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return options.slice(0, 50);
    return options.filter((o) => o.name.toLowerCase().includes(k)).slice(0, 50);
  }, [kw, options]);

  return (
    <div className="zm-field">
      {label && <label>{label}</label>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(true); setKw(''); }}
        style={{
          width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10,
          border: '1px solid #e0e0e0', background: disabled ? '#f5f5f5' : '#fff',
          fontSize: 14, color: selected ? '#222' : '#999',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : placeholder}
        </span>
        <span style={{ color: '#999' }}>▾</span>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 999 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              bottom: 0, width: '100%', maxWidth: 480, height: '60vh',
              background: '#fff', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '8px 16px 8px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>{label || placeholder}</div>
                <button
                  type="button" onClick={() => setOpen(false)}
                  style={{ border: 'none', background: '#f0f0f0', borderRadius: '50%', width: 28, height: 28, fontSize: 14 }}
                >✕</button>
              </div>
              <input
                autoFocus
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="🔍 Gõ để tìm..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e0e0e0', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '4px 0 16px' }}>
              {filtered.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#999', fontSize: 13 }}>Không tìm thấy</div>
              )}
              {filtered.map((o) => (
                <div
                  key={o.code}
                  onClick={() => { onChange(String(o.code)); setOpen(false); }}
                  style={{
                    padding: '12px 16px', fontSize: 14, borderBottom: '1px solid #f5f5f5',
                    background: String(o.code) === String(value) ? '#eef2ff' : '#fff',
                    fontWeight: String(o.code) === String(value) ? 700 : 400,
                  }}
                >
                  {o.name}
                </div>
              ))}
              {options.length > 50 && !kw && (
                <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 12 }}>Gõ để tìm trong {options.length} mục...</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
