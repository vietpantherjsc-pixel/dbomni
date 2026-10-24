import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API, fmt, imgUrl, getProfile, setProfile, profileIdentity } from '../api';
import { fmtDate } from '../utils/format';
import { TabBar } from './Home';
import { storage } from '../utils/storage'; // Spec P4-P5: qua module storage (zmp-sdk)
import PrivacyPolicy from '../components/PrivacyPolicy'; // Spec P4-P5: popup chính sách riêng tư

// Gói 55 p5: Mục thu gọn — mặc định đóng, bấm mới xổ xuống (tránh trang dài)
function Collapsible({ icon, title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 12, border: '1px solid #eee', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 15 }}
      >
        <span>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {badge && <span style={{ fontSize: 11, background: '#f0f4ff', color: '#24305E', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{badge}</span>}
        <span style={{ fontSize: 12, color: '#999', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
      </div>
      {open && <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f5f5f5' }}>{children}</div>}
    </div>
  );
}

// Gói 55 p5: Quản lý quyền — xin trực tiếp, hiện trạng thái từng quyền
function PermissionManager() {
  const [perms, setPerms] = useState({ zalo: 'unknown', location: 'unknown', camera: 'unknown' });

  const checkAll = async () => {
    const next = { ...perms };
    // Vị trí: dùng Permissions API nếu có
    try {
      if (navigator.permissions?.query) {
        const r = await navigator.permissions.query({ name: 'geolocation' });
        next.location = r.state === 'granted' ? 'granted' : r.state === 'denied' ? 'denied' : 'unknown';
        const c = await navigator.permissions.query({ name: 'camera' });
        next.camera = c.state === 'granted' ? 'granted' : c.state === 'denied' ? 'denied' : 'unknown';
      }
    } catch {}
    // Zalo: kiểm tra đã lưu profile từ Zalo chưa
    if (storage.get('zm_zalo_profile')) next.zalo = 'granted';
    setPerms(next);
  };

  useEffect(() => { checkAll(); }, []);

  const requestLocation = () => {
    if (!navigator.geolocation) { alert('Thiết bị không hỗ trợ định vị.'); return; }
    navigator.geolocation.getCurrentPosition(
      () => { setPerms((p) => ({ ...p, location: 'granted' })); alert('Đã cấp quyền vị trí.'); },
      (err) => {
        if (err.code === 1) {
          setPerms((p) => ({ ...p, location: 'denied' }));
          alert('Bạn đã từ chối quyền vị trí. Hãy bật lại trong Cài đặt trình duyệt → Quyền riêng tư → Vị trí.');
        }
      },
      { timeout: 10000 }
    );
  };

  const requestCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setPerms((p) => ({ ...p, camera: 'granted' }));
      alert('Đã cấp quyền camera.');
    } catch {
      setPerms((p) => ({ ...p, camera: 'denied' }));
      alert('Bạn đã từ chối quyền camera. Hãy bật lại trong Cài đặt trình duyệt → Quyền riêng tư → Camera.');
    }
  };

  // Spec P4-P5: xin quyền thông tin Zalo THẬT qua zmp-sdk (thay alert stub).
  // Quyền phải được khai báo trong Mini App Center trước. Từ chối → vẫn dùng app bình thường.
  const requestZalo = async () => {
    const inZalo = storage.isZalo();
    if (!inZalo) {
      alert('Chức năng này chỉ hoạt động trên Zalo Mini App thật.\nHiện tại hãy đăng nhập bằng SĐT + mã thành viên ở trên.');
      return;
    }
    try {
      const { getUserInfo, getAccessToken, getPhoneNumber } = await import('zmp-sdk/apis');
      const { userInfo } = await getUserInfo({});
      const accessToken = await getAccessToken({});
      // Lấy SĐT (token mã hóa — server giải mã bằng app secret khi cần)
      let phoneToken = null;
      try {
        const ph = await getPhoneNumber({});
        phoneToken = ph?.token || null;
      } catch { /* từ chối SĐT → vẫn tiếp tục với thông tin cơ bản */ }
      // Gửi server xác thực qua graph.zalo.me + appsecret_proof
      const res = await fetch(API + '/zalo/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          phone_token: phoneToken,
          name: userInfo?.name,
          avatar: userInfo?.avatar,
        }),
      });
      const json = await res.json();
      if (json.success) {
        storage.set('zm_zalo_profile', { zalo_id: json.data.zalo_id, name: json.data.name });
        // Audit 2026-10-23 BM-01/BM-02: server đã xác thực phone_token — lưu SĐT +
        // mã TV server trả vào hồ sơ để các endpoint quyền lợi (ví/điểm) xác thực
        // bằng cặp SĐT + mã TV (zalo_id trần không còn được chấp nhận).
        if (json.data.phone && json.data.member_code) {
          setProfile({ ...(getProfile() || {}), phone: json.data.phone, member_code: json.data.member_code, customer_id: json.data.customer_id, zalo_id: json.data.zalo_id });
        }
        setPerms((p) => ({ ...p, zalo: 'granted' }));
        alert('Đã liên kết tài khoản Zalo: ' + json.data.name + '.\nSĐT ' + (json.data.phone || 'chưa có') + ' sẽ tự điền khi đặt hàng.');
      } else {
        alert(json.message || 'Không liên kết được tài khoản Zalo.');
      }
    } catch (e) {
      // Người dùng từ chối cấp quyền → vẫn dùng app bình thường
      setPerms((p) => ({ ...p, zalo: 'denied' }));
    }
  };

  const items = [
    { key: 'zalo', icon: '👤', name: 'Thông tin Zalo', desc: 'Tên và số điện thoại để tự điền khi đặt hàng', action: requestZalo },
    { key: 'location', icon: '📍', name: 'Vị trí', desc: 'Để tính phí ship chính xác theo khoảng cách', action: requestLocation },
    { key: 'camera', icon: '📷', name: 'Camera', desc: 'Để quét QR tích điểm tại quầy', action: requestCamera },
  ];

  const statusLabel = { granted: ['✓ Đã cấp', 'status-granted'], denied: ['✕ Chưa cấp', 'status-denied'], unknown: ['? Chưa hỏi', 'status-unknown'] };

  return (
    <div style={{ paddingTop: 12 }}>
      {items.map((it) => {
        const [label, cls] = statusLabel[perms[it.key]];
        return (
          <div key={it.key} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{it.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{it.name}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{it.desc}</div>
              <span className={`perm-status ${cls}`}>{label}</span>
            </div>
            {perms[it.key] !== 'granted' && (
              <button className="perm-btn btn-request" onClick={it.action}>Cấp quyền</button>
            )}
          </div>
        );
      })}
      <style>{`
        .perm-status { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 20px; margin-top: 6px; display: inline-block; }
        .status-granted { background: #dcfce7; color: #166534; }
        .status-denied { background: #fee2e2; color: #991b1b; }
        .status-unknown { background: #f3f4f6; color: #6b7280; }
        .perm-btn { padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; flex-shrink: 0; }
        .btn-request { background: #24305E; color: #fff; }
      `}</style>
    </div>
  );
}

