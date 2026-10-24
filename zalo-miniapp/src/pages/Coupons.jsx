import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getProfile, profileIdentity } from '../api';
import { TabBar } from './Home';

// SPEC-02: Trang "Ưu đãi của tôi" (L13) — ví coupon cá nhân.
// 3 tab: Đang có / Sắp hết hạn / Đã dùng.
export default function Coupons() {
  const nav = useNavigate();
  const [tab, setTab] = useState('active');
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const profile = getProfile();
  const customerId = profile?.customer_id;

  useEffect(() => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    api.myCoupons(profileIdentity(profile), tab)
      .then((list) => setCoupons(list || []))
      .catch(() => setCoupons([]))
      .finally(() => setLoading(false));
  }, [customerId, tab]);

  const fmtDate = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  };

  const discountText = (p) => {
    if (!p) return '';
    if (p.type === 'percent') return `Giảm ${p.value}%${p.max_discount_amount ? ` (tối đa ${Number(p.max_discount_amount).toLocaleString('vi-VN')}đ)` : ''}`;
    if (p.type === 'gift') return 'Tặng món';
    return `Giảm ${Number(p.value).toLocaleString('vi-VN')}đ`;
  };

  if (!customerId) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Ưu đãi của tôi</h1></div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
          Vui lòng vào Tài khoản để liên kết số điện thoại trước.
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Ưu đãi của tôi</h1></div>

      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
        {[
          ['active', 'Đang có'],
          ['expiring', 'Sắp hết hạn'],
          ['used', 'Đã dùng'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
              background: tab === v ? '#24305E' : '#f0f0f0',
              color: tab === v ? '#fff' : '#666', fontWeight: 700, fontSize: 13,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#999', padding: 32 }}>Đang tải...</div>
        ) : coupons.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', padding: 32 }}>
            {tab === 'active' ? 'Chưa có ưu đãi nào.' : tab === 'expiring' ? 'Không có ưu đãi sắp hết hạn.' : 'Chưa dùng ưu đãi nào.'}
          </div>
        ) : (
          coupons.map((c) => (
            <div key={c.id} style={{
              background: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
              // Spec KM chống mã C5: coupon chưa thỏa điều kiện hiện tại → hiện MỜ kèm lý do
              border: '1px solid #eee', opacity: c.status !== 'active' || c.usable_now === false ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{c.promotion?.name}</div>
                  <div style={{ fontSize: 13, color: '#F5A623', fontWeight: 700, marginTop: 4 }}>
                    {discountText(c.promotion)}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                    Mã: {c.code}
                    {c.expires_at && <> · HSD: {fmtDate(c.expires_at)}</>}
                  </div>
                  {c.status === 'active' && c.usable_now === false && c.reason_text && (
                    <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>ⓘ {c.reason_text}</div>
                  )}
                </div>
                {c.status === 'active' && (
                  <button
                    onClick={() => nav('/checkout', { state: { couponId: c.id } })}
                    style={{
                      background: '#F5A623', color: '#fff', border: 'none',
                      borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13,
                    }}
                  >
                    Dùng ngay
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <TabBar />
    </div>
  );
}
