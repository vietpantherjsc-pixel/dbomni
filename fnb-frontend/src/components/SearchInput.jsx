import React from 'react';

// Chuẩn ô tìm kiếm Admin/POS/Hub (Đại Vương chốt 2026-11-04, spec Phần B):
// nút kính lúp SVG đơn sắc (cùng kiểu nét với Icon của AdminLayout) ở
// NGOÀI CÙNG BÊN PHẢI, bấm vào = chạy đúng hành động tìm của ô đó
// (onSearch) như Enter — không icon tĩnh, không emoji trong placeholder,
// không icon bên trái. Vùng bấm ≥ 40px. Ô lọc-trực-tiếp: onSearch áp
// dụng/làm mới kết quả với từ khóa hiện tại.
// Mọi prop còn lại (value/onChange/className/style...) đi thẳng vào
// <input>; className/style của input giữ nguyên như trước, chỉ cộng thêm
// đệm phải 44px cho nút. wrapperStyle chỉnh khung bao khi ô cũ là phần
// tử flex/full-width. ref được forward vào <input> (POS dùng F3 focus).
const SearchInput = React.forwardRef(function SearchInput({ onSearch, wrapperStyle, wrapperClassName, iconColor, onKeyDown, style, ...inputProps }, ref) {
  const run = () => { if (onSearch) onSearch(inputProps.value); };
  return (
    <span className={wrapperClassName} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...wrapperStyle }}>
      <input
        {...inputProps}
        ref={ref}
        style={{ ...style, paddingRight: 44 }}
        onKeyDown={(e) => {
          if (onKeyDown) onKeyDown(e);
          if (e.key === 'Enter' && onSearch) { e.preventDefault(); run(); }
        }}
      />
      <button
        type="button"
        aria-label="Tìm kiếm"
        onClick={run}
        style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 'none', background: 'transparent', color: iconColor || '#24305E', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      </button>
    </span>
  );
});

export default SearchInput;
