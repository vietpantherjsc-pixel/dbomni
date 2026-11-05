import React from 'react';
import ZmIcon from './ZmIcon';

// Chuẩn ô tìm kiếm Mini App (Đại Vương chốt 2026-11-04, spec Phần B):
// nút kính lúp SVG ở NGOÀI CÙNG BÊN PHẢI, bấm vào = chạy đúng hành động
// tìm của ô đó (onSearch) như Enter — không icon tĩnh, không icon trong
// placeholder, không icon bên trái. Vùng bấm 44px (chuẩn cảm ứng).
// Ô lọc-trực-tiếp: onSearch áp dụng/làm mới kết quả với từ khóa hiện tại.
export default function SearchInput({ value, onChange, onSearch, placeholder, className, style, inputStyle, autoFocus }) {
  const run = () => { if (onSearch) onSearch(value); };
  return (
    <div className={className} style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
        style={{ flex: 1, width: '100%', boxSizing: 'border-box', ...inputStyle, paddingRight: 52 }}
      />
      <button
        type="button"
        aria-label="Tìm kiếm"
        onClick={run}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, border: 'none', background: 'transparent', color: '#24305E', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
      >
        <ZmIcon name="search" size={20} />
      </button>
    </div>
  );
}
