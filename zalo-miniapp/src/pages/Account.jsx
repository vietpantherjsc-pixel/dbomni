import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API, fmt, imgUrl, getProfile, setProfile, profileIdentity, authWithZalo, getSession, setSession, clearSession, getZaloTokens } from '../api';
import { validPhone } from '../utils/checkoutFields.jsx';
import { fmtDate } from '../utils/format';
import { TabBar } from './Home';
import { storage } from '../utils/storage'; // Spec P4-P5: qua module storage (zmp-sdk)
import ConsentCheck from '../components/ConsentCheck'; // Spec đăng ký Zalo B: ô đồng ý dùng chung
import ZmIcon from '../components/ZmIcon';
import pearlCluster from '../assets/game-pearl-cluster.png'; // Decor thẻ Minigame phương án C: cụm trân châu GỐC của game (không vẽ lại)

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

  // Spec đăng ký Zalo B §2.1: lối vào Quản lý quyền dùng chung hàm authWithZalo
  // (SDK + /zalo/auth + lưu hồ sơ) với thẻ đăng ký mới và trang Minigame.
  // Hành vi lối vào này giữ nguyên: liên kết + thông báo, từ chối quyền → im lặng.
  const requestZalo = async () => {
    try {
      const json = await authWithZalo();
      if (json.code === 'not_zalo') {
        alert('Chức năng này chỉ hoạt động trên Zalo Mini App thật.\nHiện tại hãy đăng nhập bằng SĐT + mật khẩu ở trên.');
        return;
      }
      if (json.success) {
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
    { key: 'zalo', icon: 'user', name: 'Thông tin Zalo', desc: 'Tên và số điện thoại để tự điền khi đặt hàng', action: requestZalo },
    { key: 'location', icon: 'mapPin', name: 'Vị trí', desc: 'Để tính phí ship chính xác theo khoảng cách', action: requestLocation },
    { key: 'camera', icon: 'camera', name: 'Camera', desc: 'Để quét QR tích điểm tại quầy', action: requestCamera },
  ];

  const statusLabel = { granted: ['✓ Đã cấp', 'status-granted'], denied: ['✕ Chưa cấp', 'status-denied'], unknown: ['? Chưa hỏi', 'status-unknown'] };

  return (
    <div style={{ paddingTop: 12 }}>
      {items.map((it) => {
        const [label, cls] = statusLabel[perms[it.key]];
        return (
          <div key={it.key} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 14, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#24305E', flexShrink: 0 }}><ZmIcon name={it.icon} size={22} /></div>
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
  const [mgState, setMgState] = useState(null); // Minigame (2026-11-01): thẻ game dưới Cửa hàng điểm
  const shopAnchorRef = useRef(null); // nút "Đổi điểm ngay" ở dải trạng thái cuộn xuống đây

  const identity = () => profileIdentity(getProfile());

  const loadShop = () => {
    // Sổ #31: req() trong api.js đã bóc sẵn phong bì (trả data.data) — đọc r.data
    // lần nữa sẽ ra undefined và nuốt sạch dữ liệu (lịch sử điểm + kệ đổi điểm
    // luôn rỗng dù API có dữ liệu). Đọc thẳng r, giữ fallback phong bì như PromoCarousel.
    api.pointsExchangeItems(identity()).then((r) => setItems(r?.data || r || [])).catch(() => {});
    api.pointsHistory(identity()).then((r) => setHistory(r?.data || r || null)).catch(() => {});
  };
  useEffect(() => { if (L) loadShop(); }, [customer.id]);
  // Minigame: lỗi API/tắt công tắc → thẻ ẩn, trang không vỡ (bất biến hồi quy mục 12.3)
  useEffect(() => { api.minigameState(identity()).then((d) => setMgState(d)).catch(() => setMgState(null)); }, [customer.id]);

  if (!L) return children ? <>{children}</> : null;

  const doExchange = async (item) => {
    if (!window.confirm(`Đổi ${fmt(item.points_price)} điểm lấy "${item.name}"? Coupon sẽ vào Ví coupon của bạn.`)) return;
    setExchanging(item.id);
    try {
      const r = await api.pointsExchange(identity(), item.id);
      alert('Đổi điểm thành công!' + (r?.coupon?.code ? `\nMã coupon: ${r.coupon.code}` : '')); // Sổ phụ #31: req() chỉ trả data — message nằm ở phong bì (không lấy lại được, dùng câu mặc định); mã nằm ở r.coupon.code
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

  // Hệ số tích điểm theo kênh (spec 2026-11-04, mục 5): chú thích theo hệ số
  // hiệu dụng của kênh zalo — hiện khi chính sách BẬT và hệ số < 1; 0,5 giữ
  // câu "gấp đôi" đúng tỉ lệ thật, hệ số khác hiện đúng ×hệ số (dấu phẩy
  // thập phân theo cách viết tiếng Việt, như spec T-06: ×0,8).
  const chOwnRaw = L.points_channel?.own_channel_factor ?? L.points_channel?.platform_multiplier;
  const chOwn = Number(chOwnRaw);
  const chOwnText = Number.isFinite(chOwn) ? String(chOwn).replace(/\.?0+$/, '').replace('.', ',') : '';
  const chNote = !L.points_channel?.enabled || !Number.isFinite(chOwn) || chOwn >= 1 ? null
    : chOwn === 0
      ? 'Kênh này hiện không tích điểm.'
      : Math.abs(chOwn - 0.5) < 1e-9
        ? 'Đặt qua Mini App tích điểm nhanh gấp đôi so với đặt qua app giao đồ ăn.'
        : `Đơn qua kênh này tích điểm ×${chOwnText}.`;

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
        <span style={{ color: '#059669', display: 'flex' }}><ZmIcon name="checkCircle" size={16} /></span>
        <div><b style={{ color: '#065f46' }}>Bạn vừa lên hạng {L.just_upgraded_to}!</b> Quyền lợi mới đã được áp dụng.</div>
      </div>
    )];
  } else {
    strips = [];
    if (atRisk) {
      strips.push(
        <div key="risk" style={{ ...stripBase, background: '#fef2f2', border: '1px solid #fecaca', color: '#3f4756' }}>
          <span style={{ color: '#b45309', display: 'flex' }}><ZmIcon name="alert" size={16} /></span>
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
          <span style={{ color: '#F5A623', display: 'flex' }}><ZmIcon name="zap" size={16} /></span>
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
  const typeLabel = { earn: 'Tích điểm', redeem: 'Đổi điểm (cũ)', exchange: 'Đổi coupon', expire: 'Điểm hết hạn', adjust: 'Điều chỉnh', revoke: 'Thu hồi' };
  const txns = history?.transactions || [];

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
        {chNote && (
          <div style={{ fontSize: 12.5, color: '#8a93a6', marginTop: 4 }}>{chNote}</div>
        )}
        {!keepMode && L.keep?.status === 'safe' && L.keep?.threshold > 0 && (
          <div style={{ fontSize: 12, color: '#059669', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="shield" size={14} />Bạn đã đủ điều kiện giữ hạng {L.tier_name}.</div>
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
                  <button disabled style={{ border: 0, borderRadius: 10, padding: '10px 13px', fontWeight: 800, fontSize: 13, minHeight: 44, whiteSpace: 'nowrap', background: '#f1f4fa', color: '#8a93a6', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="lock" size={13} />{it.min_tier_name || 'Theo hạng'}</button>
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

      {/* Minigame (2026-11-01): thẻ lối vào game NGAY DƯỚI Cửa hàng điểm, trước
          PromoCarousel — chèn thêm, không đổi mọi khối Phương án A khác */}
      {mgState?.enabled && (
        /* Decor phương án C "Navy sang trọng" (Đại Vương chốt 2026-11-07, theo
           demo-decor-the-minigame-20261107 cardC): nền gradient navy + viền
           vàng + cụm trân châu GỐC của game in chìm. Chỉ thay lớp trình bày —
           điều kiện hiện, vị trí, điều hướng /game và dữ liệu sống giữ nguyên. */
        <button onClick={() => nav('/game')} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'linear-gradient(120deg, #171f3d, #24305E 70%)', border: '1px solid #c9973f', borderRadius: 16, padding: 16, marginTop: 12, minHeight: 56, cursor: 'pointer', color: '#fff' }}>
          <img src={pearlCluster} alt="" style={{ position: 'absolute', right: -16, top: -20, height: 120, opacity: 0.35, pointerEvents: 'none' }} />
          <span style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: 1.6, color: '#F5A623' }}>MINIGAME DAYBREAK</span>
            <span style={{ display: 'block', fontSize: 16.5, fontWeight: 900, marginTop: 3 }}>Hứng Trân Châu</span>
            <span style={{ display: 'block', fontSize: 12.5, color: '#aebadd', marginTop: 3 }}>
              {mgState.plays_left_today > 0
                ? `Còn ${mgState.plays_left_today} lượt hôm nay · đã nhận ${fmt(mgState.earned_today)}/${fmt(mgState.daily_cap_points)} điểm`
                : 'Chơi giải trí không giới hạn ›'}
            </span>
          </span>
          <span style={{ position: 'relative', zIndex: 2, color: '#F5A623', fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap', flexShrink: 0 }}>Chơi ngay ›</span>
        </button>
      )}

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

      {/* Lịch sử điểm — Phương án A + 3 sửa đổi (Đại Vương chốt 2026-11-09):
          BỎ hẳn khối chi tiết lô/HSD; chỉ còn biến động điểm trong MỘT khung
          cuộn ~300px (cuộn bên trong, bỏ nút Xem thêm/Thu gọn), mỗi dòng 1
          dòng gọn như demo. Dòng trừ do hết hạn lấy từ bút toán type=expire
          sẵn có của cơ chế loyalty:expire-points (chạy 01:00 hằng ngày,
          ghi chú kèm lô + ngày tích) — khách thấy rõ vì sao điểm giảm. */}
      <Collapsible icon={<IcoReceipt />} title="Lịch sử điểm">
        <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 4, paddingTop: 6 }}>
          {txns.map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
              <span style={{ ...clamp1, minWidth: 0 }}>
                {typeLabel[t.type] || t.type}
                {t.note ? <span style={{ color: '#999' }}> · {t.note}</span> : ''}
                <span style={{ color: '#999' }}> · {String(t.created_at || '').slice(8, 10)}/{String(t.created_at || '').slice(5, 7)}</span>
              </span>
              <b style={{ color: t.change > 0 ? '#059669' : '#dc2626', flexShrink: 0 }}>{t.change > 0 ? '+' : ''}{fmt(t.change)}</b>
            </div>
          ))}
          {txns.length === 0 && <div className="zm-empty" style={{ padding: 16 }}>Chưa có biến động điểm.</div>}
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
    fetch(`${API}/theme`, { headers: { Accept: 'application/json' } }) // Sổ #25 lớp 2: hằng API phải có trong import của file này (thiếu là trắng trang sau khi đăng nhập)
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
  // Spec đăng nhập SĐT + mật khẩu §5.4: form phụ dùng SĐT + mật khẩu
  // (member_code không còn là chứng thực — chỉ hiển thị trên thẻ thành viên).
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  // Sheet đặt/đổi mật khẩu: 'set' | 'change' | 'zalo-set' | 'counter-set'
  const [pwSheet, setPwSheet] = useState(null);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwPhone, setPwPhone] = useState('');
  const [showPwNew, setShowPwNew] = useState(false);
  const [pwErrs, setPwErrs] = useState([]);
  const [pwBusy, setPwBusy] = useState(false);
  // Spec mật khẩu §7.3: email tự nguyện trong mục bảo mật.
  const [email, setEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  // Gói 55 p10: cover trang Tài khoản — user tự custom, lưu qua module storage theo SĐT
  const [accountCover, setAccountCover] = useState(() => {
    return storage.get('zm_account_cover') || '';
  });
  // Vá cover B (2026-11-09): state trên đọc cache đúng 1 lần lúc mount —
  // cold start qua QR mà hydrate về trễ hơn mốc đua 2s ở main.jsx là đọc
  // trượt cache rỗng, mất hiển thị cả phiên dù dữ liệu còn. Đọc lại 1 lần
  // khi hydrate xong; chỉ lấp khi state đang trống (không đè ảnh người
  // dùng vừa đổi trong phiên).
  useEffect(() => {
    let alive = true;
    storage.ready().then(() => {
      if (!alive) return;
      const v = storage.get('zm_account_cover');
      if (v) setAccountCover((prev) => prev || v);
    });
    return () => { alive = false; };
  }, []);
  // Gói Mini App 2026-10-30: mục Quét QR tích điểm chỉ hiện khi Admin bật công
  // tắc miniapp_qr_claim_entry (mặc định ẨN) — cờ đọc qua /shop-info công khai.
  const [qrClaimEntry, setQrClaimEntry] = useState(false);
  useEffect(() => {
    api.shopInfo().then((d) => setQrClaimEntry(!!d?.qr_claim_entry)).catch(() => {});
  }, []);
  const coverInputRef = useRef(null);
  // Gói nén cover (2026-10-30): nén ảnh ngay trên máy trước khi lưu local —
  // thu nhỏ cạnh dài + mã hóa JPEG để data URL nhẹ đi nhiều lần, tránh
  // phình/tràn bộ nhớ cục bộ. Ảnh vẫn CHỈ lưu trên máy này (không tải lên
  // server). Ảnh đọc/nén không được → báo chọn ảnh khác, không lưu lặng lẽ.
  // Vá cover C (2026-11-09): nén nhẹ hơn nữa — cạnh dài tối đa 900px +
  // JPEG 0.72 — vì native storage của Zalo có thể từ chối chuỗi quá lớn.
  const handleCoverChange = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { alert('Ảnh tối đa 2MB.'); return; }
    const reader = new FileReader();
    reader.onerror = () => alert('Không đọc được ảnh này. Vui lòng chọn ảnh khác.');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => alert('Không đọc được ảnh này. Vui lòng chọn ảnh khác.');
      img.onload = () => {
        try {
          const MAX = 900;
          const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const url = canvas.toDataURL('image/jpeg', 0.72);
          if (!url || !url.startsWith('data:image/jpeg')) throw new Error('compress failed');
          setAccountCover(url);
          // Vá cover C+D (2026-11-09): ghi CÓ xác nhận qua setTracked —
          // persist thất bại (native storage từ chối vì dung lượng) thì
          // báo rõ cho người dùng thay vì nuốt lỗi như trước; đồng thời
          // ghi châm chẩn đoán {ok, size, at} vào khóa 'zm_cover_diag'
          // + console để vòng kiểm máy thật phân định nguyên nhân.
          storage.setTracked('zm_account_cover', url).then((ok) => {
            try { console.info('[cover-diag] persist', ok ? 'OK' : 'FAIL', 'size=', url.length); } catch {}
            storage.set('zm_cover_diag', JSON.stringify({ ok, size: url.length, at: Date.now() }));
            if (!ok) {
              alert(`Không lưu được ảnh trên máy này (ảnh sau nén ${Math.round(url.length / 1024)} KB). Ảnh chỉ hiện trong lần mở này — thoát ra vào lại sẽ mất. Vui lòng chọn ảnh nhẹ hơn.`);
            }
          });
        } catch (err) {
          alert('Không nén được ảnh này. Vui lòng chọn ảnh khác.');
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  const [customer, setCustomer] = useState(null);
  // Spec P4-P5: checkbox đồng ý NĐ 13/2023 (riêng biệt, KHÔNG tick sẵn).
  // Spec đăng ký Zalo B §2.1: MỘT ô đồng ý duy nhất cho cả trang chưa đăng nhập
  // (nằm trong thẻ đăng ký mới, form mã dùng chung state này qua cổng lookup cũ).
  const [agreeND13, setAgreeND13] = useState(false);
  // Spec đăng ký Zalo B: trạng thái thẻ đăng ký / chào mừng / mã mới sau xoay IMP.
  const [zaloBusy, setZaloBusy] = useState(false);
  const [zaloB3, setZaloB3] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const [rotatedNotice, setRotatedNotice] = useState('');
  // SPEC-02: số coupon còn hiệu lực để hiện badge trên nút "Ưu đãi của tôi"
  const [couponCount, setCouponCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // Gói 49: sổ địa chỉ
  const [addrBook, setAddrBook] = useState([]);

  const loadAddrs = (cid, phone, memberCode) => {
    api.addresses(cid, phone, memberCode).then((r) => setAddrBook(Array.isArray(r) ? r : [])).catch(() => {}); // Sổ phụ #31: req() đã bóc phong bì, r chính là MẢNG THUẦN từ backend — đọc r?.data là luôn rỗng
  };

  // Spec đăng nhập SĐT + mật khẩu §3: nạp hồ sơ theo phiên token hiện tại.
  const loadMe = async (silent) => {
    setLoading(true);
    try {
      const c = await api.customerMe();
      setCustomer(c);
      if (c) {
        setProfile({ name: c.name, phone: c.phone, member_code: c.member_code, customer_id: c.id });
        setEmail(c.email || '');
        loadAddrs(c.id, c.phone, c.member_code);
        // SPEC-02: nạp số coupon còn hiệu lực
        api.myCoupons({ phone: c.phone, member_code: c.member_code }, 'active').then((list) => setCouponCount((list || []).length)).catch(() => {});
      }
      return c;
    } catch (e) { if (!silent) alert(e.message); return null; }
    finally { setLoading(false); }
  };

  // Spec đăng nhập SĐT + mật khẩu §5.4: đăng nhập bằng SĐT + mật khẩu.
  // Sai thông tin → một thông báo chung (không phân biệt sai SĐT hay sai
  // mật khẩu, không lộ tài khoản có/không có mật khẩu).
  const lookup = async () => {
    if (!phone.trim()) { alert('Vui lòng nhập số điện thoại.'); return; }
    // Luật SĐT 2026-11-07: sai mẫu 0 + 10 số → chặn ngay, lỗi đỏ hiện tại ô.
    if (!validPhone(phone)) return;
    if (!password) { alert('Vui lòng nhập mật khẩu.'); return; }
    // Spec P4-P5 (NĐ 13/2023): đăng nhập thành viên cần đồng ý xử lý dữ liệu.
    // Không đồng ý → vẫn xem menu/đặt món, chỉ không đăng nhập/tích điểm.
    if (!agreeND13) {
      if (!window.confirm('Bạn chưa đồng ý cho Daybreak xử lý dữ liệu cá nhân.\n\nĐể đăng nhập thành viên và tích điểm, bạn cần đồng ý (tích vào ô phía trên).\nBạn vẫn có thể xem thực đơn và đặt món mà không cần đăng nhập.\n\nBấm OK để quay lại tích ô đồng ý.')) return;
      return;
    }
    setLoading(true);
    try {
      const r = await api.passwordLogin({ phone: phone.trim(), password });
      if (!r.success) {
        if (r.code === 'account_locked') alert(r.message || 'Tài khoản đang bị khóa tạm thời.');
        else alert('SĐT hoặc mật khẩu chưa đúng.');
        return;
      }
      if (r.data?.session_token) setSession({ token: r.data.session_token, expires_at: r.data.session_expires_at || null });
      setPassword('');
      await loadMe(true);
    } catch (e) { alert(e.message || 'Đăng nhập thất bại.'); }
    finally { setLoading(false); }
  };

  const openPwSheet = (mode) => {
    setPwSheet(mode);
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwPhone(phone || '');
    setPwErrs([]); setShowPwNew(false);
  };

  // Gửi sheet đặt/đổi mật khẩu theo chế độ đang mở (spec §5.1–§5.3).
  const submitPwSheet = async () => {
    if (!pwNew || !pwConfirm) { setPwErrs(['Nhập mật khẩu mới và nhập lại để xác nhận.']); return; }
    setPwBusy(true);
    setPwErrs([]);
    try {
      let r;
      if (pwSheet === 'set') {
        r = await api.passwordSet({ new_password: pwNew, new_password_confirmation: pwConfirm });
      } else if (pwSheet === 'change') {
        if (!pwCurrent) { setPwErrs(['Nhập mật khẩu hiện tại.']); return; }
        r = await api.passwordChange({ current_password: pwCurrent, new_password: pwNew, new_password_confirmation: pwConfirm });
      } else if (pwSheet === 'zalo-set') {
        const tk = await getZaloTokens();
        if (!tk.ok) { alert('Chức năng này chỉ hoạt động trên Zalo Mini App thật.'); return; }
        r = await api.passwordZaloSet({ access_token: tk.accessToken, phone_token: tk.phoneToken, new_password: pwNew, new_password_confirmation: pwConfirm });
      } else if (pwSheet === 'counter-set') {
        if (!pwPhone.trim()) { setPwErrs(['Nhập số điện thoại của tài khoản.']); return; }
        if (!validPhone(pwPhone)) { setPwErrs(['Số điện thoại chưa đúng — cần bắt đầu bằng 0 và đủ 10 số.']); return; }
        r = await api.passwordCounterSet({ phone: pwPhone.trim(), new_password: pwNew, new_password_confirmation: pwConfirm });
      }
      if (!r.success) {
        if (Array.isArray(r.errors) && r.errors.length) setPwErrs(r.errors);
        else setPwErrs([r.message || 'Không đặt được mật khẩu.']);
        return;
      }
      if (r.data?.session_token) setSession({ token: r.data.session_token, expires_at: r.data.session_expires_at || null });
      if (r.data?.code_rotated) setRotatedNotice(r.data.member_code);
      setPwSheet(null);
      await loadMe(true);
      alert('Đã đặt mật khẩu thành công.');
    } catch (e) { setPwErrs([e.message || 'Không đặt được mật khẩu.']); }
    finally { setPwBusy(false); }
  };

  // Spec mật khẩu §7.3: khách tự lưu/xóa email ở trang Tài khoản.
  const saveEmail = async () => {
    try {
      const r = await api.updateProfileEmail({ email: email.trim() || null });
      if (!r.success) { setEmailMsg(r.message || 'Không lưu được email.'); return; }
      setEmail(r.data?.email || '');
      setEmailMsg(email.trim() ? 'Đã lưu email.' : 'Đã xóa email.');
      setCustomer((c) => (c ? { ...c, email: r.data?.email || null } : c));
    } catch (e) { setEmailMsg(e.message || 'Không lưu được email.'); }
  };

  // Spec đăng ký Zalo B §2: thẻ đăng ký mới ở đầu trang chưa đăng nhập.
  // Sổ #25 (2026-11-04): handler này TỪNG nằm trong PermissionManager — khác
  // component với thẻ + state nó dùng (agreeND13/zaloBusy/loadMe đều ở Account)
  // → ReferenceError render, trắng trang /account. Giữ handler CÙNG component
  // với state và JSX của nó.
  const handleZaloRegister = async () => {
    if (!agreeND13) return; // nút đã khóa khi chưa tích; chặn thêm cho chắc
    setZaloBusy(true);
    try {
      const json = await authWithZalo();
      if (json.code === 'not_zalo') {
        alert('Chức năng này chỉ hoạt động trên Zalo Mini App thật.\nHiện tại hãy đăng nhập bằng SĐT + mật khẩu ở trên.');
        return;
      }
      if (!json.success) {
        if (json.code === 'phone_permission_required') {
          setZaloB3(true); return;
        }
        alert(json.message || 'Không đăng ký được bằng Zalo.');
        return;
      }
      setZaloB3(false);
      const d = json.data;
      // Spec mật khẩu §3.4: /zalo/auth đã phát hành token phiên — nạp hồ
      // sơ theo token, không dùng cặp SĐT + mã để tra cứu nữa.
      if (d.is_new) {
        // Khách mới → nạp hồ sơ đầy đủ (hạng/điểm) rồi hiện màn chào mừng 1 lần.
        const c = await loadMe(true);
        if (c) setWelcome(c);
        else setWelcome({ name: d.name, phone: d.phone, member_code: d.member_code, tier: '', loyalty: { points: 0 } });
      } else {
        if (d.code_rotated) setRotatedNotice(d.member_code);
        await loadMe(true);
      }
    } catch {
      // Từ chối hộp thoại quyền Zalo → giữ nguyên trang, không tạo gì.
    } finally { setZaloBusy(false); }
  };

  // Gói 49g + spec mật khẩu §3.3: tự động đăng nhập lại từ phiên đã lưu.
  // Ưu tiên token phiên; thiết bị cũ còn giữ cặp SĐT + mã thì đổi sang
  // token một lần qua code-login; cặp không còn hiệu lực (đã đặt mật khẩu
  // hoặc mã IMP) thì về trạng thái chưa đăng nhập.
  useEffect(() => {
    const boot = async () => {
      if (getSession()?.token) {
        const c = await loadMe(true);
        if (c) { setPhone(c.phone); return; }
        clearSession();
      }
      const p = getProfile();
      if (p?.phone && p?.member_code) {
        setPhone(p.phone);
        const r = await api.codeLogin({ phone: p.phone, member_code: p.member_code });
        if (r.success && r.data?.session_token) {
          setSession({ token: r.data.session_token, expires_at: r.data.session_expires_at || null });
          const c = await loadMe(true);
          if (c) return;
        }
        setProfile(null);
      }
    };
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    try { await api.sessionLogout(); } catch { /* thu hồi best-effort */ }
    clearSession();
    setProfile(null);
    setCustomer(null);
    setPhone('');
    setPassword('');
    setEmail('');
    setWelcome(null);
    setRotatedNotice('');
    setZaloB3(false);
    setZaloDiag('');
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
          {/* Spec đăng ký Zalo B §2: thẻ đăng ký mới, trên cùng */}
          {!zaloB3 ? (
            <div style={{ margin: '-30px 16px 12px', position: 'relative', zIndex: 2, background: '#fff', border: '1px solid #e3e8f2', borderRadius: 16, padding: 16, boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
              {/* Bố cục gốc: card đầu tiên của trang ĐÈ lên cạnh dưới banner 30px — đồng nhất thẻ chào mừng/thẻ thành viên ở trạng thái đã đăng nhập */}
              <div style={{ fontSize: 16, fontWeight: 800, color: '#24305E' }}>Bạn mới tới Daybreak?</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 4, lineHeight: 1.5 }}>Đăng ký thành viên bằng Zalo để tích điểm và nhận ưu đãi — không cần nhớ mã, không cần OTP.</div>
              <div style={{ marginTop: 12 }}>
                <ConsentCheck checked={agreeND13} onChange={setAgreeND13} />
              </div>
              <button className="zm-btn-primary" onClick={handleZaloRegister} disabled={!agreeND13 || zaloBusy}
                style={{ marginTop: 12, minHeight: 48, background: !agreeND13 ? '#c3cadb' : '#0068FF' }}>
                {zaloBusy ? 'Đang xử lý...' : 'Đăng ký / Đăng nhập bằng Zalo'}
              </button>
              {!agreeND13 && (
                <div style={{ fontSize: 12.5, color: '#888', marginTop: 8 }}>Tích ô đồng ý ở trên để bật nút đăng ký.</div>
              )}
            </div>
          ) : (
            /* Spec đăng ký Zalo B §2.2 (B3): từ chối quyền SĐT → không tạo tài khoản */
            <div style={{ margin: '-30px 16px 12px', position: 'relative', zIndex: 2, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 16, padding: 16, boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#9A3412' }}>Cần số điện thoại đã xác thực</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 6, lineHeight: 1.5 }}>Daybreak cần số điện thoại đã xác thực từ Zalo để tạo tài khoản thành viên cho bạn. Không có dữ liệu nào được tạo từ lần thử vừa rồi.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="zm-btn-primary" onClick={() => { setZaloB3(false); handleZaloRegister(); }} disabled={zaloBusy} style={{ flex: 1, minHeight: 44 }}>Thử lại</button>
                <button className="zm-btn-outline" onClick={() => nav('/')} style={{ flex: 1, minHeight: 44 }}>Tiếp tục đặt món vãng lai</button>
              </div>
            </div>
          )}
          <div style={{ textAlign: 'center', fontSize: 12.5, color: '#888', margin: '0 16px 12px' }}>— đã có thẻ thành viên —</div>
          {/* Spec đăng nhập SĐT + mật khẩu §5.4: form phụ SĐT + mật khẩu. */}
          <div className="zm-search" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
            <input placeholder="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            {phone && !validPhone(phone) && (
              <div style={{ fontSize: 12, color: '#b91c1c' }}>Số điện thoại cần bắt đầu bằng 0 và đủ 10 số.</div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input placeholder="Mật khẩu" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                style={{ minWidth: 44, minHeight: 44, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 13, color: '#24305E' }}>{showPw ? 'Ẩn' : 'Hiện'}</button>
            </div>
            <button className="zm-btn-primary" onClick={lookup} disabled={loading}>
              {loading ? '...' : 'Đăng nhập'}
            </button>
          </div>
          <div className="zm-note" style={{ margin: '0 16px' }}>
            Đăng nhập bằng SĐT + mật khẩu để xem điểm, hạng và lịch sử đơn hàng.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '8px 16px 0' }}>
            <button type="button" onClick={() => openPwSheet('zalo-set')} style={{ background: 'none', border: 0, color: '#0d6efd', fontSize: 13, textAlign: 'left', padding: '6px 0', cursor: 'pointer' }}>Đặt mật khẩu lần đầu bằng Zalo</button>
            <button type="button" onClick={() => openPwSheet('zalo-set')} style={{ background: 'none', border: 0, color: '#0d6efd', fontSize: 13, textAlign: 'left', padding: '6px 0', cursor: 'pointer' }}>Quên mật khẩu? Đặt lại bằng Zalo</button>
            <button type="button" onClick={() => openPwSheet('counter-set')} style={{ background: 'none', border: 0, color: '#0d6efd', fontSize: 13, textAlign: 'left', padding: '6px 0', cursor: 'pointer' }}>Đặt mật khẩu tại quầy</button>
          </div>
          <div className="zm-note" style={{ margin: '8px 16px 0' }}>
            Bạn vẫn xem thực đơn và đặt món được mà không cần tài khoản.
          </div>
        </>
      )}

      {/* Spec đăng ký Zalo B §4: màn chào mừng — chỉ lần đăng ký này, các lần mở sau vào thẳng như thường */}
      {customer && welcome && (
        <div style={{ padding: '4px 16px', marginTop: -30, position: 'relative', zIndex: 2 }}>
          <div style={{ background: '#fff', border: '1px solid #e3e8f2', borderRadius: 16, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#24305E' }}>Chào mừng bạn tới Daybreak! 🎉</div>
            <div style={{ fontSize: 13, color: '#555', marginTop: 6 }}>Tài khoản thành viên của bạn đã được tạo.</div>
            <div style={{ marginTop: 14, background: 'linear-gradient(135deg, var(--zm-primary), color-mix(in srgb, var(--zm-primary) 70%, #000))', borderRadius: 12, padding: 16, color: '#fff' }}>
              <div style={{ fontSize: 12, opacity: .85 }}>Thẻ thành viên</div>
              <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0' }}>{welcome.name}</div>
              <div style={{ fontSize: 13 }}>{welcome.phone ? welcome.phone.replace(/(\d{3})\d+(\d{2})$/, '$1****$2') : ''} · Hạng {welcome.loyalty?.tier_name || welcome.tier || 'Regular'} · 0 điểm</div>
            </div>
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#888' }}>MÃ THÀNH VIÊN của bạn</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#24305E', letterSpacing: 1 }}>{welcome.member_code}</div>
              <div style={{ fontSize: 12.5, color: '#555', marginTop: 4 }}>Đây là MÃ THÀNH VIÊN của bạn — dùng để định danh và tra cứu khi cần. Đăng nhập trên thiết bị khác bằng Zalo hoặc mật khẩu.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="zm-btn-primary" onClick={() => nav('/game')} style={{ flex: 1, minHeight: 44 }}>Chơi Hứng Trân Châu</button>
              <button className="zm-btn-outline" onClick={() => nav('/coupons')} style={{ flex: 1, minHeight: 44 }}>Xem ưu đãi của tôi</button>
            </div>
            <button onClick={() => setWelcome(null)} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 0, color: '#888', fontSize: 13 }}>Để sau</button>
          </div>
        </div>
      )}

      {customer && !welcome && (
        <div style={{ padding: '4px 16px', marginTop: -30, position: 'relative', zIndex: 2 }}>
          {/* Spec đăng ký Zalo B §4: mã IMP vừa xoay → thông báo mã mới, không chặn thao tác khác */}
          {rotatedNotice && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '10px 12px', fontSize: 13, color: '#9A3412', marginBottom: 12 }}>
              Mã thành viên của bạn đã được cấp mới: <b>{rotatedNotice}</b> — hãy dùng mã này từ nay.
            </div>
          )}
          <div style={{ background: 'linear-gradient(135deg, var(--zm-primary), color-mix(in srgb, var(--zm-primary) 70%, #000))', borderRadius: 16, padding: 20, color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,.15)' }}>
            <div style={{ fontSize: 13, opacity: .85 }}>Thẻ thành viên</div>
            <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0' }}>{customer.name}</div>
            <div style={{ fontSize: 13 }}>{customer.member_code} · Hạng {customer.loyalty?.tier_name || customer.tier || 'Regular'}</div>
            {/* Điểm chia 2 cột (Đại Vương chốt 2026-11-09): trái = Điểm khả
                dụng (tổng dùng được, gồm cả điểm sắp hết hạn); phải = Điểm
                sắp hết hạn — TỔNG điểm sẽ hết hạn trong 30 ngày tới (server
                tính từ các lô, cửa sổ theo cấu hình points_expiry_warn_days
                mặc định 30 — 1 con số tổng, không chi tiết lô). */}
            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(customer.loyalty?.points ?? customer.points)}</div><div style={{ fontSize: 11, opacity: .85 }}>Điểm khả dụng</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: '#F5A623' }}>{fmt(customer.loyalty?.points_expiring_soon ?? 0)}</div><div style={{ fontSize: 11, opacity: .85 }}>Điểm sắp hết hạn</div></div>
            </div>
            {/* Phương án A (2026-10-21): dòng quy đổi điểm chuyển xuống đầu Cửa hàng điểm — thẻ chỉ còn "tôi là ai, tôi có bao nhiêu điểm" */}
          </div>

          {/* Loyalty 2.0 + Phương án A: dải trạng thái → tiến trình → Cửa hàng điểm →
              [children: PromoCarousel + hành động nhanh] → bảng lợi ích → lịch sử điểm */}
          <LoyaltyBlocks customer={customer} onChanged={() => { loadMe(true); }}>
          <PromoCarousel />

          {/* Gói 53: quét QR tích điểm tại quầy — Gói Mini App 2026-10-30: chỉ
              hiện khi Admin bật công tắc (mặc định ẩn); tính năng claim giữ nguyên */}
          {qrClaimEntry && (
            <button
              onClick={() => nav('/scan')}
              className="zm-btn-primary"
              style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <ZmIcon name="camera" size={16} />Quét QR tích điểm tại quầy
            </button>
          )}

          {/* SPEC-02: lối vào Ví ưu đãi + Mời bạn (trước đây trang /coupons, /invite tồn tại nhưng không có link từ Tài khoản) */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button
              onClick={() => nav('/coupons')}
              style={{
                flex: 1, background: '#fff', border: '1.5px solid #FED7AA', borderRadius: 12,
                padding: '14px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}
            >
              {/* Icon chốt phương án 1 (Đại Vương 2026-11-09, theo demo BA):
                  phiếu coupon răng cưa + dấu % — thay emoji vé 🎫. Chỉ thay
                  icon; khung thẻ/chữ/badge giữ nguyên. */}
              <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true"><path d="M6 14a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v6a5 5 0 0 0 0 10v6a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-6a5 5 0 0 0 0-10v-6z" fill="#F5A623"/><path d="M29 12v24" stroke="#fff" strokeWidth="2.4" strokeDasharray="3.5 3.5"/><text x="17.5" y="31" fontSize="17" fontWeight="800" fill="#fff" textAnchor="middle">%</text></svg>
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
          <Collapsible icon={<ZmIcon name="book" size={20} />} title="Sổ địa chỉ" badge={addrBook.length > 0 ? `${addrBook.length}` : null}>
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
          <Collapsible icon={<ZmIcon name="lock" size={20} />} title="Quản lý quyền">
            <PermissionManager />
          </Collapsible>

          {/* Spec đăng nhập SĐT + mật khẩu §5.1(a)/§7.3: mục bảo mật — trạng
              thái mật khẩu + đặt/đổi mật khẩu + email tự nguyện. */}
          <Collapsible icon={<ZmIcon name="shield" size={20} />} title="Mật khẩu đăng nhập" badge={customer.has_password ? 'Đã đặt' : 'Chưa đặt'}>
            <div style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>
              {customer.has_password
                ? 'Tài khoản của bạn đã có mật khẩu — đăng nhập trên thiết bị khác bằng SĐT + mật khẩu.'
                : 'Bạn chưa đặt mật khẩu — đăng nhập trên thiết bị khác hiện dùng Zalo.'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {customer.has_password ? (
                <button className="zm-btn-outline" onClick={() => openPwSheet('change')} style={{ flex: 1, minHeight: 44 }}>Đổi mật khẩu</button>
              ) : (
                <button className="zm-btn-primary" onClick={() => openPwSheet('set')} style={{ flex: 1, minHeight: 44 }}>Đặt mật khẩu</button>
              )}
            </div>
            {customer.has_password && (
              <div style={{ fontSize: 12.5, color: '#888', marginTop: 8 }}>Quên mật khẩu hiện tại? Đăng xuất và chọn “Đặt lại bằng Zalo”.</div>
            )}
            <div style={{ borderTop: '1px solid #f5f5f5', marginTop: 14, paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#24305E' }}>Email (không bắt buộc)</div>
              <div style={{ fontSize: 12.5, color: '#888', marginTop: 2, lineHeight: 1.5 }}>Không bắt buộc — chỉ dùng cho thông báo bảo mật và hỗ trợ khôi phục tài khoản, không dùng cho quảng cáo.</div>
              {/* Vá UX 2026-11-07: hàng nhập email mang class zm-search như hàng
                  mật khẩu ở form đăng nhập phụ — input mới nhận được kiểu dáng
                  chuẩn (.zm-search input: viền · radius 12 · padding · cỡ chữ).
                  Trước đây div thường không có class tổ tiên → input trần sụp
                  thành 1 vạch. margin của .zm-search (gutter trang 12/16) được
                  trung hòa bằng longhand inline để hàng giữ đúng vị trí trong thẻ. */}
              <div className="zm-search" style={{ display: 'flex', gap: 8, marginTop: 8, marginLeft: 0, marginRight: 0, marginBottom: 0, alignItems: 'stretch' }}>
                <input placeholder="Email của bạn" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailMsg(''); }} style={{ flex: 1, minWidth: 0 }} />
                {/* Vá delta §BK 2026-11-07: .zm-btn-outline mang width: 100% (index.css)
                    → trong hàng flex, width 100% thành flex-basis của nút, bóp
                    input còn ~30px. Ghi đè đúng mẫu nhà (lỗi ô coupon Checkout):
                    width auto + không co (flexShrink 0). */}
                <button className="zm-btn-outline" onClick={saveEmail} style={{ width: 'auto', flexShrink: 0, minHeight: 44, padding: '0 14px' }}>Lưu</button>
              </div>
              {emailMsg && <div style={{ fontSize: 12.5, color: '#16a34a', marginTop: 6 }}>{emailMsg}</div>}
            </div>
          </Collapsible>

          <div className="zm-section-title" style={{ padding: '16px 0 8px' }}>Đơn gần đây</div>
          {customer.orders.length === 0 && <div className="zm-empty" style={{ padding: 20 }}>Chưa có đơn nào.</div>}
          {customer.orders.map((o) => (
            <div key={o.id} className="zm-total-row"
              onClick={() => nav(`/track?code=${encodeURIComponent(o.code)}`)}
              style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
              {/* Lát 3d (2026-11-04): trước đây in nguyên mã trạng thái tiếng Anh
                  (processing/pending…) — nay dịch sang nhãn tiếng Việt, ưu tiên
                  trạng thái thanh toán khi đơn còn chờ tiền/đã báo CK. */}
              <span><b>{o.code}</b><br /><span style={{ fontSize: 12, color: '#888' }}>{fmtDate(o.created_at)} · {
                o.status === 'cancelled' ? 'Đã hủy'
                : o.payment_status === 'transfer_notified' ? 'Đã báo chuyển khoản — chờ quán xác nhận'
                : (o.status === 'pending' && ['pending', 'pending_payment'].includes(o.payment_status)) ? 'Chờ thanh toán'
                : ({ pending: 'Đã đặt đơn', confirmed: 'Quán đã xác nhận', processing: 'Quán đang chuẩn bị', ready: 'Món đã sẵn sàng', completed: 'Hoàn thành' }[o.status] || 'Đang xử lý')
              }</span></span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{fmt(o.total_amount)}đ</b>
                <span style={{ color: '#0d6efd', fontSize: 16 }}>›</span>
              </span>
            </div>
          ))}
          <button className="zm-btn-outline" style={{ margin: '20px 0 8px' }} onClick={logout}>Đăng xuất</button>
        </div>
      )}

      {/* Spec đăng nhập SĐT + mật khẩu §5.1–§5.3: sheet đặt/đổi mật khẩu. */}
      {pwSheet && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setPwSheet(null)}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: 20, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#24305E' }}>
              {pwSheet === 'set' ? 'Đặt mật khẩu đăng nhập'
                : pwSheet === 'change' ? 'Đổi mật khẩu'
                : pwSheet === 'zalo-set' ? 'Đặt mật khẩu bằng Zalo'
                : 'Đặt mật khẩu tại quầy'}
            </div>
            {pwSheet === 'zalo-set' && (
              <div style={{ fontSize: 13, color: '#555', marginTop: 6, lineHeight: 1.5 }}>Nhập mật khẩu mới trước, rồi bấm xác thực — Zalo sẽ xác nhận đây đúng là số điện thoại của bạn.</div>
            )}
            {pwSheet === 'counter-set' && (
              <div style={{ fontSize: 13, color: '#555', marginTop: 6, lineHeight: 1.5 }}>Nhân viên đã mở cửa sổ hỗ trợ tại quầy (15 phút). Nhập SĐT của tài khoản và mật khẩu mới trên máy của bạn.</div>
            )}
            {/* Vá gốc họ lỗi ô email (2026-11-07): trước đây các ô trong sheet
                nằm TRẦN ngoài khung field chuẩn → webview render bóp dẹt mất
                chiều cao. Nay mọi ô đều bọc .zm-field như form chuẩn của app. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              {pwSheet === 'change' && (
                <div className="zm-field" style={{ marginBottom: 0 }}><input placeholder="Mật khẩu hiện tại" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} /></div>
              )}
              {pwSheet === 'counter-set' && (
                <div className="zm-field" style={{ marginBottom: 0 }}><input placeholder="Số điện thoại của tài khoản" value={pwPhone} onChange={(e) => setPwPhone(e.target.value)} inputMode="tel" /></div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <div className="zm-field" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}><input placeholder="Mật khẩu mới" type={showPwNew ? 'text' : 'password'} value={pwNew} onChange={(e) => setPwNew(e.target.value)} /></div>
                <button type="button" onClick={() => setShowPwNew(!showPwNew)} style={{ minWidth: 44, minHeight: 44, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 13, color: '#24305E' }}>{showPwNew ? 'Ẩn' : 'Hiện'}</button>
              </div>
              <div className="zm-field" style={{ marginBottom: 0 }}><input placeholder="Nhập lại mật khẩu mới" type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} /></div>
            </div>
            <div style={{ fontSize: 12.5, color: '#888', marginTop: 10, lineHeight: 1.5 }}>Mật khẩu tối thiểu 8 ký tự, có chữ in hoa và ký tự đặc biệt, không trùng SĐT, không chứa chuỗi liên tiếp (1234, abcd, qwer).</div>
            {pwErrs.length > 0 && (
              <div style={{ marginTop: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#991b1b' }}>
                {pwErrs.map((m, i) => (<div key={i}>• {m}</div>))}
              </div>
            )}
            <button className="zm-btn-primary" onClick={submitPwSheet} disabled={pwBusy} style={{ marginTop: 14, minHeight: 48 }}>
              {pwBusy ? 'Đang xử lý...' : pwSheet === 'zalo-set' ? 'Xác thực Zalo và đặt mật khẩu' : pwSheet === 'change' ? 'Đổi mật khẩu' : 'Đặt mật khẩu'}
            </button>
            <button onClick={() => setPwSheet(null)} style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 0, color: '#888', fontSize: 13 }}>Hủy</button>
          </div>
        </div>
      )}
      <TabBar />
    </div>
  );
}
