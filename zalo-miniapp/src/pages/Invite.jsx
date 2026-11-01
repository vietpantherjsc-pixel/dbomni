import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getProfile, profileIdentity, miniAppLink } from '../api';
import { TabBar } from './Home';

// SPEC-02: Trang "Mời bạn nhận ưu đãi" (L13).
// Gói Đón Bình Minh (2026-10-28): tên chương trình "Rủ Bạn Đón Bình Minh" +
// MỌI con số render từ khối promo của API (cấu hình CP-02 ở Admin) — không
// ghi cứng số trong trang, đổi cấu hình là nội dung tự khớp.
export default function Invite() {
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false); // UX 2026-10-26 (🟠4): lỗi tải hiện rõ + Thử lại, không để khung trống chết
  const profile = getProfile();
  const customerId = profile?.customer_id;

  const load = () => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true); setLoadErr(false);
    api.myReferral(profileIdentity(profile))
      .then(setInfo)
      .catch(() => setLoadErr(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, [customerId]);

  const promo = info?.promo || null;

  const share = async () => {
    if (!info?.referral_code) return;
    // Deep-link Mini App chính thức (gói Đón Bình Minh): bạn mới bấm link là
    // mã tự gắn — text vẫn kèm mã dạng chữ làm đường dự phòng nhập tay.
    const link = miniAppLink(info.referral_code);
    const pct = promo?.discount_percent;
    const giftClause = promo?.first_order_gift_active ? 'bạn được tặng 1 cốc 0đ, còn ' : '';
    const couponClause = pct ? `coupon giảm ${pct}%` : 'coupon ưu đãi';
    const text = `Trà sữa/matcha ở Daybreak ngon nè, mình hay đặt qua app của quán. Bấm link này mở app đặt đơn đầu tiên nha — ${giftClause}cả hai đứa mình cùng có ${couponClause} cho lần sau. Mã của mình là ${info.referral_code} nếu app hỏi nhé.`;
    // Ưu tiên kênh chia sẻ của Zalo (openShareSheet qua zmp-sdk); không hỗ
    // trợ thì rơi về navigator.share / sao chép link như trước.
    try {
      const { openShareSheet } = await import('zmp-sdk/apis');
      await openShareSheet({ type: 'text', data: { text: `${text}\n${link}` } });
      return;
    } catch { /* ngoài môi trường Zalo hoặc SDK lỗi — dùng dự phòng */ }
    if (navigator.share) {
      navigator.share({ title: 'Rủ Bạn Đón Bình Minh', text, url: link }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(`${text}\n${link}`);
      alert('Đã copy link mời bạn!');
    }
  };

  if (!customerId) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Rủ Bạn Đón Bình Minh</h1></div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
          Vui lòng vào Tài khoản để liên kết số điện thoại trước.
        </div>
        <TabBar />
      </div>
    );
  }

  // FAQ (nội dung PROMOTION A5; số liệu render từ promo — không in tĩnh)
  const minTxt = promo ? `${fmt(promo.min_order)}đ` : 'mức tối thiểu của chương trình';
  const faqs = [
    ['Khi nào tôi nhận được coupon?',
      'Ngay khi đơn đầu tiên của bạn bạn hoàn tất thanh toán. Coupon nằm trong mục "Ví ưu đãi".'],
    ['Bạn tôi phải làm gì?',
      `Bấm vào link mình chia sẻ để mở app là mã tự gắn sẵn; hoặc mở Mini App Daybreak và nhập mã của bạn ở bước thanh toán (ô "Mã người giới thiệu"). Sau đó đặt đơn đầu tiên từ ${minTxt} và thanh toán thành công.`],
    ['Tôi mời được tối đa bao nhiêu bạn?',
      promo
        ? `Tối đa ${promo.max_per_customer} coupon từ chương trình này${promo.max_per_month > 0 ? `; mỗi tháng tối đa ${promo.max_per_month} coupon` : ''}.`
        : 'Theo thể lệ chương trình đang áp dụng tại quán.'],
    ['Coupon dùng ở đâu, hạn bao lâu?',
      promo
        ? `Chỉ áp dụng khi đặt qua Mini App Daybreak, trong ${promo.valid_days} ngày kể từ ngày nhận.`
        : 'Chỉ áp dụng khi đặt qua Mini App Daybreak, hạn dùng ghi trên từng coupon trong Ví ưu đãi.'],
    ['Tôi mời bạn nhưng chưa thấy coupon?',
      `Kiểm tra bạn ấy đã thanh toán thành công đơn đầu từ ${minTxt} chưa; nếu rồi mà chưa có, nhắn OA Daybreak để được hỗ trợ — cùng các Bạn Bình Minh khác trong cộng đồng nhé.`],
  ];

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Rủ Bạn Đón Bình Minh</h1></div>

      <div style={{ padding: 16 }}>
        <div style={{
          background: 'linear-gradient(135deg, #24305E, #3a4a8a)', borderRadius: 16,
          padding: 20, color: '#fff', textAlign: 'center',
        }}>
          <div style={{ fontSize: 40 }}>🎁</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>Ngon thì rủ bạn. Cả hai cùng có quà.</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>
            {promo ? (
              <>
                Chia sẻ mã của bạn cho bạn bè. Khi bạn ấy đặt đơn đầu tiên từ {fmt(promo.min_order)}đ,{' '}
                <b>cả hai cùng nhận coupon giảm {promo.discount_percent}%</b>
                {promo.max_discount_amount ? <> (tối đa {fmt(promo.max_discount_amount)}đ)</> : null}
                {' '}cho lần ghé tiếp theo.
                {promo.first_order_gift_active && (
                  <><br />Bạn mới còn được tặng ngay <b>1 cốc chào mừng 0đ</b> ở đơn đầu tiên.</>
                )}
              </>
            ) : (
              <>Chia sẻ mã của bạn cho bạn bè. Khi bạn ấy đặt đơn đầu tiên và thanh toán thành công, cả hai cùng nhận coupon ưu đãi cho lần ghé tiếp theo.</>
            )}
          </div>
          {loading ? (
            <div style={{ marginTop: 12, fontSize: 13 }}>Đang tải...</div>
          ) : loadErr ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13 }}>Không tải được mã mời. Kiểm tra kết nối rồi thử lại nhé.</div>
              <button onClick={load} style={{ background: '#F5A623', color: '#3a2a00', border: 'none', borderRadius: 12, padding: '12px 32px', fontWeight: 800, fontSize: 15, marginTop: 12, width: '100%', minHeight: 44 }}>
                Thử lại
              </button>
            </div>
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

        {!loading && info && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginTop: 16, border: '1px solid #eee' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>Câu hỏi thường gặp</div>
            {faqs.map(([q, a], i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < faqs.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#24305E' }}>{q}</div>
                <div style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginTop: 3 }}>{a}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <TabBar />
    </div>
  );
}
