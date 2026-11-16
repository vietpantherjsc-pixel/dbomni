import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, fmt, priceOf, getMyGroups, saveMyGroup, getRef, setRef, getProfile, setProfile } from '../api';
import { storage } from '../utils/storage';
import { findPlaceByName } from '../utils/placeName'; // Sổ #69: khớp tên tỉnh/phường có chuẩn hóa
import { useShop } from '../store';
import ProductSheet from '../components/ProductSheet';
import SearchSelect from '../components/SearchSelect';
import ZmIcon, { CouponIcon } from '../components/ZmIcon';
import { TabBar } from './Home';
import { geocodeLadder, haversineKm, calcShipFee } from '../utils/geo';
import { openStatus, nextOpenSlot, timeSlots, isWithinOpening } from '../utils/openingHours';
import { DateField, TimeField, toApiDate, validTime, formatPhone, validPhone } from '../utils/checkoutFields.jsx';
import ConsentCheck from '../components/ConsentCheck'; // Spec mật khẩu §5.4 (Q3): ô đồng ý dùng chung với Checkout đơn thường
import PromoPanel, { EMPTY_PROMO_RES } from '../components/PromoPanel'; // Spec panel Ưu đãi (2026-11-14): panel chọn ưu đãi dùng chung với Checkout đơn thường
import { openCheckout } from '../utils/checkoutSdk'; // Gói Checkout SDK — Đ4 (2026-11-10): trưởng nhóm thanh toán qua SDK như đơn thường

// Gói 9 (2026-10-05): Đặt đơn nhóm.
// - Trưởng nhóm tạo link -> share; mọi người vào link, nhập tên, chọn món.
// - Trùng món (cùng tùy chọn) -> tự gộp dòng, tên người đặt nối vào ghi chú.
// - Trưởng nhóm xem tổng + chốt đơn như đơn bình thường.

// ---- Tạo nhóm mới ----
export function CreateGroup() {
  const { branch } = useShop();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => { if (!branch) nav('/branches'); }, [branch]);
  if (!branch) return null;

  const create = async () => {
    if (!name.trim()) { alert('Nhập tên của bạn (trưởng nhóm).'); return; }
    setBusy(true);
    try {
      const g = await api.groupCreate({ branch_id: branch.id, leader_name: name.trim() });
      saveMyGroup(g.code, { role: 'leader', name: name.trim() });
      nav(`/group/${g.code}`);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Đặt đơn nhóm</h1></div>
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ color: '#24305E', display: 'flex', justifyContent: 'center' }}><ZmIcon name="users" size={56} /></div>
        <h2 style={{ fontSize: 18, margin: '12px 0 8px' }}>Tạo nhóm đặt chung</h2>
        <p style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
          Bạn sẽ nhận 1 link để gửi cho bạn bè.<br />
          Mỗi người vào link, nhập tên và chọn món của mình.<br />
          Món trùng nhau tự gộp lại, tên người đặt ghi vào ghi chú.
        </p>
        <div className="zm-field" style={{ textAlign: 'left', marginTop: 20 }}>
          <label>Tên của bạn (trưởng nhóm) *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: An" />
        </div>
        <button className="zm-btn-primary" disabled={busy} onClick={create}>
          {busy ? 'Đang tạo...' : 'Tạo link đơn nhóm'}
        </button>
      </div>
      <TabBar />
    </div>
  );
}

