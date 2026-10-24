import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, fmt, priceOf, getMyGroups, saveMyGroup, getRef, getProfile, setProfile } from '../api';
import { storage } from '../utils/storage';
import { useShop } from '../store';
import ProductSheet from '../components/ProductSheet';
import SearchSelect from '../components/SearchSelect';
import { TabBar } from './Home';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';
import { openStatus, nextOpenSlot, timeSlots, isWithinOpening } from '../utils/openingHours';
import { DateField, TimeField, toApiDate, validTime, formatPhone } from '../utils/checkoutFields.jsx';

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
        <div style={{ fontSize: 56 }}>👥</div>
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
    if (tab !== 'summary') return;
    const t = setInterval(load, 15000); // tự refresh tổng đơn mỗi 15s
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
        <div className="zm-empty">⚠️ {err}</div>
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
          <div style={{ fontSize: 56 }}>🍽️</div>
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
        <h1>👥 Đơn nhóm · {upper}</h1>
      </div>

      <div className="zm-group-bar">
        <div>
          <div style={{ fontWeight: 800 }}>{group.branch?.name}</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {isLeader ? 'Bạn là trưởng nhóm' : `Bạn là ${me.name}`} · {group.member_count} người · {group.total_qty} món
          </div>
        </div>
        <button className="zm-btn-outline" style={{ width: 'auto', padding: '8px 14px', fontSize: 13 }} onClick={copyLink}>
          📋 Copy link
        </button>
      </div>

      {/* Spec đơn nhóm đồng bộ (2026-10-21): nhóm đã chốt — MỌI thành viên thấy mã đơn + nút Theo dõi */}
      {group.status === 'ordered' && group.order_code && (
        <div style={{ margin: '12px 16px 0', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: '#166534' }}>
            ✅ Đơn nhóm đã được chốt — mã đơn <b>{group.order_code}</b>
          </div>
          <button className="zm-btn-primary" style={{ marginTop: 10 }}
            onClick={() => nav(`/track?code=${encodeURIComponent(group.order_code)}`)}>
            Theo dõi đơn {group.order_code}
          </button>
        </div>
      )}

      {tab !== 'checkout' && (
        <div className="zm-seg" style={{ margin: '12px 16px 0' }}>
          <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>🍽️ Chọn món</button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => { setTab('summary'); load(); }}>
            🧾 Tổng đơn ({group.total_qty})
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
                <div className="zm-group-names">👤 {(it.member_names || []).join(', ')}</div>
                {it.note && <div className="zm-row-desc">📝 {it.note}</div>}
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
                  vietqr_payload: order.vietqr_payload || null,
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
// - Địa chỉ: popup cấu trúc tỉnh/phường/số nhà + GPS + sổ địa chỉ của trưởng nhóm;
//   geocode lỗi VẪN đặt được (quán xác nhận phí ship sau) — bỏ chặn "phải có km".
// - PTTT tải động (api.payMethods), KM MỌI LOẠI (bỏ lọc chỉ-phí-ship), ô voucher,
//   đổi điểm của trưởng nhóm, client_key chống trùng, lưu customer vào profile.
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
  const [promos, setPromos] = useState([]);
  const [promoId, setPromoId] = useState('');
  const [voucher, setVoucher] = useState('');
  // Audit 2026-10-21 🟠8: voucher validate server để vào tổng hiển thị (như đơn thường)
  const [voucherInfo, setVoucherInfo] = useState(null); // {code, name, discount}
  const [points, setPoints] = useState(0);
  // Loyalty 2.0: gỡ đổi điểm trực tiếp ở checkout nhóm (như đơn thường)
  const [customerId, setCustomerId] = useState(null);
  const [addrBook, setAddrBook] = useState([]);
  const [addrId, setAddrId] = useState('');
  const [saveAddr, setSaveAddr] = useState(false);
  const [addrLabel, setAddrLabel] = useState('Nhà');
  const [showAddrPop, setShowAddrPop] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [pickedCoord, setPickedCoord] = useState(null);
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  // Báo giá hãng giao hàng (như Checkout đơn thường)
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [deliveryPkg, setDeliveryPkg] = useState('nhanh');
  const [deliveryReady, setDeliveryReady] = useState(false);
  const quoteTimer = useRef(null);
  const geoTimer = useRef(null);
  const quoteLiveRef = useRef({ loading: false, pkg: null, code: 'nhanh' });
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
    api.deliveryConfig().then((c) => setDeliveryReady(!!c?.ready)).catch(() => {});
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
    loadWards(province).then((ws) => { setWards(ws || []); setWard(''); });
  }, [province]);

  const wardName = () => (wards.find((w) => String(w.code) === String(ward)) || {}).name || '';
  const provName = () => (provinces.find((p) => String(p.code) === String(province)) || {}).name || '';
  const fullAddress = () => [street.trim(), wardName(), provName()].filter(Boolean).join(', ');

  const calcKm = async () => {
    if (!b.latitude || !b.longitude) return;
    if (pickedCoord) {
      const d = haversineKm(Number(b.latitude), Number(b.longitude), pickedCoord.lat, pickedCoord.lng);
      setKm(Math.round(d * 10) / 10);
      setGeoError(false);
      return;
    }
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    setGeoLoading(true); setGeoError(false);
    try {
      const g = await geocodeAddress(fullAddress() + ', Việt Nam');
      const d = haversineKm(Number(b.latitude), Number(b.longitude), g.lat, g.lng);
      setKm(Math.round(d * 10) / 10);
    } catch (e) { setKm(null); setGeoError(true); }
    finally { setGeoLoading(false); }
  };

  useEffect(() => {
    if (type !== 'delivery') return;
    if (!street.trim() || !ward || !province) { setKm(null); setGeoError(false); return; }
    clearTimeout(geoTimer.current);
    geoTimer.current = setTimeout(calcKm, 800);
    return () => clearTimeout(geoTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, ward, province, type]);

  // GPS: điền địa chỉ từ tọa độ (như Checkout đơn thường)
  const fillFromCoord = async (latitude, longitude) => {
    const r = await api.geocodeReverse(latitude, longitude);
    const streetParts = [r.house_number, r.road].filter(Boolean).join(' ');
    if (streetParts) setStreet(streetParts);
    const prov = provinces.find((p) =>
      r.state?.includes(p.name) || p.name.includes(r.state || '###') ||
      r.city?.includes(p.name) || p.name.includes(r.city || '###'));
    if (prov) {
      setProvince(String(prov.code));
      try {
        const ws = await loadWards(prov.code);
        setWards(ws);
        const w = ws.find((x) => r.suburb && (x.name.includes(r.suburb) || r.suburb.includes(x.name)));
        if (w) setWard(String(w.code));
      } catch { /* bỏ qua */ }
    }
  };
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { alert('Thiết bị không hỗ trợ định vị.'); return; }
    setLocLoading(true);
    const onPos = async (pos) => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        setPickedCoord({ lat, lng: lon });
        await fillFromCoord(lat, lon);
      } catch (e) { alert(e.message || 'Không lấy được địa chỉ từ vị trí.'); }
      finally { setLocLoading(false); }
    };
    navigator.geolocation.getCurrentPosition(
      onPos,
      () => { setLocLoading(false); alert('Không lấy được vị trí. Hãy nhập địa chỉ tay.'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  // Báo giá hãng khi có địa chỉ đầy đủ (debounce 1s, timeout 8s — như đơn thường)
  useEffect(() => {
    if (type !== 'delivery') { setQuote(null); setQuoteError(''); return; }
    if (!b?.id || !street.trim() || !ward || !province) { setQuote(null); setQuoteError(''); return; }
    clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(async () => {
      setQuoteLoading(true); setQuoteError('');
      try {
        const data = await Promise.race([
          api.deliveryQuote({
            branch_id: b.id,
            dropoff_address: fullAddress(),
            dropoff_lat: pickedCoord?.lat || null,
            dropoff_lng: pickedCoord?.lng || null,
            subtotal: group.subtotal,
            cod_amount: payment === 'pay_at_store' ? group.subtotal : 0,
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        setQuote(data);
        const hasNhanh = (data.packages || []).some((p) => p.code === 'nhanh');
        setDeliveryPkg(hasNhanh ? 'nhanh' : (data.packages[0]?.code || 'nhanh'));
      } catch (e) {
        setQuote(null);
        setQuoteError(e.message === 'timeout'
          ? 'Đang tính phí ship — vui lòng đợi giây lát.'
          : (e.message || 'Chưa giao được tới địa chỉ này.'));
      } finally { setQuoteLoading(false); }
    }, 1000);
    return () => clearTimeout(quoteTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, ward, province, type, b?.id, group.subtotal, payment]);

  const quotePkg = quote?.packages?.find((p) => p.code === deliveryPkg) || quote?.packages?.[0];
  useEffect(() => {
    quoteLiveRef.current = { loading: quoteLoading, pkg: quotePkg || null, code: deliveryPkg };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteLoading, quote, deliveryPkg]);
  const shipFee = type === 'delivery'
    ? (quotePkg ? quotePkg.customer_pays : (km != null && shipCfg ? calcShipFee(km, shipCfg) : 0))
    : 0;

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
      };
      // 🟠10 (phía FE): tra khách lỗi không được nuốt luôn KM — rơi về vãng lai.
      api.customerByPhone(phone, getProfile()?.member_code || '').catch(() => null).then((c) => {
        if (c) {
          setPoints(c.loyalty?.points ?? c.points ?? 0);
          setCustomerId(c.id);
          api.addresses(c.id, c.phone, c.member_code).then((r) => setAddrBook(r?.data || [])).catch(() => {});
          return api.eligiblePromotions({ ...payload, customer_id: c.id, phone: formatPhone(phone), member_code: getProfile()?.member_code || '' });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setPromos).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, group.subtotal, km, shipCfg, type]);

  useEffect(() => {
    if (promoId && promos.length > 0 && !promos.some((p) => String(p.id) === String(promoId))) setPromoId('');
  }, [promos]);

  const promo = promos.find((p) => String(p.id) === String(promoId));
  const isShipPromo = !!(promo && (promo.is_shipping || promo.type === 'shipping') && type === 'delivery');
  const shipDisc = isShipPromo ? Math.min(Number(promo.discount) || 0, shipFee) : 0;
  const promoDisc = promo && !isShipPromo ? Number(promo.discount) : 0;
  // 🟠8: voucher vào tổng theo luật phía thắng (hòa → KM thắng) như đơn thường
  const voucherDisc = voucherInfo ? Number(voucherInfo.discount) || 0 : 0;
  const voucherWins = voucherDisc > 0 && voucherDisc > promoDisc;
  const moneyDiscTotal = voucherDisc > 0 ? Math.max(promoDisc, voucherDisc) : promoDisc;
  // Loyalty 2.0: bỏ pointDisc — tổng nhóm không còn dòng trừ điểm.
  const grandTotal = Math.max(0, group.subtotal + shipFee - shipDisc - moneyDiscTotal);

  // 🟠8: validate voucher bằng endpoint server (số giảm thật); lỗi báo rõ như khi chốt đơn
  const checkVoucher = async (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c) { setVoucherInfo(null); return true; }
    try {
      const prof = getProfile() || {};
      const res = await api.validateVoucher({
        code: c,
        subtotal: group.subtotal,
        phone: formatPhone(phone || '') || prof.phone || '',
        member_code: prof.member_code || '',
      });
      setVoucherInfo({ code: res.code, name: res.name, discount: Math.round(Number(res.discount) || 0) });
      return true;
    } catch (err) {
      setVoucherInfo(null);
      alert(err.message || 'Mã voucher không hợp lệ.');
      return false;
    }
  };

  const switchType = (t) => { setType(t); setPromoId(''); setVoucher(''); setVoucherInfo(null); setRedeem(0); };

  const validateSchedule = (label) => {
    const d = toApiDate(schedDate);
    if (!d) { alert(`Nhập ngày ${label} (dd/mm/yyyy).`); return false; }
    if (!validTime(schedTime)) { alert(`Nhập giờ ${label} (HH:MM, 24h).`); return false; }
    if (new Date(`${d}T${schedTime}`) <= new Date()) { alert('Giờ hẹn phải sau thời điểm hiện tại.'); return false; }
    if (!isWithinOpening(b, schedDate, schedTime)) { alert('Giờ hẹn phải trong giờ mở cửa của quán.'); return false; }
    return true;
  };

  const place = async () => {
    if (placing) return;
    if (!name.trim() || !phone.trim()) { alert('Nhập tên và số điện thoại.'); return; }
    if (type === 'delivery') {
      if (!province || !ward || !street.trim()) { alert('Chọn tỉnh/thành, phường/xã và nhập số nhà, tên đường.'); return; }
      if (deliveryMode === 'scheduled' && !validateSchedule('muốn giao')) return;
    }
    if (type === 'scheduled' && !validateSchedule('muốn tới lấy')) return;
    // 🟠8: có mã voucher chưa validate → validate trước khi chốt (lỗi thì dừng, báo rõ)
    const vcode = voucher.trim().toUpperCase();
    if (vcode && vcode !== (voucherInfo?.code || '')) {
      const ok = await checkVoucher(vcode);
      if (!ok) return;
    }
    setPlacing(true);
    try {
      // Đang tính phí ship → tự chờ quote xong (tối đa 10s) như đơn thường
      if (type === 'delivery') {
        let waited = 0;
        while (quoteLiveRef.current.loading && waited < 10000) {
          await new Promise((r) => setTimeout(r, 300));
          waited += 300;
        }
      }
      const livePkg = type === 'delivery' ? quoteLiveRef.current.pkg : null;
      // Đã cấu hình hãng mà không báo giá được và không có km dự phòng → chặn (như đơn thường);
      // geocode lỗi nhưng hãng không cấu hình → vẫn đặt, quán xác nhận phí ship sau.
      if (type === 'delivery' && deliveryReady && !livePkg && km == null) {
        alert('Chưa giao được tới địa chỉ này. Vui lòng thử địa chỉ khác hoặc chọn nhận tại quán.');
        return;
      }
      let scheduledAt = null;
      if (type === 'scheduled' || (type === 'delivery' && deliveryMode === 'scheduled')) {
        const d = toApiDate(schedDate);
        scheduledAt = `${d}T${schedTime}`;
      }
      const order = await api.groupCheckout(group.code, {
        client_key: clientKeyRef.current || newClientKey(),
        customer_name: name.trim(),
        customer_phone: formatPhone(phone),
        // Spec KM chống mã Phần B: mã TV của trưởng nhóm để xác thực quyền lợi trong store()
        member_code: getProfile()?.member_code || null,
        order_type: type === 'delivery' ? 'delivery' : 'takeaway',
        delivery_address: type === 'delivery' ? fullAddress() : null,
        province: type === 'delivery' ? provName() : null,
        ward: type === 'delivery' ? wardName() : null,
        distance_km: type === 'delivery' ? km : null,
        delivery_note: type === 'delivery' && deliveryNote.trim() ? deliveryNote.trim() : null,
        scheduled_at: scheduledAt,
        payment_method: payment,
        promotion_id: promoId || null,
        voucher_code: voucher.trim() || null,
        // Loyalty 2.0: không gửi points_redeem nữa
        note: note.trim() || null,
        referred_by: getRef() || null,
        delivery_package: type === 'delivery' ? (quoteLiveRef.current.code || deliveryPkg) : null,
        delivery_quoted_fee: type === 'delivery' && livePkg ? livePkg.fee : null,
        delivery_provider: type === 'delivery' ? livePkg?.provider || null : null,
        delivery_dropoff_lat: type === 'delivery' ? pickedCoord?.lat || null : null,
        delivery_dropoff_lng: type === 'delivery' ? pickedCoord?.lng || null : null,
      });
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
        }).catch(() => {});
      }
      onDone(order);
    } catch (e) { alert(e.message); }
    finally { setPlacing(false); }
  };

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div className="zm-alert" style={{ margin: '12px 0' }}>👥 Chốt đơn nhóm <b>{group.code}</b> — {group.total_qty} món · {fmt(group.subtotal)}đ. Tên từng người đã ghi trong ghi chú từng món.</div>

      {isClosed && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px 12px', fontSize: 13, color: '#991b1b', marginBottom: 12 }}>
          🔴 <b>Quán đã đóng cửa</b>{st?.hours && st.hours !== 'Nghỉ hôm nay' ? ` (mở lại ${st.hours.split(' - ')[0]})` : ''}<br />
          Hiện chỉ nhận đơn hẹn giờ — hẹn từ khung giờ mở cửa gần nhất trở đi.
        </div>
      )}

      <div className="zm-seg" style={{ marginTop: 4 }}>
        <button className={type === 'delivery' ? 'on' : ''} disabled={isClosed} onClick={() => { switchType('delivery'); if (isClosed) setDeliveryMode('scheduled'); }}>🛵 Giao hàng</button>
        <button className={type === 'takeaway' ? 'on' : ''} disabled={isClosed} onClick={() => switchType('takeaway')}>🏃 Mang đi</button>
        <button className={type === 'scheduled' ? 'on' : ''} onClick={() => switchType('scheduled')}>⏰ Hẹn giờ lấy</button>
      </div>

      <div className="zm-field">
        <label>Tên trưởng nhóm *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="zm-field">
        <label>Số điện thoại * <span style={{ color: '#888', fontWeight: 400 }}>(để tích điểm thành viên)</span></label>
        <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="09xx xxx xxx" inputMode="tel" maxLength={12} />
      </div>

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
            <span style={{ fontSize: 24 }}>⚡</span>
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
            <span style={{ fontSize: 24 }}>📅</span>
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

          {/* Card thông tin nhận hàng — bấm mở popup (như đơn thường) */}
          <div className="zm-deliv-card" onClick={() => setShowAddrPop(true)}>
            <div className="zm-deliv-top">
              <div className="zm-deliv-ic">📍</div>
              <div className="zm-deliv-t">Thông tin nhận hàng</div>
              <div className="zm-deliv-chg">Thay đổi</div>
            </div>
            <div className="zm-deliv-mid">
              <div className="zm-deliv-uic">👤</div>
              <div style={{ flex: 1 }}>
                <div className="zm-deliv-nm">
                  {name || 'Nhập tên'} · {phone ? phone : <span className="zm-miss">Nhập số điện thoại</span>}
                </div>
                <div className="zm-deliv-ad">
                  {[street, wards.find((w) => String(w.code) === ward)?.name, provinces.find((pr) => String(pr.code) === province)?.name].filter(Boolean).join(', ') || 'Nhập địa chỉ'}
                </div>
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
                    <label>📒 Sổ địa chỉ</label>
                    <select value={addrId} onChange={(e) => {
                      const id = e.target.value;
                      setAddrId(id);
                      if (!id) return;
                      const a = addrBook.find((x) => String(x.id) === id);
                      if (!a) return;
                      const pc = provinces.find((p) => p.name === a.province)?.code;
                      if (pc) {
                        setProvince(String(pc));
                        loadWards(pc).then((ws) => {
                          setWards(ws || []);
                          const wc = (ws || []).find((w) => w.name === a.ward)?.code;
                          setWard(wc ? String(wc) : '');
                        });
                      }
                      setStreet(a.street || '');
                      setPickedCoord(null);
                    }}>
                      <option value="">— Nhập địa chỉ mới —</option>
                      {addrBook.map((a) => (
                        <option key={a.id} value={a.id}>{a.is_default ? '★ ' : ''}{a.label}: {a.full_address}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="zm-field">
                  <label>Tỉnh / Thành phố *</label>
                  <SearchSelect
                    value={province} placeholder="— Chọn tỉnh/thành —"
                    options={provinces.map((p) => ({ code: p.code, name: p.name }))}
                    onChange={(c) => { setProvince(c); setAddrId(''); setPickedCoord(null); }}
                  />
                </div>
                <div className="zm-field">
                  <label>Phường / Xã *</label>
                  <SearchSelect
                    value={ward} placeholder="— Chọn phường/xã —" disabled={!province}
                    options={wards.map((w) => ({ code: w.code, name: w.name }))}
                    onChange={(c) => { setWard(c); setPickedCoord(null); }}
                  />
                </div>
                <div className="zm-field">
                  <label>Số nhà, tên đường *</label>
                  <input
                    value={street}
                    onChange={(e) => { setStreet(e.target.value); setPickedCoord(null); }}
                    placeholder="VD: 123 Nguyễn Huệ"
                    autoComplete="off"
                  />
                </div>
                {geoLoading && <div className="zm-note">📍 Đang tự động tính khoảng cách...</div>}
                {km != null && shipCfg && (
                  <div className="zm-alert">📏 Khoảng cách ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b> (tự động tính)</div>
                )}
                {geoError && (
                  <div className="zm-alert" style={{ background: '#fef3c7', borderColor: '#fcd34d' }}>
                    ⚠️ Không tự tính được khoảng cách. Bạn vẫn đặt được — quán sẽ xác nhận phí ship qua điện thoại.
                    <button type="button" onClick={calcKm} style={{ marginLeft: 8, textDecoration: 'underline', color: '#b45309' }}>Tính lại</button>
                  </div>
                )}
                {quoteLoading && <div className="zm-note">🛵 Đang tính phí ship từ hãng giao hàng...</div>}
                {!quoteLoading && quote?.packages?.length > 0 && (
                  <div className="zm-field">
                    <label>Chọn gói giao hàng</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {quote.packages.map((p) => (
                        <button
                          key={p.code + p.provider}
                          type="button"
                          onClick={() => setDeliveryPkg(p.code)}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 12px', borderRadius: 10, fontSize: 13, textAlign: 'left',
                            border: deliveryPkg === p.code ? '2px solid #24305E' : '1px solid #e0e0e0',
                            background: deliveryPkg === p.code ? '#eef2ff' : '#fff',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700 }}>{p.code === 'nhanh' ? '🛵 Nhanh' : '⚡ Siêu Tốc'} <span style={{ color: '#888', fontWeight: 400 }}>· {p.provider_label}</span></div>
                            <div style={{ color: '#666', fontSize: 12 }}>{p.eta_text}{p.shop_support > 0 ? ` · Quán hỗ trợ ${fmt(p.shop_support)}đ` : ''}</div>
                          </div>
                          <div style={{ fontWeight: 700, color: '#24305E' }}>{fmt(p.customer_pays)}đ</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!quoteLoading && quoteError && !quote?.packages?.length && km == null && (
                  <div className="zm-alert" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
                    ⚠️ {quoteError}
                  </div>
                )}
                <div className="zm-field">
                  <label>Ghi chú giao hàng</label>
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
                <button type="button" className="zm-loc-btn" onClick={useCurrentLocation} disabled={locLoading}>
                  📍 {locLoading ? 'Đang lấy vị trí...' : 'Vị trí hiện tại'}
                </button>
                <p className="zm-loc-hint">Bấm "Vị trí hiện tại" để tự điền địa chỉ và tính phí ship chính xác, hoặc nhập tay rồi bấm Lưu.</p>
                <button className="zm-btn-primary zm-pop-save" onClick={() => setShowAddrPop(false)}>Lưu</button>
              </div>
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
      {(payMethods.length ? payMethods : [
        { value: 'transfer', label: 'Chuyển khoản / QR', desc: 'Quán xác nhận đã nhận tiền rồi mới làm món' },
        { value: 'pay_at_store', label: 'Thanh toán tại quán', desc: 'Trả tiền khi nhận món' },
      ]).map((m) => (
        <div key={m.value} className={`zm-pay-opt ${payment === m.value ? 'on' : ''}`} onClick={() => setPayment(m.value)}>
          <div className="dot" /><div><b>{m.label}</b><div style={{ fontSize: 12, color: '#888' }}>{m.desc}</div></div>
        </div>
      ))}

      {promos.length > 0 && (
        <div className="zm-field">
          <label>Khuyến mại</label>
          <select value={promoId} onChange={(e) => setPromoId(e.target.value)}>
            <option value="">Không dùng</option>
            {promos.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.is_shipping || p.type === 'shipping') ? `🚚 ${p.name} (−${fmt(p.discount)}đ phí ship)` : `${p.name} (−${fmt(p.discount)}đ)`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>🎟️ Mã giảm giá</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="zm-field" style={{ margin: 0, flex: 1 }}>
            <input value={voucher} onChange={(e) => { setVoucher(e.target.value); setVoucherInfo(null); }} placeholder="NHẬP MÃ NẾU CÓ" style={{ textTransform: 'uppercase' }} />
          </div>
          <button type="button" className="zm-btn-primary" style={{ padding: '0 14px', fontSize: 13 }}
            onClick={() => checkVoucher(voucher)}>
            Áp dụng
          </button>
        </div>
        {voucherInfo && (
          <div style={{ fontSize: 12, color: '#16a34a', marginTop: 6, fontWeight: 700 }}>
            ✅ {voucherInfo.code}: giảm {fmt(voucherInfo.discount)}đ{voucherWins ? '' : (promoDisc > 0 ? ' — KM hiện tại giảm nhiều hơn nên hệ thống sẽ áp KM (voucher không bị trừ lượt)' : '')}
          </div>
        )}
      </div>

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
          <span>Phí vận chuyển{quotePkg ? ` (${quotePkg.code === 'nhanh' ? 'Nhanh' : 'Siêu Tốc'} · ${quotePkg.provider_label})` : km != null ? ` (~${km}km)` : ''}</span>
          <span>{quotePkg || km != null ? `${fmt(shipFee)}đ` : 'Quán xác nhận'}</span>
        </div>
      )}
      {shipDisc > 0 && <div className="zm-total-row disc"><span>🚚 KM phí vận chuyển</span><span>−{fmt(shipDisc)}đ</span></div>}
      {/* 🟠8: hiển thị theo phía thắng thật giữa KM và voucher */}
      {voucherWins ? (
        <div className="zm-total-row disc"><span>🎟️ Voucher {voucherInfo.code}</span><span>−{fmt(voucherDisc)}đ</span></div>
      ) : (
        <>
          {promoDisc > 0 && <div className="zm-total-row disc"><span>🎉 {promo?.name}</span><span>−{fmt(promoDisc)}đ</span></div>}
          {voucherDisc > 0 && promoDisc > 0 && (
            <div className="zm-total-row" style={{ color: '#999', fontSize: 12 }}>
              <span>🎟️ Voucher {voucherInfo.code} (−{fmt(voucherDisc)}đ) không áp vì KM giảm nhiều hơn</span><span></span>
            </div>
          )}
        </>
      )}
      <div className="zm-total-row grand"><span>Tổng cộng</span><span>{fmt(grandTotal)}đ</span></div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="zm-btn-outline" style={{ width: 120 }} onClick={onBack}>← Quay lại</button>
        <button className="zm-btn-primary" disabled={placing} onClick={place} style={{ flex: 1 }}>
          {placing ? 'Đang đặt...' : 'Xác nhận đặt đơn nhóm'}
        </button>
      </div>
    </div>
  );
}
