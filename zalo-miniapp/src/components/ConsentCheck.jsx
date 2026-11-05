import React, { useState } from 'react';
import PrivacyPolicy from './PrivacyPolicy';

// Spec đăng ký Zalo B §2.1: Ô ĐỒNG Ý NĐ 13/2023 DÙNG CHUNG — trang Tài khoản
// (thẻ đăng ký mới) và trang Minigame (lối vào phụ) dùng đúng component này,
// không chép bản thứ hai. Nội dung giữ nguyên văn ô hiện tại ở Account.jsx:
// không tích sẵn; "Xem chính sách" mở popup Chính sách riêng tư hiện hữu.
export default function ConsentCheck({ checked, onChange }) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  return (
    <>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#555', cursor: 'pointer', lineHeight: 1.5 }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
        <span>
          Tôi đồng ý cho Daybreak xử lý dữ liệu cá nhân của tôi (SĐT, …) cho mục đích quản lý thành viên, tích điểm và gửi ưu đãi. Tôi có thể rút lại đồng ý bất cứ lúc nào.{' '}
          <span onClick={(e) => { e.preventDefault(); setShowPrivacy(true); }} style={{ color: '#24305E', fontWeight: 700, textDecoration: 'underline' }}>Xem chính sách</span>
        </span>
      </label>
      <PrivacyPolicy open={showPrivacy} onClose={() => setShowPrivacy(false)} />
    </>
  );
}
