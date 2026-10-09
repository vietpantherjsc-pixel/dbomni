import React, { useState } from 'react';
import { api, fmt, getProfile, setProfile } from '../api';
import { fmtDate } from '../utils/format';
import { TabBar } from './Home';

// Gói 11: Tài khoản đăng nhập bằng SĐT + Mã thành viên (bỏ tra cứu tự do bằng SĐT
// để tránh lộ thông tin khách hàng). Mã TV in trên thẻ/quét QR tại quầy.
export default function Account() {
  const [phone, setPhone] = useState(() => getProfile()?.phone || '');
  const [memberCode, setMemberCode] = useState(() => getProfile()?.member_code || '');
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!phone.trim() || !memberCode.trim()) { alert('Nhập số điện thoại và mã thành viên.'); return; }
    setLoading(true);
    try {
      const c = await api.customerByPhone(phone.trim(), memberCode.trim());
      setCustomer(c);
      if (c) setProfile({ name: c.name, phone: c.phone, member_code: c.member_code });
      else alert('SĐT hoặc mã thành viên không đúng. Mã TV in trên thẻ thành viên của bạn.');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  const logout = () => {
    setProfile(null);
    setCustomer(null);
    setPhone('');
    setMemberCode('');
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><h1>Tài khoản</h1></div>
      {!customer && (
        <>
          <div className="zm-search" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
            <input placeholder="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            <input placeholder="Mã thành viên (VD: TV6BDAFA)" value={memberCode} onChange={(e) => setMemberCode(e.target.value)} style={{ textTransform: 'uppercase' }} />
            <button className="zm-btn-primary" onClick={lookup} disabled={loading}>
              {loading ? '...' : 'Đăng nhập'}
            </button>
          </div>
          <div className="zm-note" style={{ margin: '0 16px' }}>
            Đăng nhập bằng SĐT + mã thành viên (in trên thẻ của bạn) để xem điểm, hạng và lịch sử đơn hàng.
          </div>
        </>
      )}

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

          <button className="zm-btn-outline" style={{ marginTop: 12 }} onClick={logout}>Đăng xuất</button>

          <div className="zm-section-title" style={{ padding: '16px 0 8px' }}>Đơn gần đây</div>
          {customer.orders.length === 0 && <div className="zm-empty" style={{ padding: 20 }}>Chưa có đơn nào.</div>}
          {customer.orders.map((o) => (
            <div key={o.id} className="zm-total-row" style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span><b>{o.code}</b><br /><span style={{ fontSize: 12, color: '#888' }}>{fmtDate(o.created_at)} · {o.status}</span></span>
              <span><b>{fmt(o.total_amount)}đ</b></span>
            </div>
          ))}
        </div>
      )}
      <TabBar />
    </div>
  );
}