// Loyalty 2.0 (2026-10-21) + Phương án A trang Tài khoản (Đại Vương chốt 21:36):
// dải trạng thái duy nhất + tiến trình theo CHẶNG (mốc+nhãn chung 1 cột — sửa
// dứt điểm lỗi P0 lệch mốc) + Cửa hàng điểm theo quy tắc text mục 7.1 báo cáo BA
// + bảng lợi ích giữ dạng bảng (cột đầu sticky). Toàn bộ số liệu từ payload
// loyalty hiện tại — không đổi backend/API.
const ICON_STROKE = { fill: 'none', stroke: 'var(--zm-primary)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const IcoTarget = () => (<svg width="18" height="18" viewBox="0 0 24 24" {...ICON_STROKE}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>);
const IcoGift = () => (<svg width="18" height="18" viewBox="0 0 24 24" {...ICON_STROKE}><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M5 12v9h14v-9M12 8s-4 0-4-2.5S12 3 12 5.5C12 3 16 3 16 5.5S12 8 12 8z" /></svg>);
const IcoStar = () => (<svg width="18" height="18" viewBox="0 0 24 24" {...ICON_STROKE}><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" /></svg>);
const IcoReceipt = () => (<svg width="18" height="18" viewBox="0 0 24 24" {...ICON_STROKE}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M8 8h8M8 12h8" /></svg>);

function LoyaltyBlocks({ customer, onChanged, children }) {
  const L = customer.loyalty;
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState(null);
  const [exchanging, setExchanging] = useState(null);
  const [shopOpen, setShopOpen] = useState(false); // Cửa hàng điểm: hiện 3 món + Xem thêm
  const [histOpen, setHistOpen] = useState(false); // Lịch sử: 10 giao dịch + Xem thêm
  const shopAnchorRef = useRef(null); // nút "Đổi điểm ngay" ở dải trạng thái cuộn xuống đây

  const identity = () => profileIdentity(getProfile());

  const loadShop = () => {
    api.pointsExchangeItems(identity()).then((r) => setItems(r?.data || [])).catch(() => {});
    api.pointsHistory(identity()).then((r) => setHistory(r?.data || null)).catch(() => {});
  };
  useEffect(() => { if (L) loadShop(); }, [customer.id]);

  if (!L) return children ? <>{children}</> : null;

  const doExchange = async (item) => {
    if (!window.confirm(`Đổi ${fmt(item.points_price)} điểm lấy "${item.name}"? Coupon sẽ vào Ví coupon của bạn.`)) return;
    setExchanging(item.id);
    try {
      const r = await api.pointsExchange(identity(), item.id);
      alert((r?.message || 'Đổi điểm thành công!') + (r?.data?.coupon?.code ? `\nMã coupon: ${r.data.coupon.code}` : ''));
      loadShop();
      if (onChanged) onChanged();
    } catch (e) { alert(e.message); }
    finally { setExchanging(null); }
  };

  const tiers = L.tiers || [];
  const curIdx = tiers.findIndex((t) => t.is_current);
  const curTier = curIdx >= 0 ? tiers[curIdx] : null;
  const atRisk = L.keep?.status === 'at_risk';
  const isTop = !L.next_tier;
  const keepMode = atRisk || isTop; // khối tiến trình đo GIỮ HẠNG thay vì lên hạng
  const isNewCustomer = (L.window_spent || 0) === 0 && (L.points || 0) === 0 && !atRisk;

  // % thanh tiến trình: theo chặng (hạng hiện tại → kế tiếp) hoặc theo ngưỡng giữ
  let barPct;
  if (keepMode) {
    barPct = L.keep?.threshold > 0 ? Math.min(100, Math.round((L.window_spent || 0) / L.keep.threshold * 100)) : 100;
  } else {
    const from = curTier?.min_spent_window || 0;
    const to = L.next_tier.threshold || from + 1;
    barPct = Math.max(0, Math.min(100, Math.round(((L.window_spent || 0) - from) / Math.max(1, to - from) * 100)));
  }
  const barColor = keepMode ? (atRisk ? '#dc2626' : '#16a34a') : 'var(--zm-primary)';

  // Hàng mốc hạng: mỗi mốc = 1 cột (vòng tròn + tên căn giữa ngay dưới) — cùng
  // một đơn vị bố cục nên mốc và nhãn KHÔNG THỂ lệch nhau (sửa P0).
  const nT = tiers.length;
  const edgePct = nT > 1 ? 50 / nT : 0; // tâm vòng tròn đầu/cuối tính theo %
  const fillPct = nT > 1 && curIdx > 0 ? (curIdx / (nT - 1)) * (100 - 2 * edgePct) : 0;

  // Dải trạng thái: tối đa 2 dải, ưu tiên cứng tụt hạng → hết hạn điểm →
  // Double Days (chỉ khi không nguy cơ) → vừa lên hạng (thay mọi dải khác).
  const stripBase = { marginTop: 10, borderRadius: 12, padding: '11px 13px', fontSize: 13, display: 'flex', gap: 9, alignItems: 'flex-start' };
  let strips;
  if (L.just_upgraded_to) {
    strips = [(
      <div key="up" style={{ ...stripBase, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#3f4756' }}>
        <span>🎉</span>
        <div><b style={{ color: '#065f46' }}>Bạn vừa lên hạng {L.just_upgraded_to}!</b> Quyền lợi mới đã được áp dụng.</div>
      </div>
    )];
  } else {
    strips = [];
    if (atRisk) {
      strips.push(
        <div key="risk" style={{ ...stripBase, background: '#fef2f2', border: '1px solid #fecaca', color: '#3f4756' }}>
          <span>⚠</span>
          <div><b style={{ color: '#991b1b' }}>Sắp tụt hạng!</b> Chi thêm <b style={{ color: '#991b1b' }}>{fmt(L.keep.remaining)}đ</b>{L.keep.deadline_date ? <> trước ngày <b style={{ color: '#991b1b' }}>{fmtDate(L.keep.deadline_date)}</b></> : ''} để giữ hạng {L.tier_name}.</div>
        </div>
      );
    }
    if (L.points_expiring_soon > 0) {
      strips.push(
        <div key="exp" style={{ ...stripBase, background: '#fff7ed', border: '1px solid #fed7aa', color: '#3f4756' }}>
          <span>⏰</span>
          <div style={{ flex: 1 }}><b style={{ color: '#9a3412' }}>{fmt(L.points_expiring_soon)} điểm</b> sẽ hết hạn{L.points_expire_next_date ? <> vào <b style={{ color: '#9a3412' }}>{fmtDate(L.points_expire_next_date)}</b></> : ' sắp tới'} — đổi coupon sớm kẻo mất điểm nhé!</div>
          <button
            onClick={() => shopAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{ marginLeft: 'auto', flexShrink: 0, background: '#F5A623', color: '#3a2a00', fontWeight: 800, fontSize: 12, border: 0, borderRadius: 9, padding: '8px 11px', cursor: 'pointer', minHeight: 36 }}
          >Đổi điểm ngay ↓</button>
        </div>
      );
    }
    if (!atRisk && L.points_event) {
      strips.push(
        <div key="dd" style={{ ...stripBase, background: '#fff7e6', border: '1px solid #F5A623', color: '#3f4756' }}>
          <span>🔥</span>
          <div><b style={{ color: '#7c4a03' }}>Double Days đang diễn ra!</b> Hạng {L.tier_name} được nhân <b>×{L.points_event.multiplier}</b> điểm cho mọi đơn thanh toán, đến hết {String(L.points_event.ends_at).slice(11, 16)} ngày {fmtDate(String(L.points_event.ends_at).slice(0, 10))}.</div>
        </div>
      );
    }
    strips = strips.slice(0, 2);
  }

  // Cửa hàng điểm: món đổi được ngay lên trước, khóa hạng xuống cuối (giữ thứ tự API trong từng nhóm)
  const sortedItems = [...items].sort((a, b) => {
    const rank = (it) => (it.locked_by_tier ? 2 : it.enough_points && (it.per_customer_remaining === null || it.per_customer_remaining === undefined || it.per_customer_remaining > 0) ? 0 : 1);
    return rank(a) - rank(b);
  });
  const visibleItems = shopOpen ? sortedItems : sortedItems.slice(0, 3);
  const tierDiscount = curTier?.points_discount_pct || 0;

  const benefitRows = [
    ['Hệ số tích điểm', (t) => `×${String(Number(t.earn_multiplier)).replace('.', ',')}`],
    ['Giảm giá đổi điểm', (t) => (t.points_discount_pct > 0 ? `−${t.points_discount_pct}%` : 'Giá chuẩn')],
    ['Ưu đãi sinh nhật', (t) => (t.benefits?.birthday_bonus ? '✓' : '—')],
    ['Thử món mới sớm', (t) => (t.benefits?.early_access_new_item ? '✓' : '—')],
    ['Giờ vàng theo hạng', (t) => (t.benefits?.tier_golden_hour ? '✓' : '—')],
    ['Ngày nhân đôi điểm', (t) => (t.benefits?.double_points_day ? '✓' : '—')],
  ];
  const typeLabel = { earn: 'Tích điểm', redeem: 'Đổi điểm (cũ)', exchange: 'Đổi coupon', expire: 'Hết hạn', adjust: 'Điều chỉnh', revoke: 'Thu hồi' };
  const txns = history?.transactions || [];
  const visibleTxns = histOpen ? txns : txns.slice(0, 10);
  // Lô điểm sắp hết hạn nhất (tô cam trong lịch sử — nối với dải trạng thái hết hạn)
  const soonestLotDate = (history?.lots || []).filter((l) => l.points_remaining > 0).map((l) => l.expires_at).sort()[0] || null;

  // Dòng phụ của món đổi: ĐÚNG 1 thông tin (quy tắc 7.1) — lượt sắp hết thắng, còn lại là tên ưu đãi
  const itemSub = (it) => {
    if (it.per_customer_remaining !== null && it.per_customer_remaining !== undefined && it.per_customer_remaining <= 2) {
      return it.per_customer_remaining > 0 ? `Còn ${it.per_customer_remaining} lượt đổi` : 'Đã hết lượt đổi';
    }
    return it.promotion_name || '';
  };
  const clamp1 = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

  return (
    <>
      {strips}

      {/* Tiến trình theo chặng / giữ hạng — một trạng thái, một thông điệp */}
      <div style={{ marginTop: 12, background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14.5, color: 'var(--zm-primary)' }}>
          <IcoTarget />
          {keepMode ? (isTop && !atRisk ? 'Hạng cao nhất ☀️' : 'Tiến trình giữ hạng') : 'Tiến trình lên hạng'}
        </div>
        <div style={{ height: 9, background: '#eef1f6', borderRadius: 99, margin: '12px 0 6px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${barPct}%`, background: barColor, borderRadius: 99 }} />
        </div>
        <div style={{ fontSize: 12, color: '#8a93a6' }}>
          {keepMode ? (
            <>Giữ hạng: chi tiêu {L.window_days} ngày <b style={{ color: '#1f2937' }}>{fmt(L.window_spent)}đ</b> / cần {fmt(L.keep?.threshold || 0)}đ{isTop && !atRisk ? <> — <b style={{ color: '#16a34a' }}>đang an toàn</b></> : ''}</>
          ) : (
            <>Chi tiêu {L.window_days} ngày gần nhất: <b style={{ color: '#1f2937' }}>{fmt(L.window_spent)}đ</b> · chặng {L.tier_name} → {L.next_tier.name}</>
          )}
        </div>
        <div style={{ fontSize: 13.5, marginTop: 9 }}>
          {atRisk ? (
            <>Đang ở trạng thái nguy cơ — ưu tiên giữ hạng trước.{L.next_tier ? <> Khi an toàn trở lại, khối này chuyển sang tiến trình lên {L.next_tier.name} (còn {fmt(L.next_tier.remaining)}đ).</> : ''}</>
          ) : isTop ? (
            <>Cảm ơn bạn đã đồng hành cùng Daybreak! Thanh này chỉ còn đo mức <b>giữ hạng</b> của bạn.</>
          ) : isNewCustomer ? (
            <>Chào bạn mới! 🎉 Hoàn thành <b>đơn đầu tiên</b> để bắt đầu tích điểm — chi tiêu đủ <b>{fmt(L.next_tier.threshold)}đ</b> trong {L.window_days} ngày là lên hạng <b>{L.next_tier.name}</b> (tích điểm ×{String(Number(tiers[curIdx + 1]?.earn_multiplier || 1)).replace('.', ',')}).</>
          ) : (
            <>Còn <b>{fmt(L.next_tier.remaining)}đ</b> nữa là lên hạng <b>{L.next_tier.name}</b>.</>
          )}
        </div>
        {isNewCustomer && (
          <div style={{ fontSize: 12.5, color: '#8a93a6', marginTop: 4 }}>
            Cách tích điểm: mỗi 10.000đ chi tiêu = 1 điểm × hệ số hạng của bạn. Điểm đổi được coupon trong Cửa hàng điểm bên dưới.
          </div>
        )}
        {!keepMode && L.keep?.status === 'safe' && L.keep?.threshold > 0 && (
          <div style={{ fontSize: 12, color: '#059669', marginTop: 6 }}>🛡️ Bạn đã đủ điều kiện giữ hạng {L.tier_name}.</div>
        )}
        {nT > 1 && (
          <div style={{ position: 'relative', display: 'flex', marginTop: 14 }}>
            <div style={{ position: 'absolute', left: `${edgePct}%`, right: `${edgePct}%`, top: 8, height: 3, background: '#e3e8f2', borderRadius: 99 }} />
            <div style={{ position: 'absolute', left: `${edgePct}%`, top: 8, height: 3, width: `${fillPct}%`, background: 'var(--zm-primary)', borderRadius: 99 }} />
            {tiers.map((t, i) => (
              <div key={t.code || t.name} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                <div style={{
                  width: 17, height: 17, borderRadius: '50%', margin: '0 auto', position: 'relative', zIndex: 1,
                  border: `2.5px solid ${t.is_current ? '#F5A623' : 'var(--zm-primary)'}`,
                  background: t.is_current ? '#F5A623' : i < curIdx ? 'var(--zm-primary)' : '#fff',
                  boxShadow: t.is_current ? '0 0 0 4px #fff3d9' : 'none',
                }} />
                <div style={{ fontSize: 11, marginTop: 5, color: t.is_current ? '#8a5a00' : '#8a93a6', fontWeight: t.is_current ? 800 : 400 }}>
                  {t.name}{t.is_current ? ' · bạn' : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cửa hàng điểm — quy tắc text mục 7.1: tên ≤2 dòng, phụ 1 dòng/1 tin, giá không vỡ dòng */}
      <div ref={shopAnchorRef} style={{ scrollMarginTop: 12 }}>
        <Collapsible icon={<IcoGift />} title="Cửa hàng điểm" badge={`${fmt(L.points)} điểm`} defaultOpen>
          <div style={{ fontSize: 11.5, color: '#8a93a6', paddingTop: 10 }}>
            1 điểm = {fmt(L.point_value)}đ khi đổi coupon{tierDiscount > 0 ? ` · Giá đã gồm ưu đãi −${tierDiscount}% của hạng ${L.tier_name}` : ''}
          </div>
          {items.length === 0 && <div className="zm-empty" style={{ padding: 16 }}>Chưa có món đổi nào. Quay lại sau nhé!</div>}
          {visibleItems.map((it) => {
            const noTurns = it.per_customer_remaining !== null && it.per_customer_remaining !== undefined && it.per_customer_remaining <= 0;
            const discounted = it.points_price < it.points_cost;
            const sub = itemSub(it);
            return (
              <div key={it.id} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid #f1f4fa' }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, background: '#eef1f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{it.icon || '🎁'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, ...clamp2 }}>{it.name}</div>
                  {sub && <div style={{ fontSize: 11.5, color: '#8a93a6', ...clamp1 }}>{sub}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 800, color: 'var(--zm-primary)', fontSize: 15, whiteSpace: 'nowrap' }}>{fmt(it.points_price)} điểm</div>
                  {discounted && <div style={{ fontSize: 11, color: '#8a93a6', textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{fmt(it.points_cost)} điểm</div>}
                  {discounted && tierDiscount > 0 && (
                    <span style={{ display: 'inline-block', background: '#F5A623', color: '#3a2a00', fontWeight: 800, fontSize: 10.5, borderRadius: 7, padding: '1px 7px', marginTop: 2 }}>−{tierDiscount}% hạng bạn</span>
                  )}
                </div>
                {it.locked_by_tier ? (
                  <button disabled style={{ border: 0, borderRadius: 10, padding: '10px 13px', fontWeight: 800, fontSize: 13, minHeight: 44, whiteSpace: 'nowrap', background: '#f1f4fa', color: '#8a93a6' }}>🔒 {it.min_tier_name || 'Theo hạng'}</button>
                ) : noTurns ? (
                  <button disabled style={{ border: 0, borderRadius: 10, padding: '10px 13px', fontWeight: 800, fontSize: 13, minHeight: 44, whiteSpace: 'nowrap', background: '#f1f4fa', color: '#8a93a6' }}>Hết lượt</button>
                ) : !it.enough_points ? (
                  <button disabled style={{ border: 0, borderRadius: 10, padding: '10px 13px', fontWeight: 800, fontSize: 13, minHeight: 44, whiteSpace: 'nowrap', background: '#f1f4fa', color: '#8a93a6' }}>Thiếu {fmt(it.points_price - (L.points || 0))}</button>
                ) : (
                  <button className="zm-btn-primary" style={{ width: 'auto', padding: '10px 13px', fontSize: 13, minHeight: 44, whiteSpace: 'nowrap' }} disabled={exchanging === it.id} onClick={() => doExchange(it)}>
                    {exchanging === it.id ? 'Đang đổi...' : 'Đổi ngay'}
                  </button>
                )}
              </div>
            );
          })}
          {!shopOpen && sortedItems.length > 3 && (
            <button className="zm-btn-outline" style={{ marginTop: 10, minHeight: 44 }} onClick={() => setShopOpen(true)}>Xem thêm {sortedItems.length - 3} món nữa ▾</button>
          )}
          {shopOpen && sortedItems.length > 3 && (
            <button className="zm-btn-outline" style={{ marginTop: 10, minHeight: 44 }} onClick={() => setShopOpen(false)}>Thu gọn ▴</button>
          )}
          <button className="zm-btn-outline" style={{ marginTop: 10, minHeight: 44 }} onClick={() => nav('/coupons')}>Xem Ví coupon ›</button>
        </Collapsible>
      </div>

      {/* PromoCarousel + hàng hành động nhanh: Account truyền qua children (đúng thứ tự phương án A) */}
      {children}

      {/* Bảng lợi ích — GIỮ DẠNG BẢNG (Đại Vương chốt): cột đầu sticky + chỉ thị vuốt ngang */}
      <Collapsible icon={<IcoStar />} title="Lợi ích theo hạng">
        <div style={{ fontSize: 11, color: '#8a93a6', marginTop: 10, textAlign: 'right' }}>Cột "Quyền lợi" cố định — vuốt ngang xem đủ {tiers.length} hạng ›</div>
        <div style={{ overflowX: 'auto', marginTop: 8, border: '1px solid #e3e8f2', borderRadius: 12 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 440, width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, zIndex: 1, background: '#eef1f8', textAlign: 'left', minWidth: 106, padding: '7px 8px', color: 'var(--zm-primary)', fontWeight: 700, boxShadow: '2px 0 4px rgba(36,48,94,.06)' }}>Quyền lợi</th>
                {tiers.map((t) => (
                  <th key={t.code || t.name} style={{ padding: '7px 8px', textAlign: 'center', background: t.is_current ? '#fff8ec' : '#eef1f8', color: 'var(--zm-primary)', fontWeight: t.is_current ? 800 : 600 }}>{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {benefitRows.map(([label, fn]) => (
                <tr key={label}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', textAlign: 'left', minWidth: 106, padding: '7px 8px', fontWeight: 700, color: 'var(--zm-primary)', borderTop: '1px solid #f1f4fa', boxShadow: '2px 0 4px rgba(36,48,94,.06)' }}>{label}</td>
                  {tiers.map((t) => (
                    <td key={t.code || t.name} style={{ padding: '7px 8px', textAlign: 'center', fontWeight: t.is_current ? 700 : 400, background: t.is_current ? '#fff8ec' : 'transparent', borderTop: '1px solid #f1f4fa' }}>{fn(t)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>

      {/* Lịch sử điểm — 10 giao dịch gần nhất + Xem thêm; lô sắp hết hạn tô cam */}
      <Collapsible icon={<IcoReceipt />} title="Lịch sử điểm">
        {history?.lots?.length > 0 && (
          <div style={{ paddingTop: 10 }}>
            {history.lots.map((l) => {
              const soon = soonestLotDate && l.expires_at === soonestLotDate && l.points_remaining > 0;
              return (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', color: soon ? '#9a3412' : '#666', fontWeight: soon ? 700 : 400 }}>
                  <span>Lô điểm (tích {fmtDate(l.earned_at)})</span>
                  <span>Còn <b>{fmt(l.points_remaining)}</b> · HSD {fmtDate(l.expires_at)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ paddingTop: 6 }}>
          {visibleTxns.map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
              <span>{typeLabel[t.type] || t.type}{t.note ? <span style={{ color: '#999' }}> · {t.note}</span> : ''}<br /><span style={{ fontSize: 11.5, color: '#999' }}>{fmtDate(t.created_at)}</span></span>
              <b style={{ color: t.change > 0 ? '#059669' : '#dc2626' }}>{t.change > 0 ? '+' : ''}{fmt(t.change)}</b>
            </div>
          ))}
          {txns.length === 0 && <div className="zm-empty" style={{ padding: 16 }}>Chưa có biến động điểm.</div>}
          {!histOpen && txns.length > 10 && (
            <button className="zm-btn-outline" style={{ marginTop: 10, minHeight: 44 }} onClick={() => setHistOpen(true)}>Xem thêm {txns.length - 10} giao dịch ▾</button>
          )}
          {histOpen && txns.length > 10 && (
            <button className="zm-btn-outline" style={{ marginTop: 10, minHeight: 44 }} onClick={() => setHistOpen(false)}>Thu gọn ▴</button>
          )}
        </div>
      </Collapsible>
    </>
  );
}

// Gói 11: Tài khoản đăng nhập bằng SĐT + Mã thành viên (bỏ tra cứu tự do bằng SĐT
// để tránh lộ thông tin khách hàng). Mã TV in trên thẻ/quét QR tại quầy.
// Gói 48: chỉ hiện điểm (ẩn tổng chi tiêu); carousel banner KM trước lịch sử đơn.

// Carousel banner KM trượt ngang tự động
function PromoCarousel() {
  const [banners, setBanners] = useState([]);
  const [idx, setIdx] = useState(0);
  const [intervalSec, setIntervalSec] = useState(5);
  const timer = useRef(null);

  useEffect(() => {
    api.promoBanners().then((r) => setBanners(r?.data || r || [])).catch(() => {});
    // Lấy thời gian trượt từ cài đặt (cùng API theme)
    fetch(`${API}/theme`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json()).then((d) => {
        const v = (d?.data || d)?.promo_slide_interval;
        if (v > 0) setIntervalSec(v);
      }).catch(() => {});
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    timer.current = setInterval(() => setIdx((i) => (i + 1) % banners.length), intervalSec * 1000);
    return () => clearInterval(timer.current);
  }, [banners.length, intervalSec]);

  if (banners.length === 0) return null;
  return (
    <div style={{ marginTop: 12, position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', width: '100%', transform: `translateX(-${idx * 100}%)`, transition: 'transform .5s ease' }}>
        {banners.map((b) => (
          <img key={b.id} src={imgUrl(b.banner_url)} alt={b.name}
            style={{ width: '100%', flexShrink: 0, aspectRatio: '32/9', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
            onError={(e) => { e.target.style.display = 'none'; }} />
        ))}
      </div>
      {banners.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', gap: 6, justifyContent: 'center' }}>
          {banners.map((b, i) => (
            <span key={b.id} onClick={() => setIdx(i)}
              style={{ width: 8, height: 8, borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,.5)', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Account() {
  const nav = useNavigate();
  const [phone, setPhone] = useState(() => getProfile()?.phone || '');
  const [memberCode, setMemberCode] = useState(() => getProfile()?.member_code || '');
  // Gói 55 p10: cover trang Tài khoản — user tự custom, lưu qua module storage theo SĐT
  const [accountCover, setAccountCover] = useState(() => {
    return storage.get('zm_account_cover') || '';
  });
  const coverInputRef = useRef(null);
  const handleCoverChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { alert('Ảnh tối đa 2MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      setAccountCover(url);
      storage.set('zm_account_cover', url);
    };
    reader.readAsDataURL(f);
  };
  const [customer, setCustomer] = useState(null);
  // Spec P4-P5: checkbox đồng ý NĐ 13/2023 (riêng biệt, KHÔNG tick sẵn) + popup chính sách
  const [agreeND13, setAgreeND13] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  // SPEC-02: số coupon còn hiệu lực để hiện badge trên nút "Ưu đãi của tôi"
  const [couponCount, setCouponCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // Gói 49: sổ địa chỉ
  const [addrBook, setAddrBook] = useState([]);

  const loadAddrs = (cid, phone, memberCode) => {
    api.addresses(cid, phone, memberCode).then((r) => setAddrBook(r?.data || [])).catch(() => {});
  };

  const doLookup = async (ph, mc, silent) => {
    setLoading(true);
    try {
      const c = await api.customerByPhone(ph.trim(), mc.trim());
      setCustomer(c);
      if (c) {
        // Gói 49g: lưu phiên đăng nhập (kèm customer_id cho sổ địa chỉ)
        setProfile({ name: c.name, phone: c.phone, member_code: c.member_code, customer_id: c.id });
        loadAddrs(c.id, c.phone, c.member_code);
        // SPEC-02: nạp số coupon còn hiệu lực
        api.myCoupons({ phone: c.phone, member_code: c.member_code }, 'active').then((list) => setCouponCount((list || []).length)).catch(() => {});
      }
      else if (!silent) alert('SĐT hoặc mã thành viên không đúng. Mã TV in trên thẻ thành viên của bạn.');
      return c;
    } catch (e) { if (!silent) alert(e.message); return null; }
    finally { setLoading(false); }
  };

  const lookup = () => {
    if (!phone.trim() || !memberCode.trim()) { alert('Nhập số điện thoại và mã thành viên.'); return; }
    // Spec P4-P5 (NĐ 13/2023): đăng nhập thành viên cần đồng ý xử lý dữ liệu.
    // Không đồng ý → vẫn xem menu/đặt món, chỉ không đăng nhập/tích điểm.
    if (!agreeND13) {
      if (!window.confirm('Bạn chưa đồng ý cho Daybreak xử lý dữ liệu cá nhân.\n\nĐể đăng nhập thành viên và tích điểm, bạn cần đồng ý (tích vào ô phía dưới).\nBạn vẫn có thể xem thực đơn và đặt món mà không cần đăng nhập.\n\nBấm OK để quay lại tích ô đồng ý.')) return;
      return;
    }
    doLookup(phone, memberCode, false);
  };

  // Gói 49g: tự động đăng nhập lại từ phiên đã lưu
  useEffect(() => {
    const p = getProfile();
    if (p?.phone && p?.member_code) {
      setPhone(p.phone);
      setMemberCode(p.member_code);
      doLookup(p.phone, p.member_code, true);
    }
  }, []);

  const logout = () => {
    setProfile(null);
    setCustomer(null);
    setPhone('');
    setMemberCode('');
  };

  return (
    <div className="zm-page">
      {/* Gói 55 p10: cover trang Tài khoản — user tự custom. Ẩn header tiêu đề (tránh đè card). */}
      <div style={{ position: 'relative', height: 150, background: 'linear-gradient(135deg, var(--zm-primary), #3b4a7a)', overflow: 'hidden' }}>
        {accountCover && <img src={accountCover} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverChange} style={{ display: 'none' }} />
        <button
          onClick={() => coverInputRef.current?.click()}
          title="Đổi cover"
          style={{ position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,.55)', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
      </div>
      {!customer && (
        <>
          <div className="zm-search" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
            <input placeholder="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            <input placeholder="Mã thành viên (VD: TV6BDAFA)" value={memberCode} onChange={(e) => setMemberCode(e.target.value)} style={{ textTransform: 'uppercase' }} />
            <button className="zm-btn-primary" onClick={lookup} disabled={loading}>
              {loading ? '...' : 'Đăng nhập'}
            </button>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#555', cursor: 'pointer', lineHeight: 1.5 }}>
              <input type="checkbox" checked={agreeND13} onChange={(e) => setAgreeND13(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
              <span>
                Tôi đồng ý cho Daybreak xử lý dữ liệu cá nhân của tôi (SĐT, …) cho mục đích quản lý thành viên, tích điểm và gửi ưu đãi. Tôi có thể rút lại đồng ý bất cứ lúc nào.{' '}
                <span onClick={(e) => { e.preventDefault(); setShowPrivacy(true); }} style={{ color: '#24305E', fontWeight: 700, textDecoration: 'underline' }}>Xem chính sách</span>
              </span>
            </label>
          </div>
          <PrivacyPolicy open={showPrivacy} onClose={() => setShowPrivacy(false)} />
          <div className="zm-note" style={{ margin: '0 16px' }}>
            Đăng nhập bằng SĐT + mã thành viên (in trên thẻ của bạn) để xem điểm, hạng và lịch sử đơn hàng.
          </div>
        </>
      )}

      {customer && (
        <div style={{ padding: '4px 16px', marginTop: -30, position: 'relative', zIndex: 2 }}>
          <div style={{ background: 'linear-gradient(135deg, var(--zm-primary), color-mix(in srgb, var(--zm-primary) 70%, #000))', borderRadius: 16, padding: 20, color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
            <div style={{ fontSize: 13, opacity: .85 }}>Thẻ thành viên</div>
            <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0' }}>{customer.name}</div>
            <div style={{ fontSize: 13 }}>{customer.member_code} · Hạng {customer.loyalty?.tier_name || customer.tier || 'Regular'}</div>
            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(customer.loyalty?.points ?? customer.points)}</div><div style={{ fontSize: 11, opacity: .85 }}>điểm</div></div>
            </div>
            {/* Phương án A (2026-10-21): dòng quy đổi điểm chuyển xuống đầu Cửa hàng điểm — thẻ chỉ còn "tôi là ai, tôi có bao nhiêu điểm" */}
          </div>

          {/* Loyalty 2.0 + Phương án A: dải trạng thái → tiến trình → Cửa hàng điểm →
              [children: PromoCarousel + hành động nhanh] → bảng lợi ích → lịch sử điểm */}
          <LoyaltyBlocks customer={customer} onChanged={() => { const p = getProfile(); if (p?.phone && p?.member_code) doLookup(p.phone, p.member_code, true); }}>
          <PromoCarousel />

          {/* Gói 53: quét QR tích điểm tại quầy */}
          <button
            onClick={() => nav('/scan')}
            className="zm-btn-primary"
            style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            📷 Quét QR tích điểm tại quầy
          </button>

          {/* SPEC-02: lối vào Ví ưu đãi + Mời bạn (trước đây trang /coupons, /invite tồn tại nhưng không có link từ Tài khoản) */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button
              onClick={() => nav('/coupons')}
              style={{
                flex: 1, background: '#fff', border: '1.5px solid #FED7AA', borderRadius: 12,
                padding: '14px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 24 }}>🎫</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#9A3412' }}>Ưu đãi của tôi</span>
              {couponCount > 0 && (
                <span style={{ fontSize: 11, color: '#F5A623', fontWeight: 700 }}>{couponCount} coupon</span>
              )}
            </button>
            <button
              onClick={() => nav('/invite')}
              style={{
                flex: 1, background: '#fff', border: '1.5px solid #BFDBFE', borderRadius: 12,
                padding: '14px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              <span style={{ fontSize: 24 }}>🎁</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1D4ED8' }}>Mời bạn bè</span>
              <span style={{ fontSize: 11, color: '#60A5FA' }}>Cả hai cùng được</span>
            </button>
          </div>
          </LoyaltyBlocks>

          {/* Gói 49: sổ địa chỉ — dạng thu gọn */}
          <Collapsible icon="📒" title="Sổ địa chỉ" badge={addrBook.length > 0 ? `${addrBook.length}` : null}>
          {addrBook.length === 0 && <div className="zm-empty" style={{ padding: 16 }}>Chưa có địa chỉ nào. Địa chỉ sẽ tự lưu khi đặt hàng.</div>}
          {addrBook.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{a.is_default ? '★ ' : ''}{a.label}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{a.full_address}</div>
              </div>
              {!a.is_default && (
                <button style={{ fontSize: 12, color: '#0d6efd' }} onClick={async () => {
                  await api.updateAddress(a.id, { customer_id: customer.id, phone: customer.phone, member_code: customer.member_code, street: a.street, is_default: true });
                  loadAddrs(customer.id, customer.phone, customer.member_code);
                }}>Đặt mặc định</button>
              )}
              <button style={{ fontSize: 12, color: '#dc2626' }} onClick={async () => {
                if (!confirm('Xóa địa chỉ này?')) return;
                await api.deleteAddress(a.id, customer.id, customer.phone, customer.member_code);
                loadAddrs(customer.id, customer.phone, customer.member_code);
              }}>Xóa</button>
            </div>
          ))}
          </Collapsible>

          {/* Gói 55 p5: quản lý quyền — dạng thu gọn */}
          <Collapsible icon="🔐" title="Quản lý quyền">
            <PermissionManager />
          </Collapsible>

          <div className="zm-section-title" style={{ padding: '16px 0 8px' }}>Đơn gần đây</div>
          {customer.orders.length === 0 && <div className="zm-empty" style={{ padding: 20 }}>Chưa có đơn nào.</div>}
          {customer.orders.map((o) => (
            <div key={o.id} className="zm-total-row"
              onClick={() => nav(`/track?code=${encodeURIComponent(o.code)}`)}
              style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
              <span><b>{o.code}</b><br /><span style={{ fontSize: 12, color: '#888' }}>{fmtDate(o.created_at)} · {o.status}</span></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{fmt(o.total_amount)}đ</b>
                <span style={{ color: '#0d6efd', fontSize: 16 }}>›</span>
              </span>
            </div>
          ))}
          <button className="zm-btn-outline" style={{ margin: '20px 0 8px' }} onClick={logout}>Đăng xuất</button>
        </div>
      )}
      <TabBar />
    </div>
  );
}
