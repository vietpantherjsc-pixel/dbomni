import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, fmt, getMyGroups, saveMyGroup, getRef } from '../api';
import { useShop } from '../store';
import ProductSheet from '../components/ProductSheet';
import { TabBar } from './Home';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';

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
  useEffect(() => { api.menu().then(setMenu).catch(() => {}); }, []);

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
  const img = (p) => p.image_url || 'https://via.placeholder.com/300?text=☕';

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
                    <div className="zm-row-price">{fmt(p.base_price)}đ</div>
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
              <img src={it.image_url || 'https://via.placeholder.com/100?text=☕'} alt={it.product_name} />
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
              {isLeader ? (
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

      {tab === 'checkout' && isLeader && (
        <GroupCheckout group={group} onDone={(orderCode) => nav(`/success/${orderCode}`)} onBack={() => setTab('summary')} />
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
function GroupCheckout({ group, onDone, onBack }) {
  const { branch } = useShop();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('takeaway');
  const [address, setAddress] = useState('');
  const [km, setKm] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [shipCfg, setShipCfg] = useState(null);
  const [payment, setPayment] = useState('transfer');
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    const g = getMyGroups()[group.code];
    if (g) setName(g.name);
    api.shipConfig().then(setShipCfg).catch(() => {});
  }, [group.code]);

  const b = branch || {};
  const calcDist = async () => {
    if (!address.trim()) { alert('Nhập địa chỉ nhận hàng trước.'); return; }
    if (!b.latitude || !b.longitude) { alert('Quán chưa cài tọa độ chi nhánh. Nhập số km thủ công.'); return; }
    setGeoLoading(true);
    try {
      const g = await geocodeAddress(address + ', Việt Nam');
      setKm(Math.round(haversineKm(Number(b.latitude), Number(b.longitude), g.lat, g.lng) * 10) / 10);
    } catch (e) { alert(e.message); }
    finally { setGeoLoading(false); }
  };

  const shipFee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;

  const place = async () => {
    if (!name.trim() || !phone.trim()) { alert('Nhập tên và số điện thoại.'); return; }
    if (type === 'delivery' && (!address.trim() || km == null)) { alert('Nhập địa chỉ và bấm "Tính khoảng cách".'); return; }
    setPlacing(true);
    try {
      const order = await api.groupCheckout(group.code, {
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        order_type: type,
        delivery_address: type === 'delivery' ? address.trim() : null,
        distance_km: type === 'delivery' ? km : null,
        payment_method: payment,
        note: note.trim() || null,
        referred_by: getRef() || null,
      });
      onDone(order.code);
    } catch (e) { alert(e.message); }
    finally { setPlacing(false); }
  };

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div className="zm-alert" style={{ margin: "12px 0" }}>👥 Chốt đơn nhóm <b>{group.code}</b> — {group.total_qty} món · {fmt(group.subtotal)}đ. Tên từng người đã ghi trong ghi chú từng món.</div>

      <div className="zm-seg" style={{ marginTop: 12 }}>
        <button className={type === 'takeaway' ? 'on' : ''} onClick={() => setType('takeaway')}>🏃 Mang đi</button>
        <button className={type === 'delivery' ? 'on' : ''} onClick={() => setType('delivery')}>🛵 Giao hàng</button>
      </div>

      <div className="zm-field">
        <label>Tên trưởng nhóm *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="zm-field">
        <label>Số điện thoại *</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
      </div>

      {type === 'delivery' && (
        <>
          <div className="zm-field">
            <label>Địa chỉ nhận hàng *</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button className="zm-btn-outline" style={{ width: 'auto', flex: 1 }} onClick={calcDist} disabled={geoLoading}>
              {geoLoading ? 'Đang tìm...' : '📍 Tính khoảng cách'}
            </button>
            <input
              style={{ width: 110, border: '1px solid #e0e0e0', borderRadius: 12, padding: 10, fontSize: 14 }}
              placeholder="km" type="number" step="0.1" min="0"
              value={km ?? ''} onChange={(e) => setKm(e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
          {km != null && shipCfg && shipFee > 0 && <div className="zm-alert" style={{ margin: "0 0 12px" }}>📏 ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b></div>}
        </>
      )}

      <div className="zm-field"><label>Phương thức thanh toán</label></div>
      <div className={`zm-pay-opt ${payment === 'transfer' ? 'on' : ''}`} onClick={() => setPayment('transfer')}>
        <div className="dot" /><div><b>Chuyển khoản / QR</b></div>
      </div>
      <div className={`zm-pay-opt ${payment === 'pay_at_store' ? 'on' : ''}`} onClick={() => setPayment('pay_at_store')}>
        <div className="dot" /><div><b>Thanh toán tại quán</b></div>
      </div>

      <div className="zm-field">
        <label>Ghi chú</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho quán..." />
      </div>

      <div className="zm-total-row grand"><span>Tổng cộng</span><span>{fmt(group.subtotal + shipFee)}đ</span></div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="zm-btn-outline" style={{ width: 120 }} onClick={onBack}>← Quay lại</button>
        <button className="zm-btn-primary" disabled={placing} onClick={place} style={{ flex: 1 }}>
          {placing ? 'Đang đặt...' : 'Xác nhận đặt đơn nhóm'}
        </button>
      </div>
    </div>
  );
}
