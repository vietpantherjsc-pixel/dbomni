import React, { useState } from 'react';
import { api, fmt, getProfile, setProfile } from '../api';
import { TabBar } from './Home';

export default function Account() {
  const [phone, setPhone] = useState(() => getProfile()?.phone || '');
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!phone.trim()) { alert('Nhập số điện thoại.'); return; }
    setLoading(true);
    try {
      const c = await api.customerByPhone(phone.trim());
      setCustomer(c);
      if (c) setProfile({ name: c.name, phone: c.phone, member_code: c.member_code }); // Gói 9: giữ mã TV để share link
      else alert('Chưa có thông tin thành viên với SĐT này. Đặt món 1 lần để tạo thẻ thành viên nhé!');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><h1>Tài khoản</h1></div>
      <div className="zm-search">
        <input placeholder="Nhập SĐT để xem điểm & hạng" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        <button className="zm-btn-outline" style={{ width: 'auto', padding: '10px 18px' }} onClick={lookup} disabled={loading}>
          {loading ? '...' : 'Xem'}
        </button>
      </div>

      {customer && (
        <div style={{ padding: '4px 16px' }}>
          <div style={{ background: 'linear-gradient(135deg, var(--zm-primary), color-mix(in srgb, var(--zm-primary) 70%, #000))', borderRadius: 16, padding: 20, color: '#fff' }}>
            <div style={{ fontSize: 13, opacity: .85 }}>Thẻ thành viên</div>
            <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0' }}>{customer.name}</div>
            <div style={{ fontSize: 13 }}>{customer.member_code} · Hạng {customer.tier || 'Regular'}</div>
            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(customer.points)}</div><div style={{ fontSize: 11, opacity: .85 }}>điểm</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(customer.total_spent)}đ</div><div style={{ fontSize: 11, opacity: .85 }}>đã chi tiêu</div></div>
            </div>
          </div>

          <div className="zm-section-title" style={{ padding: '16px 0 8px' }}>Đơn gần đây</div>
          {customer.orders.length === 0 && <div className="zm-empty" style={{ padding: 20 }}>Chưa có đơn nào.</div>}
          {customer.orders.map((o) => (
            <div key={o.id} className="zm-total-row" style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span><b>{o.code}</b><br /><span style={{ fontSize: 12, color: '#888' }}>{new Date(o.created_at).toLocaleDateString('vi-VN')} · {o.status}</span></span>
              <span><b>{fmt(o.total_amount)}đ</b></span>
            </div>
          ))}
        </div>
      )}
      {!customer && (
        <div className="zm-note" style={{ margin: '0 16px' }}>
          Nhập số điện thoại bạn đã dùng khi đặt món để xem điểm tích lũy, hạng thành viên và lịch sử đơn hàng.
        </div>
      )}
      <TabBar />
    </div>
  );
}