// ---- Phòng đơn nhóm ----
export default function GroupRoom() {
  const { code } = useParams();
  const upper = (code || '').toUpperCase();
  const nav = useNavigate();
  const { branch } = useShop();
  const [group, setGroup] = useState(null);
  const [me, setMe] = useState(() => getMyGroups()[upper] || null);
  const [joinName, setJoinName] = useState('');
  const [tab, setTab] = useState('menu'); // menu | summary | checkout
  const [menu, setMenu] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const g = await api.groupGet(upper);
      setGroup(g);
      setErr('');
    } catch (e) { setErr(e.message); }
  }, [upper]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Lát 3h (2026-11-04): vòng tự làm mới chạy ở CẢ tab Chọn món — trước đây
    // chỉ chạy ở tab Tổng đơn nên món thành viên khác vừa thêm không hiện khi
    // đang ở tab Chọn món (phần còn lại của #40). Tab Thanh toán giữ nguyên
    // không poll để khỏi xáo trộn biểu mẫu đang chốt.
    if (tab === 'checkout') return;
    const t = setInterval(load, 15000); // tự refresh dữ liệu nhóm mỗi 15s
    return () => clearInterval(t);
  }, [tab, load]);
  useEffect(() => {
    // Gói 25: lọc menu theo CN của nhóm (ưu tiên) rồi mới tới CN khách đang chọn
    const bid = group?.branch?.id || group?.branch_id || branch?.id;
    api.menu(bid).then(setMenu).catch(() => {});
  }, [group, branch]);

  if (err) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Đơn nhóm</h1></div>
        <div className="zm-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><ZmIcon name="alert" size={20} />{err}</div>
        <TabBar />
      </div>
    );
  }
  if (!group) return <div className="zm-page"><div className="zm-empty">Đang tải nhóm...</div></div>;

  // Chưa nhập tên -> form tham gia
  if (!me) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Đơn nhóm</h1></div>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: '#24305E', display: 'flex', justifyContent: 'center' }}><ZmIcon name="utensils" size={56} /></div>
          <h2 style={{ fontSize: 18, margin: '12px 0 4px' }}>{group.branch?.name}</h2>
          <p style={{ fontSize: 13, color: '#888' }}>Nhóm của <b>{group.leader_name}</b> · {group.member_count} người đã chọn món</p>
          <div className="zm-field" style={{ textAlign: 'left', marginTop: 20 }}>
            <label>Tên của bạn *</label>
            <input value={joinName} onChange={(e) => setJoinName(e.target.value)} placeholder="VD: Bình" />
          </div>
          <button className="zm-btn-primary" onClick={() => {
            if (!joinName.trim()) { alert('Nhập tên để tham gia.'); return; }
            saveMyGroup(upper, { role: 'member', name: joinName.trim() });
            setMe({ role: 'member', name: joinName.trim() });
          }}>
            Vào chọn món
          </button>
        </div>
        <TabBar />
      </div>
    );
  }

  const isLeader = me.role === 'leader';
  const img = (p) => p.image_url || '/default-product.svg';

  const addToGroup = async (line) => {
    try {
      await api.groupAddItem(upper, {
        member_name: me.name,
        product_id: line.product.id,
        option_ids: line.optionIds || [],
        quantity: line.qty,
        note: line.note || null,
      });
      load();
    } catch (e) { alert(e.message); }
  };

  const chQty = async (id, delta, cur) => {
    const next = cur + delta;
    try {
      if (next <= 0) await api.groupRemoveItem(upper, id);
      else await api.groupUpdateItem(upper, id, { quantity: next });
      load();
    } catch (e) { alert(e.message); }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/group/${upper}`;
    try { await navigator.clipboard.writeText(url); alert('Đã copy link đơn nhóm! Gửi cho bạn bè cùng đặt.'); }
    catch (e) { prompt('Copy link:', url); }
  };

  const canEdit = (line) => isLeader || (line.member_names || []).includes(me.name);

  return (
    <div className="zm-page">
      <div className="zm-header">
        <button className="zm-back" onClick={() => nav('/')}>←</button>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="users" size={18} />Đơn nhóm · {upper}</h1>
      </div>

      <div className="zm-group-bar">
        <div>
          <div style={{ fontWeight: 800 }}>{group.branch?.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {isLeader ? 'Bạn là trưởng nhóm' : `Bạn là ${me.name}`} · {group.member_count} người · {group.total_qty} món
          </div>
        </div>
        <button className="zm-btn-outline" style={{ width: 'auto', padding: '8px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={copyLink}>
          <ZmIcon name="copy" size={14} />Copy link
        </button>
      </div>

      {/* Spec đơn nhóm đồng bộ (2026-10-21): nhóm đã chốt — MỌI thành viên thấy mã đơn + nút Theo dõi */}
      {group.status === 'ordered' && group.order_code && (
        <div style={{ margin: '12px 16px 0', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ZmIcon name="checkCircle" size={14} />Đơn nhóm đã được chốt — mã đơn <b>{group.order_code}</b>
          </div>
          <button className="zm-btn-primary" style={{ marginTop: 10 }}
            onClick={() => nav(`/track?code=${encodeURIComponent(group.order_code)}`)}>
            Theo dõi đơn {group.order_code}
          </button>
        </div>
      )}

      {tab !== 'checkout' && (
        <div className="zm-seg" style={{ margin: '12px 16px 0' }}>
          <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}><ZmIcon name="utensils" size={15} />Chọn món</button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => { setTab('summary'); load(); }}>
            <ZmIcon name="receipt" size={15} />Tổng đơn ({group.total_qty})
          </button>
        </div>
      )}

      {tab === 'menu' && (
        <div style={{ paddingBottom: 16 }}>
          {menu.map((cat) => (
            <div key={cat.id}>
              <div className="zm-cat-title">{cat.name}</div>
              {(cat.products || []).map((p) => (
                <div key={p.id} className="zm-row-item" onClick={() => setSheet(p)}>
                  <img src={img(p)} alt={p.name} loading="lazy" />
                  <div className="zm-row-info">
                    <div className="zm-row-name">{p.name}</div>
                    <div className="zm-row-price">{fmt(priceOf(p))}đ</div>
                  </div>
                  <button className="zm-add-btn" onClick={(e) => { e.stopPropagation(); setSheet(p); }}>+</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'summary' && (
        <div style={{ padding: '8px 16px 16px' }}>
          {group.items.length === 0 && <div className="zm-empty">Chưa ai chọn món nào. Qua tab "Chọn món" nhé!</div>}
          {group.items.map((it) => (
            <div key={it.id} className="zm-group-line">
              <img src={it.image_url || '/default-product.svg'} alt={it.product_name} />
              <div className="zm-row-info">
                <div className="zm-row-name">{it.product_name}</div>
                {it.option_names?.length > 0 && <div className="zm-row-desc">{it.option_names.join(', ')}</div>}
                <div className="zm-group-names" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="user" size={12} />{(it.member_names || []).join(', ')}</div>
                {it.note && <div className="zm-row-desc"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="note" size={12} />{it.note}</span></div>}
                <div className="zm-row-price">{fmt(it.unit_price)}đ</div>
              </div>
              {canEdit(it) ? (
                <div className="zm-qty-sm">
                  <button onClick={() => chQty(it.id, -1, it.quantity)}>−</button>
                  <span>{it.quantity}</span>
                  <button onClick={() => chQty(it.id, 1, it.quantity)}>+</button>
                </div>
              ) : (
                <div style={{ fontWeight: 800 }}>×{it.quantity}</div>
              )}
            </div>
          ))}
          {group.items.length > 0 && (
            <>
              <div className="zm-total-row grand" style={{ marginTop: 12 }}>
                <span>Tạm tính ({group.total_qty} món)</span><span>{fmt(group.subtotal)}đ</span>
              </div>
              {group.status === 'ordered' ? (
                <div className="zm-note" style={{ marginTop: 12 }}>
                  Đơn nhóm đã chốt xong (mã đơn <b>{group.order_code || ''}</b>) — bấm "Theo dõi đơn" ở phía trên để xem trạng thái.
                </div>
              ) : isLeader ? (
                <button className="zm-btn-primary" style={{ marginTop: 12 }} onClick={() => setTab('checkout')}>
                  Tiến hành đặt hàng · {fmt(group.subtotal)}đ
                </button>
              ) : (
                <div className="zm-note" style={{ marginTop: 12 }}>
                  Trưởng nhóm <b>{group.leader_name}</b> sẽ chốt đơn khi mọi người chọn xong.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'checkout' && isLeader && group.status === 'open' && (
        <GroupCheckout group={group} onDone={(order) => {
          // Spec QR 2026-10-21: đơn nhóm BANK → màn "Chờ thanh toán" như đơn thường
          if (order?.pay_channel === 'BANK') {
            nav(`/pay-wait/${order.code}`, {
              state: {
                transfer: {
                  bank_info: order.bank_info, transfer_content: order.transfer_content,
                  amount: Math.round(Number(order.total_amount) || 0),
                },
              },
            });
          } else {
            nav(`/success/${order.code}`);
          }
        }} onBack={() => setTab('summary')} />
      )}

      {sheet && (
        <ProductSheet
          product={sheet}
          onClose={() => setSheet(null)}
          onAdd={addToGroup}
          addLabel="Thêm vào đơn nhóm"
        />
      )}
      <TabBar />
    </div>
  );
}

// ---- Trưởng nhóm chốt đơn ----
// Spec đơn nhóm đồng bộ (2026-10-21): GroupCheckout dùng CÙNG form/mẫu với Checkout
// đơn thường (helper chung utils/checkoutFields + utils/openingHours):
// - Đủ 3 hình thức: Giao hàng (ngay / hẹn giờ giao) · Mang đi · Hẹn tới lấy; quán đóng ép hẹn giờ.
// - Địa chỉ: popup cấu trúc tỉnh/phường/số nhà + sổ địa chỉ của trưởng nhóm —
//   spec đồng bộ luồng nhóm (2026-11-13): tra tọa độ BẬC THANG qua backend
//   như đơn thường (geocodeLadder), điểm khóa theo phiên bản dòng chữ; tra
//   rỗng cả thang → khối lỗi đúng câu đơn thường + nút Tính lại phí, khóa
//   nút chốt tới khi có điểm (không còn GPS/tra ngược/lời hứa cũ).
// - PTTT tải động (api.payMethods) + kênh SDK theo cấu hình (zaloCfg như
//   đơn thường), panel Ưu đãi hợp nhất + coupon ví của trưởng nhóm, ô
//   voucher, điểm của trưởng nhóm, client_key chống trùng, lưu customer
//   vào profile.
const loadProvinces = () => api.provinces().catch(() => []);
const loadWards = (code) => api.wards(code).catch(() => []);

function GroupCheckout({ group, onDone, onBack }) {
  const { branch } = useShop();
  // Audit 2026-10-21 🟠14: phí ship/giờ hẹn/địa chỉ lấy theo CHI NHÁNH CỦA NHÓM
  // (group.branch — backend serialize đã kèm tọa độ + giờ mở cửa), KHÔNG mượn chi
  // nhánh đang chọn trong máy trưởng nhóm như trước (trưởng nhóm đổi CN sau khi tạo
  // nhóm là báo giá sai CN, thậm chí chặn giao hàng oan). Fallback về branch đang
  // chọn chỉ khi dữ liệu nhóm cũ thiếu thông tin chi nhánh.
  const b = (group?.branch?.id ? group.branch : branch) || {};
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('delivery'); // delivery | takeaway | scheduled (hẹn tới lấy)
  const [deliveryMode, setDeliveryMode] = useState('now'); // now | scheduled (hẹn giờ giao)
  const [provinces, setProvinces] = useState([]);
  const [province, setProvince] = useState('');
  const [wards, setWards] = useState([]);
  const [ward, setWard] = useState('');
  const [street, setStreet] = useState('');
  const [km, setKm] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [shipCfg, setShipCfg] = useState(null);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [payMethods, setPayMethods] = useState([]);
  const [payment, setPayment] = useState('transfer');
  // Spec đồng bộ luồng nhóm (2026-11-13, L6): cấu hình kênh SDK như đơn
  // thường — tải zaloCfg để ẩn BANK khi chưa sẵn sàng và hiệu chỉnh kênh
  // hiệu dụng trong place() đúng luật Checkout.
  const [zaloCfg, setZaloCfg] = useState(null);
  const [payChannel, setPayChannel] = useState('BANK'); // BANK | COD
  useEffect(() => {
    api.zaloPayConfig().then(setZaloCfg).catch(() => {});
  }, []);
  useEffect(() => {
    if (!zaloCfg) return;
    setPayChannel((cur) => {
      if (cur === 'BANK' && !zaloCfg.bank_available && zaloCfg.cod_enabled) return 'COD';
      if (cur === 'COD' && !zaloCfg.cod_enabled && zaloCfg.bank_available) return 'BANK';
      return cur;
    });
  }, [zaloCfg]);
  // Nhánh dự phòng (chưa tải được zaloCfg): đơn giao nhóm đang chọn trả
  // tại quán thì đưa về chuyển khoản — gương Checkout, giữ luật L5.
  useEffect(() => {
    if (type === 'delivery' && payment === 'pay_at_store') setPayment('transfer');
  }, [type, payment]);
  // Spec đồng bộ luồng nhóm (2026-11-13, L4) → Spec panel Ưu đãi
  // (2026-11-14): danh sách hợp nhất từ server (chế độ unified) vẫn nạp
  // tại đây; toàn bộ trạng thái chọn + panel do component dùng chung
  // PromoPanel giữ — trang chỉ nhận kết quả phân xử qua promoRes.
  const [offers, setOffers] = useState(null); // {items, stack_cap_amount}
  const [promoRes, setPromoRes] = useState(EMPTY_PROMO_RES);
  const promoRef = useRef(null); // ensureVoucher() trước khi chốt
  // Spec đồng bộ luồng nhóm (2026-11-13, L7): lỗi validate + place() hiện
  // trong trang (formErr) như Checkout — không alert() ở luồng chốt nhóm.
  const [formErr, setFormErr] = useState('');
  // Spec đồng bộ luồng nhóm (2026-11-13, L11): 2 mục thu gọn gương
  // Checkout — email tự nguyện + mã người giới thiệu nhập tay.
  const [email, setEmail] = useState('');
  const [refCode, setRefCodeState] = useState(() => getRef());
  const [refFromLink] = useState(() => !!getRef());
  const updateRefCode = (v) => { setRefCodeState(v); setRef(v); };
  const [moreInfoOpen, setMoreInfoOpen] = useState(() => !!getRef());
  const [points, setPoints] = useState(0);
  // Loyalty 2.0: gỡ đổi điểm trực tiếp ở checkout nhóm (như đơn thường)
  const [customerId, setCustomerId] = useState(null);
  // Spec mật khẩu §5.4 (bổ sung Q3): ô đồng ý NĐ 13 ở đơn nhóm — chỉ đồng ý
  // của trưởng nhóm mới có ý nghĩa (đơn đứng tên/SĐT/mã TV của trưởng nhóm).
  const [consentChecked, setConsentChecked] = useState(false);
  const [hasConsented, setHasConsented] = useState(null); // null = chưa rõ
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [addrBook, setAddrBook] = useState([]);
  const [addrId, setAddrId] = useState('');
  // Lát 3g (2026-11-04, #39): tự áp địa chỉ MẶC ĐỊNH khi sổ địa chỉ tải xong
  // (như Checkout) — chỉ khi khách chưa tự đụng vào ô chọn địa chỉ.
  const addrTouched = useRef(false);
  // Vá F-2 (gương Checkout): cờ "lần đổi tỉnh này đến từ điền địa chỉ lưu" —
  // effect theo tỉnh không được xóa ward của chính lần điền đó.
  const fillingFromBookRef = useRef(false);
  const fillFromAddress = (a) => {
    // Mỗi lần điền từ sổ là một "dòng chữ" mới: tăng phiên bản để điểm
    // của lần điền này mang đúng phiên bản đó (xem khối dropoff bên dưới).
    const ver = bumpAddrVer();
    // Sổ #69 (2026-11-04): như Checkout — khớp tên qua findPlaceByName có
    // chuẩn hóa, tránh trượt "TP. Hồ Chí Minh" vs "Thành phố Hồ Chí Minh".
    const pc = findPlaceByName(provinces, a.province)?.code;
    if (pc) {
      if (String(pc) !== String(province)) fillingFromBookRef.current = true;
      setProvince(String(pc));
      loadWards(pc).then((ws) => {
        setWards(ws || []);
        const wc = findPlaceByName(ws || [], a.ward)?.code;
        setWard(wc ? String(wc) : '');
      });
    }
    setStreet(a.street || '');
    // Spec đồng bộ luồng nhóm (2026-11-13, L3): địa chỉ lưu ĐÃ có tọa độ
    // và khách không sửa chữ → dùng luôn điểm đó tính phí, KHÔNG tra lại;
    // chưa có tọa độ → điểm trống, bậc thang tra từ dòng chữ.
    if (a.lat != null && a.lng != null && Number(a.lat) !== 0 && Number(a.lng) !== 0) {
      const pt = { lat: Number(a.lat), lng: Number(a.lng) };
      setDropoff({ ...pt, step: null, source: 'saved', ver });
      if (b.latitude && b.longitude) {
        const d = haversineKm(Number(b.latitude), Number(b.longitude), pt.lat, pt.lng);
        setKm(Math.round(d * 10) / 10);
        setGeoError(false);
      }
    } else {
      setDropoff(null);
    }
  };
  useEffect(() => {
    if (addrTouched.current || addrId || !addrBook.length) return;
    const d = addrBook.find((a) => a.is_default);
    if (d) { setAddrId(String(d.id)); fillFromAddress(d); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrBook]);
  const [saveAddr, setSaveAddr] = useState(false);
  const [addrLabel, setAddrLabel] = useState('Nhà');
  const [showAddrPop, setShowAddrPop] = useState(false);
  // Gói 50f (gương Checkout): gợi ý địa chỉ khi gõ ở ô đường
  const [suggests, setSuggests] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // Spec đồng bộ luồng nhóm (2026-11-13, L1): điểm giao của đơn nhóm =
  // điểm tra BẬC THANG từ DÒNG CHỮ CUỐI CÙNG trong form, hoặc điểm đã
  // lưu của địa chỉ trong sổ (source 'saved') — gương cơ chế Checkout:
  // dropoff mang phiên bản dòng chữ (ver); sửa BẤT KỲ trường địa chỉ nào
  // → addrVerRef tăng → điểm cũ tự hủy hiệu lực, phải tra lại.
  const [dropoff, setDropoff] = useState(null); // {lat, lng, step, source, ver}
  const addrVerRef = useRef(0);
  const bumpAddrVer = () => { addrVerRef.current += 1; return addrVerRef.current; };
  const pointValid = !!dropoff && dropoff.ver === addrVerRef.current;
  // Spec đồng bộ luồng nhóm (2026-11-13, mục 9 — L5 đóng): đơn GIAO nhóm
  // KHÔNG có kênh COD ở mọi cấu hình (khác đơn thường, nơi COD giao bật
  // theo cấu hình) — COD của nhóm chỉ có cho đơn mang về/hẹn lấy.
  const codHiddenForGroupDelivery = type === 'delivery';
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const geoTimer = useRef(null);
  const suggestTimer = useRef(null);
  // Gói geocode lai NDAMaps (spec 2026-11-13 mục 2.3 + 6): nhóm dùng
  // chung helper + endpoint gợi ý với Checkout — 1 token cho mỗi phiên
  // chọn địa chỉ, đổi token mới sau mỗi lần place thành công và khi đổi
  // chi nhánh của nhóm.
  const newSuggestSession = () => (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const suggestSessionRef = useRef(null);
  if (suggestSessionRef.current === null) suggestSessionRef.current = newSuggestSession();
  useEffect(() => { suggestSessionRef.current = newSuggestSession(); }, [b?.id]);
  // Chống trùng: client_key cố định theo phiên giỏ nhóm (đổi khi giỏ nhóm đổi)
  const newClientKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'zalo-grp-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const clientKeyRef = useRef(null);
  const groupSig = group.code + '|' + (group.items || []).map((it) => `${it.id}:${it.quantity}`).join(',') + '|' + group.subtotal;
  useEffect(() => { clientKeyRef.current = newClientKey(); }, [groupSig]);

  const st = openStatus(b && b.id ? b : null);
  const isClosed = st && !st.open;

  useEffect(() => {
    const g = getMyGroups()[group.code];
    if (g) setName(g.name);
    const p = getProfile();
    if (p) { if (!g) setName(p.name || ''); setPhone(p.phone || ''); }
    api.shipConfig().then(setShipCfg).catch(() => {});
    loadProvinces().then(setProvinces);
    api.payMethods().then((list) => {
      if (list && list.length) {
        setPayMethods(list);
        if (!list.some((m) => m.value === payment)) setPayment(list[0].value);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.code]);

  useEffect(() => {
    if (isClosed) {
      if (type === 'delivery') setDeliveryMode('scheduled');
      if (type === 'takeaway') setType('scheduled');
      const next = nextOpenSlot(b);
      if (next && !schedDate) { setSchedDate(next.date); setSchedTime(next.time); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed]);

  useEffect(() => {
    if (!province) { setWards([]); setWard(''); return; }
    // Vá F-2 (gương Checkout): lần đổi tỉnh do điền từ sổ thì lần nạp này
    // KHÔNG xóa ward (chính lần điền đó đặt ward qua loadWards riêng).
    const fromBook = fillingFromBookRef.current;
    fillingFromBookRef.current = false;
    loadWards(province)
      .then((ws) => { setWards(ws || []); if (!fromBook) setWard(''); });
  }, [province]);

  const wardName = () => (wards.find((w) => String(w.code) === String(ward)) || {}).name || '';
  const provName = () => (provinces.find((p) => String(p.code) === String(province)) || {}).name || '';
  const fullAddress = () => [street.trim(), wardName(), provName()].filter(Boolean).join(', ');

  // Spec đồng bộ luồng nhóm (2026-11-13, L1): điểm chốt của đơn nhóm =
  // kết quả tra BẬC THANG (backend geocode) từ dòng chữ CUỐI CÙNG trong
  // form — gương resolveDropoff của Checkout, với khung ưu tiên quanh
  // CHI NHÁNH CỦA NHÓM. Điểm đã lưu trong sổ (source 'saved', khách
  // không sửa chữ) dùng luôn, không tra lại. Cả thang rỗng → geoError
  // (khối lỗi đúng câu đơn thường + nút Tính lại phí), km về null.
  const resolveDropoff = async () => {
    if (!b.latitude || !b.longitude) return;
    if (dropoff && dropoff.ver === addrVerRef.current) {
      const d = haversineKm(Number(b.latitude), Number(b.longitude), dropoff.lat, dropoff.lng);
      setKm(Math.round(d * 10) / 10);
      setGeoError(false);
      return;
    }
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    const ver = addrVerRef.current;
    setGeoLoading(true); setGeoError(false);
    try {
      const g = await geocodeLadder({
        q: fullAddress() + ', Việt Nam',
        street: street.trim(), ward: wardName(), province: provName(), branch: b,
      });
      // Chữ đã đổi giữa lúc tra → kết quả thuộc về dòng chữ cũ, bỏ đi.
      if (addrVerRef.current !== ver) return;
      // Gói geocode lai NDAMaps (mục 3.2): source do backend trả —
      // 'ladder' khi trúng thang, 'ndamaps_forward' khi trúng cứu cánh
      // (vá §HP: từ vựng của cột dropoff_source, không phải tên nhà cung cấp).
      setDropoff({ lat: g.lat, lng: g.lng, step: g.ladder_step, source: g.source || 'ladder', ver });
      const d = haversineKm(Number(b.latitude), Number(b.longitude), g.lat, g.lng);
      setKm(Math.round(d * 10) / 10);
    } catch (e) {
      if (addrVerRef.current !== ver) return;
      setKm(null); setGeoError(true);
    } finally { setGeoLoading(false); }
  };

  // Gợi ý khi gõ (gương Checkout): thiên vị quanh chi nhánh của nhóm —
  // chọn gợi ý chỉ điền chữ, điểm chốt vẫn tra bậc thang từ dòng chữ
  // cuối cùng (hiệu ứng theo street tự chạy).
  const onStreetChange = (v) => {
    setStreet(v);
    bumpAddrVer();
    clearTimeout(suggestTimer.current);
    const q = v.trim();
    if (q.length < 5) { setSuggests([]); setSuggestLoading(false); return; }
    setSuggestLoading(true);
    suggestTimer.current = setTimeout(async () => {
      try {
        // Gói geocode lai NDAMaps (mục 2.4): đáp {source, items} — dùng
        // chung endpoint với Checkout (mục 6); chấp nhận cả đáp mảng cũ
        // để khỏi gãy khi backend chưa nạp gói lai.
        const res = await api.geocodeSuggest(q, b?.latitude, b?.longitude, suggestSessionRef.current);
        setSuggests(Array.isArray(res) ? res : (res?.items || []));
      } catch { setSuggests([]); }
      finally { setSuggestLoading(false); }
    }, 500);
  };

  const pickSuggest = async (s) => {
    // Giữ số nhà khách đã gõ tay (VD "90 Tô Hiệu" → chọn gợi ý vẫn giữ "90")
    const typedNo = street.match(/^\d[\d/\-\s]*/)?.[0]?.trim();
    let newStreet = s.short || s.label.split(',')[0];
    if (typedNo && !/^\d/.test(newStreet)) {
      newStreet = `${typedNo} ${newStreet}`;
    }
    const ver = bumpAddrVer();
    setStreet(newStreet);
    setSuggests([]);
    // Gói geocode lai NDAMaps (mục 2.2 + 6): chọn gợi ý NDAMaps → chốt
    // ngay tọa độ bản ghi làm điểm giao (source 'ndamaps_place'); điểm
    // không dùng được → chỉ điền chữ, điểm chốt do đường B quyết. Chọn
    // gợi ý Nominatim → giữ hành vi cũ: chỉ điền chữ.
    if (!s.place_id) return;
    try {
      const p = await api.geocodePlace(s.place_id, suggestSessionRef.current, provName(), b?.latitude, b?.longitude);
      if (p?.lat && p?.lng) {
        if (addrVerRef.current !== ver) return;
        setDropoff({ lat: p.lat, lng: p.lng, step: null, source: 'ndamaps_place', ver });
        if (b?.latitude && b?.longitude) {
          const d = haversineKm(Number(b.latitude), Number(b.longitude), p.lat, p.lng);
          setKm(Math.round(d * 10) / 10);
          setGeoError(false);
        }
        // Phiên chọn đã chốt bằng place → đổi token mới cho phiên sau.
        suggestSessionRef.current = newSuggestSession();
      }
    } catch { /* chỉ điền chữ, không lỗi cho khách */ }
  };

  useEffect(() => {
    if (type !== 'delivery') return;
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(resolveDropoff, 800);
    return () => clearTimeout(geoTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, ward, province, type]);

  // Spec phí giao MỘT NGUỒN (2026-11-06): như đơn thường — phí hiển thị =
  // công thức nội bộ theo tọa độ điểm giao trừ phần quán hỗ trợ; không báo giá hãng.
  const shipFeeGross = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
  const shipShopSupport = type === 'delivery' && shipCfg && group.subtotal >= (Number(shipCfg.support_threshold) || 0)
    ? Math.min(Number(shipCfg.support_amount) || 0, shipFeeGross) : 0;
  const shipFee = Math.max(0, shipFeeGross - shipShopSupport);


  // KM MỌI LOẠI + điểm của trưởng nhóm: tra khách theo SĐT đã chuẩn hóa như đơn thường
  useEffect(() => {
    if (!phone || phone.length < 9) return;
    const fee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
    const t = setTimeout(() => {
      const payload = {
        subtotal: group.subtotal,
        items: (group.items || []).map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          line_total: it.unit_price * it.quantity,
          category_id: it.category_id || null,
          unit_price: it.unit_price,
        })),
        shipping_fee: fee,
        // Spec đồng bộ luồng nhóm (2026-11-13, L4): danh sách hợp nhất
        // KM + coupon ví như đơn thường (chế độ unified).
        unified: true,
      };
      // 🟠10 (phía FE): tra khách lỗi không được nuốt luôn KM — rơi về vãng lai.
      api.customerByPhone(phone, getProfile()?.member_code || '').catch(() => null).then((c) => {
        if (c) {
          setPoints(c.loyalty?.points ?? c.points ?? 0);
          setCustomerId(c.id);
          // Spec mật khẩu §5.4 (Q3): đọc has_consented từ cùng lời gọi tra KM
          // này như Checkout — chưa đồng ý thì hiện ô đồng ý ở đơn nhóm.
          setHasConsented(!!c.has_consented);
          if (c.has_consented === false) setConsentNeeded(true);
          // Spec đồng bộ luồng nhóm (L11): email hồ sơ có sẵn thì điền sẵn ô email.
          if (c.email) setEmail((prev) => prev || c.email);
          api.addresses(c.id, c.phone, c.member_code).then((r) => setAddrBook(Array.isArray(r) ? r : [])).catch(() => {}); // Sổ phụ #31: r là mảng thuần (req đã bóc phong bì)
          return api.eligiblePromotions({ ...payload, customer_id: c.id, phone: formatPhone(phone), member_code: getProfile()?.member_code || '' });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setOffers).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, group.subtotal, km, shipCfg, type]);

  // Tự nhả lựa chọn đã mất điều kiện khi danh sách hợp nhất nạp lại:
  // đã chuyển vào PromoPanel (component giữ lựa chọn).

  // ===== Phân xử hiển thị tổng: PromoPanel chạy (gương store() §5d) và
  // trả kết quả qua promoRes — TỔNG HIỂN THỊ = SỐ SERVER THU.
  const shipDiscTotal = promoRes.shipDiscTotal;
  const moneyDiscTotal = promoRes.moneyDiscTotal;
  const totalDiscTotal = promoRes.totalDiscTotal;
  // Loyalty 2.0: bỏ pointDisc — tổng nhóm không còn dòng trừ điểm.
  // Đơn nhóm giao hàng KHÔNG có phí thu hộ COD (L5 đóng) nên tổng không
  // cộng shipCodFee như đơn thường.
  const grandTotal = Math.max(0, group.subtotal + shipFee - shipDiscTotal - moneyDiscTotal);

  // Spec đồng bộ luồng nhóm (L1): cổng hiển thị của đơn giao nhóm — chưa
  // có điểm tra còn hiệu lực cho dòng chữ hiện tại → nút chốt khóa.
  const pointMissing = type === 'delivery' && !pointValid;

  // Chọn mã / validate voucher / tự nhả lựa chọn mất điều kiện: đã chuyển
  // vào PromoPanel. Đổi loại đơn → PromoPanel remount theo key={type} nên
  // lựa chọn ưu đãi tự reset.
  const switchType = (t) => {
    setType(t);
  };

  // Spec đồng bộ luồng nhóm (L7): lỗi hẹn giờ hiện formErr đúng trường —
  // validateSchedule set lỗi riêng của nó, place() không ghi đè.
  const validateSchedule = (label) => {
    const d = toApiDate(schedDate);
    if (!d) { setFormErr(`Nhập ngày ${label} (dd/mm/yyyy).`); return false; }
    if (!validTime(schedTime)) { setFormErr(`Nhập giờ ${label} (HH:MM, 24h).`); return false; }
    if (new Date(`${d}T${schedTime}`) <= new Date()) { setFormErr('Giờ hẹn phải sau thời điểm hiện tại.'); return false; }
    if (!isWithinOpening(b, schedDate, schedTime)) { setFormErr('Giờ hẹn phải trong giờ mở cửa của quán.'); return false; }
    return true;
  };

  // Kênh hiệu dụng của đơn nhóm — gương place() của đơn thường, cộng
  // luật riêng của nhóm (mục 9): đơn GIAO nhóm không bao giờ rơi về COD.
  const effChannelFor = () => {
    if (zaloCfg) {
      let ch = payChannel;
      if (ch === 'BANK' && !zaloCfg.bank_available && zaloCfg.cod_enabled) ch = 'COD';
      if (ch === 'COD' && !zaloCfg.cod_enabled && zaloCfg.bank_available) ch = 'BANK';
      if (ch === 'COD' && codHiddenForGroupDelivery) ch = 'BANK';
      return ch;
    }
    return payment === 'transfer' ? 'BANK' : 'COD';
  };

  const place = async () => {
    if (placing) return;
    setFormErr('');
    if (!name.trim() || !phone.trim()) { setFormErr('Nhập tên và số điện thoại.'); return; }
    // Luật SĐT 2026-11-07: bắt đầu bằng 0 thì phải đủ đúng 10 số.
    if (!validPhone(phone)) { setFormErr('Số điện thoại chưa đúng — cần bắt đầu bằng 0 và đủ 10 số.'); return; }
    if (type === 'delivery') {
      if (!province || !ward || !street.trim()) { setFormErr('Chọn tỉnh/thành, phường/xã và nhập số nhà, tên đường.'); return; }
      if (deliveryMode === 'scheduled' && !validateSchedule('muốn giao')) return;
    }
    if (type === 'scheduled' && !validateSchedule('muốn tới lấy')) return;
    // Spec đồng bộ luồng nhóm (L1): cổng client của luật cứng phía server
    // (422 dropoff_geocode_failed) — đơn giao chưa có điểm tra còn hiệu
    // lực cho dòng chữ hiện tại thì chặn ngay (nút chốt cũng khóa sẵn).
    if (type === 'delivery' && !pointValid) {
      setFormErr('Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.');
      setShowAddrPop(true);
      return;
    }
    // 🟠8: có mã voucher chưa validate → PromoPanel validate trước khi chốt (lỗi thì dừng, báo rõ)
    const okVoucher = await promoRef.current?.ensureVoucher();
    if (okVoucher === false) return;
    // Spec mật khẩu §5.4 (Q3): đơn nhóm đầu chưa tích ô đồng ý thì khóa nút
    // đặt đơn ngay ở client (cổng cứng thật vẫn ở server — 422 consent_required).
    if (consentNeeded && !consentChecked) {
      setFormErr('Bạn cần tích ô đồng ý cho Daybreak xử lý dữ liệu cá nhân để đặt đơn đầu tiên.');
      return;
    }
    setPlacing(true);
    try {
      // Spec phí giao MỘT NGUỒN: không còn chờ/báo giá hãng — phí chốt từ
      // tọa độ điểm giao (một nguồn) ở server.
      let scheduledAt = null;
      if (type === 'scheduled' || (type === 'delivery' && deliveryMode === 'scheduled')) {
        const d = toApiDate(schedDate);
        scheduledAt = `${d}T${schedTime}`;
      }
      // Spec đồng bộ luồng nhóm (L6): kênh hiệu dụng theo cấu hình thật —
      // payment_method gửi đi suy từ kênh SDK đã hiệu chỉnh như đơn thường.
      const effChannel = effChannelFor();
      if (zaloCfg && effChannel !== payChannel) setPayChannel(effChannel);
      const order = await api.groupCheckout(group.code, {
        client_key: clientKeyRef.current || newClientKey(),
        customer_name: name.trim(),
        customer_phone: formatPhone(phone),
        // Spec KM chống mã Phần B: mã TV của trưởng nhóm để xác thực quyền lợi trong store()
        member_code: getProfile()?.member_code || null,
        // Spec đồng bộ luồng nhóm (L11): email tự nguyện của trưởng nhóm —
        // server chỉ điền vào hồ sơ khi hồ sơ đang trống (như đơn thường).
        email: email.trim() || null,
        // Spec mật khẩu §5.4 (Q3): cờ đồng ý NĐ 13 của trưởng nhóm ở đơn đầu.
        consent_agreed: !!consentChecked,
        order_type: type === 'delivery' ? 'delivery' : 'takeaway',
        delivery_address: type === 'delivery' ? fullAddress() : null,
        province: type === 'delivery' ? provName() : null,
        ward: type === 'delivery' ? wardName() : null,
        distance_km: type === 'delivery' ? km : null,
        delivery_note: type === 'delivery' && deliveryNote.trim() ? deliveryNote.trim() : null,
        scheduled_at: scheduledAt,
        payment_method: effChannel === 'BANK' ? 'transfer' : 'pay_at_store',
        // Spec panel Ưu đãi (2026-11-14): chỉ gửi ĐÚNG những gì trưởng
        // nhóm đã chọn trong PromoPanel như đơn thường — gồm cả cặp
        // promotion_id + customer_coupon_id (server §5d đã mở cho cặp
        // KM + coupon ví, đơn nhóm hưởng qua đường ủy quyền store()).
        promotion_id: promoRes.promotion_id,
        customer_coupon_id: promoRes.customer_coupon_id,
        voucher_code: promoRes.voucher_code,
        // Loyalty 2.0: không gửi points_redeem nữa
        note: note.trim() || null,
        // Spec đồng bộ luồng nhóm (L11): mã giới thiệu nhập tay ở mục thu
        // gọn (prefill từ link mời) — server chỉ gắn khi tạo khách mới.
        referred_by: refCode.trim().toUpperCase() || null,
        delivery_package: null,
        delivery_quoted_fee: null,
        delivery_provider: null,
        delivery_dropoff_lat: type === 'delivery' ? dropoff?.lat || null : null,
        delivery_dropoff_lng: type === 'delivery' ? dropoff?.lng || null : null,
        // Gói geocode lai NDAMaps (2026-11-13 mục 3.3 + 6): nguồn điểm
        // giao của đơn nhóm — như đơn thường, qua store().
        dropoff_source: type === 'delivery' ? dropoff?.source || null : null,
      });
      // Gói Checkout SDK — Đ4: server chốt đơn nhóm đã tạo params đúng
      // hợp đồng (GroupOrderController gắn sdk_params cho BANK + COD) —
      // trưởng nhóm mở CheckoutSDK ngay tại đây như đơn thường; có
      // orderId phía SDK thì gắn về server để notify đối chiếu. SDK
      // không mở được → báo rõ theo §3, đơn giữ pending_payment chờ
      // "Thanh toán lại" (không rơi về CK tay ngoài SDK).
      let sdkFailed = false;
      if (order?.sdk_params) {
        try {
          const sdkRes = await openCheckout(order.sdk_params);
          if (sdkRes?.orderId) {
            api.linkSdkOrder(order.code, sdkRes.orderId).catch((e) => console.warn('Gắn mã đơn SDK lỗi:', e));
          }
        } catch (sdkErr) {
          console.warn('Không mở được Checkout SDK (đơn nhóm):', sdkErr);
          // Gói vá sau vòng S — Mục 2 (2026-11-12): nối chi tiết lỗi gốc
          // (chặng/name/message từ checkoutSdk) thay vì nuốt êm như trước.
          // Spec đồng bộ luồng nhóm (L7): báo trong trang (formErr) thay
          // alert() — dừng ít giây cho trưởng nhóm đọc rồi mới chuyển màn
          // như Checkout, thay cho hộp thoại chặn của alert cũ.
          sdkFailed = true;
          setFormErr('Không mở được trang thanh toán của Zalo. Đơn của bạn đã được lưu — bạn có thể thanh toán lại trong mục Đơn hàng.' + (sdkErr?.message ? ` [${sdkErr.message}]` : ''));
        }
      }
      // Lưu định danh trưởng nhóm + mã đơn gần nhất (như đơn thường)
      const prof = { ...(getProfile() || {}), name: name.trim(), phone: formatPhone(phone) };
      if (order?.customer?.id) prof.customer_id = order.customer.id;
      else if (order?.customer_id) prof.customer_id = order.customer_id;
      if (order?.customer?.member_code) prof.member_code = order.customer.member_code;
      setProfile(prof);
      try { storage.set('zm_last_order', order.code); } catch { /* bỏ qua */ }
      if (type === 'delivery' && customerId && saveAddr && !addrId) {
        api.saveAddress({
          customer_id: customerId, phone: formatPhone(phone), member_code: getProfile()?.member_code || '',
          label: addrLabel,
          province: provName(), ward: wardName(), street: street.trim(),
          // Spec đồng bộ luồng nhóm (L3): địa chỉ mới lưu kèm điểm đã dùng
          // để lần sau khỏi tra lại (như đơn thường).
          lat: dropoff?.lat ?? null, lng: dropoff?.lng ?? null,
        }).catch(() => {});
      }
      // Spec đồng bộ luồng nhóm (L3): đơn đặt thành công bằng địa chỉ ĐÃ
      // CHỌN trong sổ → lưu điểm đã dùng (kèm dòng chữ đã dùng) vào chính
      // bản ghi đó — gương Checkout, chỉ PATCH khi thật sự khác bản ghi.
      if (type === 'delivery' && customerId && addrId && dropoff) {
        const a = addrBook.find((x) => String(x.id) === String(addrId));
        if (a && (Number(a.lat) !== dropoff.lat || Number(a.lng) !== dropoff.lng
          || String(a.street || '') !== street.trim()
          || String(a.ward || '') !== wardName()
          || String(a.province || '') !== provName())) {
          api.updateAddress(a.id, {
            customer_id: customerId, phone: formatPhone(phone), member_code: getProfile()?.member_code || '',
            label: a.label, province: provName(), ward: wardName(), street: street.trim(),
            lat: dropoff.lat, lng: dropoff.lng,
          }).then(() => {
            setAddrBook((prev) => prev.map((x) => (String(x.id) === String(a.id)
              ? { ...x, lat: dropoff.lat, lng: dropoff.lng, street: street.trim(), ward: wardName(), province: provName() }
              : x)));
          }).catch(() => {});
        }
      }
      if (sdkFailed) {
        // Chờ khách đọc banner lỗi trong trang rồi mới rời trang (như Checkout)
        setTimeout(() => onDone(order), 2600);
      } else {
        onDone(order);
      }
    } catch (e) {
      // Spec mật khẩu §5.4 (Q3): server từ chối vì thiếu đồng ý → bật ô đồng ý
      // lên để trưởng nhóm tích lại rồi đặt lại (cùng cơ chế phục hồi như Checkout).
      // Spec đồng bộ luồng nhóm (L7): lỗi hiện formErr trong trang, không alert().
      if (e.code === 'consent_required') {
        setConsentNeeded(true);
        setFormErr(e.message || 'Bạn cần đồng ý cho Daybreak xử lý dữ liệu cá nhân để đặt đơn đầu tiên.');
      } else {
        setFormErr(e.message || 'Đặt đơn nhóm thất bại. Vui lòng thử lại.');
      }
    }
    finally { setPlacing(false); }
  };

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {/* Sửa 2026-11-07 (#8): trước đây icon + từng mẩu chữ là các flex item
          rời → "Chốt đơn nhóm" bị bóp thành cột hẹp, chữ gãy vụn. Nay toàn
          câu nằm trong MỘT span (1 flex item) nên xuôi dòng như đoạn văn. */}
      <div className="zm-alert" style={{ margin: '12px 0', display: 'flex', alignItems: 'flex-start', gap: 6 }}><span style={{ display: 'flex', flexShrink: 0, marginTop: 1 }}><ZmIcon name="users" size={14} /></span><span style={{ flex: 1, minWidth: 0 }}>Chốt đơn nhóm <b>{group.code}</b> — {group.total_qty} món · {fmt(group.subtotal)}đ. Tên từng người đã ghi trong ghi chú từng món.</span></div>

      {isClosed && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px 12px', fontSize: 13, color: '#991b1b', marginBottom: 12 }}>
          🔴 <b>Quán đã đóng cửa</b>{st?.hours && st.hours !== 'Nghỉ hôm nay' ? ` (mở lại ${st.hours.split(' - ')[0]})` : ''}<br />
          Hiện chỉ nhận đơn hẹn giờ — hẹn từ khung giờ mở cửa gần nhất trở đi.
        </div>
      )}

      <div className="zm-seg" style={{ marginTop: 4 }}>
        <button className={type === 'delivery' ? 'on' : ''} onClick={() => { switchType('delivery'); if (isClosed) setDeliveryMode('scheduled'); }}><ZmIcon name="bike" size={16} />Giao hàng</button>
        <button className={type === 'takeaway' ? 'on' : ''} disabled={isClosed} onClick={() => switchType('takeaway')}><ZmIcon name="bag" size={16} />Mang đi</button>
        <button className={type === 'scheduled' ? 'on' : ''} onClick={() => switchType('scheduled')}><ZmIcon name="clock" size={16} />Hẹn giờ lấy</button>
      </div>

      <div className="zm-field">
        <label>Tên trưởng nhóm *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="zm-field">
        <label>Số điện thoại * <span style={{ color: '#888', fontWeight: 400 }}>(để tích điểm thành viên)</span></label>
        <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="09xx xxx xxx" inputMode="tel" maxLength={12} />
        {phone && !validPhone(phone) && (
          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>Số điện thoại cần bắt đầu bằng 0 và đủ 10 số.</div>
        )}
      </div>

      {type === 'delivery' && (
        <>
          {/* Card thông tin nhận hàng — bấm mở popup (như đơn thường) */}
          <div className="zm-deliv-card" onClick={() => setShowAddrPop(true)}>
            <div className="zm-deliv-top">
              <div className="zm-deliv-ic"><ZmIcon name="mapPin" size={20} /></div>
              <div className="zm-deliv-t">Thông tin nhận hàng</div>
              <div className="zm-deliv-chg">Thay đổi</div>
            </div>
            <div className="zm-deliv-mid">
              <div className="zm-deliv-uic"><ZmIcon name="user" size={20} /></div>
              <div style={{ flex: 1 }}>
                <div className="zm-deliv-nm">
                  {name || 'Nhập tên'} · {phone ? phone : <span className="zm-miss">Nhập số điện thoại</span>}
                </div>
                <div className="zm-deliv-ad">
                  {[street, wards.find((w) => String(w.code) === ward)?.name, provinces.find((pr) => String(pr.code) === province)?.name].filter(Boolean).join(', ') || 'Nhập địa chỉ'}
                </div>
                {pointValid && km != null && (
                  <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>✓ Đã tính phí giao theo địa chỉ — cách quán ~{km}km</div>
                )}
              </div>
              <div className="zm-deliv-arr">›</div>
            </div>
          </div>

          {showAddrPop && (
            <div className="zm-pop-overlay" onClick={() => setShowAddrPop(false)}>
              <div className="zm-pop-sheet" onClick={(e) => e.stopPropagation()}>
                <h3>Thông tin nhận hàng</h3>
                {addrBook.length > 0 && (
                  <div className="zm-field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ZmIcon name="book" size={14} />Sổ địa chỉ</label>
                    <select value={addrId} onChange={(e) => {
                      addrTouched.current = true;
                      const id = e.target.value;
                      setAddrId(id);
                      if (!id) { bumpAddrVer(); setDropoff(null); return; }
                      const a = addrBook.find((x) => String(x.id) === id);
                      if (!a) return;
                      fillFromAddress(a);
                    }}>
                      <option value="">— Nhập địa chỉ mới —</option>
                      {addrBook.map((a) => (
                        <option key={a.id} value={a.id}>{a.is_default ? '★ ' : ''}{a.label}: {a.full_address}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Spec đồng bộ luồng nhóm (L9): Tỉnh/TP + Phường/Xã MỘT HÀNG HAI CỘT như đơn thường */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="zm-field" style={{ flex: 1, minWidth: 0 }}>
                    <label>Tỉnh / Thành phố *</label>
                    <SearchSelect
                      value={province} placeholder="— Chọn tỉnh/thành —"
                      options={provinces.map((p) => ({ code: p.code, name: p.name }))}
                      onChange={(c) => { fillingFromBookRef.current = false; bumpAddrVer(); setProvince(c); setAddrId(''); }}
                    />
                  </div>
                  <div className="zm-field" style={{ flex: 1, minWidth: 0 }}>
                    <label>Phường / Xã *</label>
                    <SearchSelect
                      value={ward} placeholder="— Chọn phường/xã —" disabled={!province}
                      options={wards.map((w) => ({ code: w.code, name: w.name }))}
                      onChange={(c) => { bumpAddrVer(); setWard(c); }}
                    />
                  </div>
                </div>
                <div className="zm-field" style={{ position: 'relative' }}>
                  <label>Số nhà, tên đường *</label>
                  <input
                    value={street}
                    onChange={(e) => onStreetChange(e.target.value)}
                    placeholder="VD: 123 Nguyễn Huệ"
                    autoComplete="off"
                  />
                  {(suggestLoading || suggests.length > 0) && (
                    <div style={{
                      position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 50,
                      background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto',
                    }}>
                      {suggestLoading && <div style={{ padding: 12, fontSize: 13, color: '#999' }}>Đang tìm địa chỉ...</div>}
                      {suggests.map((s, i) => (
                        <div
                          key={i}
                          onClick={() => pickSuggest(s)}
                          style={{ padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
                        >
                          <div style={{ fontWeight: 600 }}>{s.short}</div>
                          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {geoLoading && <div className="zm-note">Đang tự động tính khoảng cách...</div>}
                {km != null && shipCfg && (
                  <div className="zm-alert">Khoảng cách ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b> (tự động tính)</div>
                )}
                {/* Spec đồng bộ luồng nhóm (L1): tra rỗng cả bậc thang → khối
                    lỗi ĐÚNG CÂU đơn thường + nút Tính lại phí; nút chốt khóa
                    tới khi có điểm (không còn lời hứa "vẫn đặt được"). */}
                {geoError && (
                  <div className="zm-alert" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}>
                    Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại.
                    <button type="button" onClick={resolveDropoff} style={{ display: 'block', marginTop: 8, fontWeight: 700, color: '#b91c1c', textDecoration: 'underline' }}>Tính lại phí</button>
                  </div>
                )}
                <div className="zm-field">
                  <label>Ghi chú cho shipper</label>
                  <input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="VD: gọi trước khi tới, để ở bảo vệ..." />
                </div>
                {customerId && !addrId && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
                    <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} style={{ width: 18, height: 18 }} />
                    Lưu địa chỉ này vào sổ địa chỉ
                    {saveAddr && (
                      <select value={addrLabel} onChange={(e) => setAddrLabel(e.target.value)} style={{ marginLeft: 4, padding: '4px 8px', borderRadius: 8, border: '1px solid #e0e0e0' }}>
                        <option>Nhà</option><option>Công ty</option><option>Khác</option>
                      </select>
                    )}
                  </label>
                )}
                <button className="zm-btn-primary zm-pop-save" onClick={() => setShowAddrPop(false)}>Lưu</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Spec đồng bộ luồng nhóm (L11): mục thu gọn Email + Mã người giới
          thiệu gương Checkout — mặc định đóng cho gọn form; mở sẵn khi có
          mã mời gắn từ link. Giá trị đã nhập vẫn gửi đi kể cả khi mục đóng. */}
      <div style={{ margin: '0 0 6px' }}>
        <button type="button" onClick={() => setMoreInfoOpen(!moreInfoOpen)} aria-expanded={moreInfoOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 0, padding: '6px 0', cursor: 'pointer', color: '#24305E', fontSize: 13.5, fontWeight: 700, textAlign: 'left', minHeight: 44 }}>
          <span style={{ flex: 1 }}>Thêm email / mã giới thiệu (không bắt buộc)</span>
          <span style={{ fontSize: 12, color: '#888' }}>{moreInfoOpen ? '▾' : '▸'}</span>
        </button>
        {moreInfoOpen && (
          <>
            <div className="zm-field">
              <label>Email <span style={{ color: '#888', fontWeight: 400 }}>(không bắt buộc — chỉ dùng cho thông báo bảo mật)</span></label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email của bạn" type="email" maxLength={150} />
            </div>
            <div className="zm-field">
              <label>Mã người giới thiệu (nếu có)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input value={refCode} onChange={(e) => updateRefCode(e.target.value.toUpperCase())} placeholder="Nhập mã của người giới thiệu" maxLength={20} style={{ flex: 1 }} />
                {refCode && (
                  <button type="button" onClick={() => updateRefCode('')} aria-label="Xóa mã người giới thiệu"
                    style={{ minWidth: 44, minHeight: 44, borderRadius: 10, border: '1px solid #ddd', background: '#fff', fontSize: 15, color: '#888' }}><ZmIcon name="x" size={16} /></button>
                )}
              </div>
              {refFromLink && refCode && (
                <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>Đã gắn từ link mời — kiểm tra đúng người mời của bạn chưa nhé.</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Spec mật khẩu §5.4 (Q3): ô đồng ý NĐ 13 ở đơn nhóm — chỉ hiện khi
          trưởng nhóm chưa đồng ý; chưa tích thì nút đặt đơn khóa (xem place()). */}
      {consentNeeded && (
        <div style={{ margin: '4px 0 8px' }}>
          <ConsentCheck checked={consentChecked} onChange={setConsentChecked} />
        </div>
      )}

      {type === 'delivery' && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px', color: '#555' }}>HÌNH THỨC GIAO HÀNG</div>
          <div
            onClick={() => !isClosed && setDeliveryMode('now')}
            style={{
              border: `2px solid ${deliveryMode === 'now' ? '#24305E' : '#e5e7eb'}`,
              background: deliveryMode === 'now' ? '#f0f4ff' : '#fff',
              borderRadius: 12, padding: 12, marginBottom: 8, cursor: isClosed ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, opacity: isClosed ? 0.5 : 1,
            }}>
            <span style={{ color: '#24305E', display: 'flex' }}><ZmIcon name="zap" size={24} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Giao ngay</div>
              <div style={{ fontSize: 12, color: '#888' }}>{isClosed ? 'Không khả dụng khi quán đóng cửa' : 'Shipper giao luôn trong ~30 phút'}</div>
            </div>
            <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #d1d5db', ...(deliveryMode === 'now' ? { borderColor: '#24305E', background: '#24305E', boxShadow: 'inset 0 0 0 3px #fff' } : {}) }} />
          </div>
          <div
            onClick={() => setDeliveryMode('scheduled')}
            style={{
              border: `2px solid ${deliveryMode === 'scheduled' ? '#24305E' : '#e5e7eb'}`,
              background: deliveryMode === 'scheduled' ? '#f0f4ff' : '#fff',
              borderRadius: 12, padding: 12, marginBottom: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
            <span style={{ color: '#24305E', display: 'flex' }}><ZmIcon name="calendar" size={24} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Hẹn giờ giao</div>
              <div style={{ fontSize: 12, color: '#888' }}>Chọn ngày giờ muốn nhận hàng</div>
            </div>
            <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #d1d5db', ...(deliveryMode === 'scheduled' ? { borderColor: '#24305E', background: '#24305E', boxShadow: 'inset 0 0 0 3px #fff' } : {}) }} />
          </div>
          {deliveryMode === 'scheduled' && (
            <div style={{ background: '#f0f4ff', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Ngày giờ muốn nhận hàng *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><DateField value={schedDate} onChange={setSchedDate} /></div>
                <div style={{ width: 110 }}>
                  {timeSlots(b, schedDate).length > 0 ? (
                    <select value={schedTime} onChange={(e) => setSchedTime(e.target.value)}
                      style={{ width: '100%', padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
                      <option value="">Chọn giờ</option>
                      {timeSlots(b, schedDate).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <TimeField value={schedTime} onChange={setSchedTime} />
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>Chỉ chọn trong giờ mở cửa của quán</div>
            </div>
          )}

        </>
      )}

      {type === 'scheduled' && (
        <div className="zm-field">
          <label>Ngày giờ muốn tới lấy *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><DateField value={schedDate} onChange={setSchedDate} /></div>
            <div style={{ width: 110 }}><TimeField value={schedTime} onChange={setSchedTime} /></div>
          </div>
        </div>
      )}

      <div className="zm-field"><label>Phương thức thanh toán</label></div>
      {/* Spec đồng bộ luồng nhóm (L6): thanh toán qua Checkout SDK theo
          cấu hình kênh như đơn thường — BANK chỉ hiện khi sẵn sàng
          (bank_available); COD của nhóm chỉ cho đơn mang về/hẹn lấy, đơn
          GIAO nhóm không có COD ở mọi cấu hình (mục 9, L5 đóng). */}
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ZmIcon name="lock" size={14} />Thanh toán an toàn qua Zalo
      </div>
      {zaloCfg ? (
        <>
          {(zaloCfg.bank_available ?? zaloCfg.bank_enabled) && (
            <div className={`zm-pay-opt ${payChannel === 'BANK' ? 'on' : ''}`} onClick={() => setPayChannel('BANK')}>
              <div className="dot" /><div><b>Chuyển khoản</b><div style={{ fontSize: 12, color: '#888' }}>Quét QR / chuyển khoản qua Zalo</div></div>
            </div>
          )}
          {zaloCfg.cod_enabled && !codHiddenForGroupDelivery && (
            <div className={`zm-pay-opt ${payChannel === 'COD' ? 'on' : ''}`} onClick={() => setPayChannel('COD')}>
              <div className="dot" /><div><b>Trả tại quán</b><div style={{ fontSize: 12, color: '#888' }}>Trả tiền khi nhận món</div></div>
            </div>
          )}
        </>
      ) : (
        (payMethods.length ? payMethods : [
          { value: 'transfer', label: 'Chuyển khoản / QR', desc: 'Quán xác nhận đã nhận tiền rồi mới làm món' },
          { value: 'pay_at_store', label: 'Thanh toán tại quán', desc: 'Trả tiền khi nhận món' },
        ])
          // Spec phí giao mục 5.2/5.3: đơn giao ở nhánh dự phòng không có trả
          // tại quán/thu hộ ở cả 2 giai đoạn — ẩn hẳn lựa chọn.
          .filter((m) => !(m.value === 'pay_at_store' && type === 'delivery'))
          .map((m) => (
          <div key={m.value} className={`zm-pay-opt ${payment === m.value ? 'on' : ''}`} onClick={() => setPayment(m.value)}>
            <div className="dot" /><div><b>{m.label}</b><div style={{ fontSize: 12, color: '#888' }}>{m.desc}</div></div>
          </div>
        ))
      )}

      {/* ===== Spec panel Ưu đãi (2026-11-14): khối Ưu đãi + panel chọn
          do component dùng chung PromoPanel đảm nhiệm (dùng chung với
          Checkout đơn thường). key theo loại đơn: đổi loại → remount,
          lựa chọn ưu đãi reset như hành vi cũ. ===== */}
      <PromoPanel
        key={type}
        ref={promoRef}
        offers={offers}
        subtotal={group.subtotal}
        shipFee={shipFee}
        phone={phone}
        onResolve={setPromoRes}
      />

      {points > 0 && (
        <div style={{ background: '#fff7e6', border: '1px solid #ffe1a8', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
          ⭐ Trưởng nhóm có <b>{fmt(points)} điểm</b> — điểm chỉ đổi coupon tại mục <b>Tài khoản › Cửa hàng điểm</b> (không trừ trực tiếp vào đơn nhóm).
        </div>
      )}

      <div className="zm-field">
        <label>Ghi chú</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho quán..." />
      </div>

      <div className="zm-total-row"><span>Tạm tính ({group.total_qty} món)</span><span>{fmt(group.subtotal)}đ</span></div>
      {type === 'delivery' && (
        <div className="zm-total-row">
          <span>Phí vận chuyển{km != null ? ` (~${km}km)` : ''}</span>
          <span>{pointMissing ? 'Chưa tính được' : (km != null ? `${fmt(shipFeeGross)}đ` : 'Quán xác nhận')}</span>
        </div>
      )}
      {type === 'delivery' && shipShopSupport > 0 && <div className="zm-total-row disc"><span>🏠 Quán hỗ trợ phí ship</span><span>−{fmt(shipShopSupport)}đ</span></div>}
      {/* Spec panel Ưu đãi (2026-11-14): các dòng giảm do phân xử §5d của
          PromoPanel sinh ra — chỉ ưu đãi ĐANG ÁP mới có dòng, gương Checkout */}
      {promoRes.shipApplied.filter((s) => s.amount > 0).map((s) => (
        <div key={`${s.kind}-${s.id}`} className="zm-total-row disc"><span>{s.kind === 'wallet_coupon' ? <CouponIcon size={14} /> : '🚚'} {s.name} (phí ship)</span><span>−{fmt(s.amount)}đ</span></div>
      ))}
      {promoRes.giftApplied.map((g) => (
        <div key={`${g.kind}-${g.id}`} className="zm-total-row disc"><span>🎁 {g.name}</span><span>Tặng {g.gift_product_name}</span></div>
      ))}
      {promoRes.promoApplied && (
        <div className="zm-total-row disc">
          <span>🎉 {promoRes.promoApplied.name}</span>
          <span>−{fmt(promoRes.promoApplied.amount)}đ</span>
        </div>
      )}
      {promoRes.couponApplied && (
        <div className="zm-total-row disc">
          <span><CouponIcon size={14} /> {promoRes.couponApplied.source === 'voucher' ? 'Voucher' : 'Coupon'} {promoRes.couponApplied.code}{promoRes.couponApplied.state === 'stacked' ? ' (cộng dồn)' : ''}</span>
          <span>−{fmt(promoRes.couponApplied.amount)}đ</span>
        </div>
      )}
      <div className="zm-total-row grand"><span>Tổng cộng</span><span>{pointMissing ? '—' : `${fmt(grandTotal)}đ`}</span></div>

      {/* Spec đồng bộ luồng nhóm (L10): khối hướng dẫn chuyển khoản —
          nguyên văn delta đơn thường — đặt tại khu vực chốt đơn của nhóm
          (ngay trên nút chốt), chỉ hiện khi kênh hiệu dụng là BANK, khách
          thấy TRƯỚC khi luồng mở SDK. */}
      {effChannelFor() === 'BANK' && (
        <div style={{ background: '#f0f4ff', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#24305E', marginBottom: 4 }}>Thanh toán bằng chuyển khoản</div>
          <div style={{ fontSize: 13, color: '#444', lineHeight: 1.55 }}>
            Zalo sẽ hiện mã QR để bạn quét bằng app ngân hàng. Chuyển khoản xong, bạn có thể đóng màn hình QR để tiếp tục theo dõi đơn hàng tại đây.
          </div>
        </div>
      )}

      {/* Spec đồng bộ luồng nhóm (L7): lỗi validate/place hiện trong trang */}
      {formErr && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: 13, marginTop: 12, fontWeight: 600 }}>⚠ {formErr}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="zm-btn-outline" style={{ width: 120 }} onClick={onBack}>← Quay lại</button>
        <button className="zm-btn-primary" disabled={placing || pointMissing} onClick={place} style={{ flex: 1 }}>
          {placing ? 'Đang đặt...' : 'Xác nhận đặt đơn nhóm'}
        </button>
      </div>
      {pointMissing && (
        <div onClick={() => setShowAddrPop(true)}
          style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 12, padding: '10px 12px', fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
          Chưa tra được vị trí từ địa chỉ này — kiểm tra lại số nhà / tên đường rồi thử lại. (Chạm vào đây để mở lại mục địa chỉ)
        </div>
      )}
    </div>
  );
}
