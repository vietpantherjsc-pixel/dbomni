import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

export default function Success() {
  const { code } = useParams();
  const nav = useNavigate();
  return (
    <div className="zm-page" style={{ textAlign: 'center', paddingTop: 60 }}>
      <div style={{ fontSize: 64 }}>✅</div>
      <h2 style={{ margin: '12px 0' }}>Đặt món thành công!</h2>
      <p style={{ color: '#666', fontSize: 14 }}>Mã đơn của bạn:</p>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--zm-primary)', margin: '8px 0' }}>{code}</div>
      <p style={{ color: '#888', fontSize: 13, padding: '0 24px', lineHeight: 1.6 }}>
        Quán sẽ xác nhận đơn trong ít phút. Bạn có thể theo dõi trạng thái đơn hàng bất cứ lúc nào.
      </p>
      <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="zm-btn-primary" onClick={() => nav(`/track?code=${code}`)}>Theo dõi đơn hàng</button>
        <Link to="/" style={{ color: 'var(--zm-primary)', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Về trang chủ</Link>
      </div>
    </div>
  );
}
