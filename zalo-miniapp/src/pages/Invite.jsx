import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getProfile, profileIdentity } from '../api';
import { TabBar } from './Home';

// SPEC-02: Trang "Mời bạn nhận ưu đãi" (L13).
export default function Invite() {
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const profile = getProfile();
  const customerId = profile?.customer_id;

  useEffect(() => {
    if (!customerId) { setLoading(false); return; }
    api.myReferral(profileIdentity(profile))
      .then(setInfo)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [customerId]);

  const share = () => {
    if (!info?.referral_code) return;
    const link = `${window.location.origin}/?ref=${info.referral_code}`;
    const text = `Uống trà sữa Daybreak cùng mình nhé! Nhập mã ${info.referral_code} khi đặt đơn đầu để cả hai cùng nhận ưu đãi 50%.`;
    // Share qua Zalo (nếu trong Zalo client) hoặc copy link
    if (navigator.share) {
      navigator.share({ title: 'Mời bạn nhận ưu đãi', text, url: link }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(`${text}\n${link}`);
      alert('Đã copy link mời bạn!');
    }
  };

  if (!customerId) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Mời bạn</h1></div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
          Vui lòng vào Tài khoản để liên kết số điện thoại trước.
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Mời bạn nhận ưu đãi</h1></div>

      <div style={{ padding: 16 }}>
        <div style={{
          background: 'linear-gradient(135deg, #24305E, #3a4a8a)', borderRadius: 16,
          padding: 20, color: '#fff', textAlign: 'center',
        }}>
          <div style={{ fontSize: 40 }}>🎁</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>Mời bạn — cả hai cùng được</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>
            Bạn đặt đơn đầu qua link của bạn + thanh toán thành công<br />
            → cả hai cùng nhận coupon <b>giảm 50%</b>
          </div>
          {loading ? (
            <div style={{ marginTop: 12, fontSize: 13 }}>Đang tải...</div>
          ) : (
            <>
              <div style={{
                background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 16px',
                marginTop: 12, fontSize: 20, fontWeight: 800, letterSpacing: 2,
              }}>
                {info?.referral_code}
              </div>
              <button
                onClick={share}
                style={{
                  background: '#F5A623', color: '#fff', border: 'none', borderRadius: 10,
                  padding: '12px 32px', fontWeight: 800, fontSize: 15, marginTop: 12, width: '100%',
                }}
              >
                Chia sẻ qua Zalo
              </button>
            </>
          )}
        </div>

        {!loading && info && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginTop: 16, border: '1px solid #eee' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Bạn đã mời</div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <div style={{ flex: 1, textAlign: 'center', background: '#f8f9fa', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#24305E' }}>{info.total_invited}</div>
                <div style={{ fontSize: 12, color: '#888' }}>Đã mời</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center', background: '#f8f9fa', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#F5A623' }}>{info.completed}</div>
                <div style={{ fontSize: 12, color: '#888' }}>Đã nhận coupon</div>
              </div>
            </div>
            {(info.referrals || []).map((r, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', padding: '8px 0',
                borderBottom: '1px solid #f0f0f0', fontSize: 13,
              }}>
                <span>{r.name}</span>
                <span style={{ color: r.status === 'completed' ? '#16a34a' : '#999', fontWeight: 600 }}>
                  {r.status === 'completed' ? '✓ Đã nhận' : 'Chờ đặt đơn'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <TabBar />
    </div>
  );
}
