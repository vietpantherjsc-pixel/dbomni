import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmt, getProfile, setProfile, getRef } from '../api';
import { geocodeAddress, haversineKm, calcShipFee } from '../utils/geo';
import { useShop } from '../store';

export default function Checkout() {
  const { branch, cart, subtotal, clearCart } = useShop();
  const nav = useNavigate();
  const [type, setType] = useState('delivery'); // delivery | takeaway | scheduled
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [km, setKm] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [shipCfg, setShipCfg] = useState(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [payment, setPayment] = useState('transfer');
  const [promos, setPromos] = useState([]);
  const [promoId, setPromoId] = useState('');
  const [voucher, setVoucher] = useState('');
  const [points, setPoints] = useState(0);
  const [redeem, setRedeem] = useState(0);
  // Gói 13: tỉ giá đổi điểm từ server (không hardcode). Mặc định 10đ = 1.000đ nếu server chưa trả.
  const [redeemRate, setRedeemRate] = useState({ points: 10, amount: 1000 });
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);

  // Gói 10c: xóa lựa chọn KM khi nó không còn trong danh sách đủ điều kiện (VD: đổi km)
  useEffect(() => {
    if (promoId && promos.length > 0 && !promos.some((p) => String(p.id) === String(promoId))) setPromoId('');
  }, [promos]);

  useEffect(() => {
    if (!branch) { nav('/branches'); return; }
    if (cart.length === 0) { nav('/'); return; }
    const p = getProfile();
    if (p) { setName(p.name || ''); setPhone(p.phone || ''); }
    api.shipConfig().then(setShipCfg).catch(() => {});
  }, []);

  // Nạp KM đủ điều kiện + điểm KH khi có SĐT
  // Gói 10c: gửi kèm shipping_fee để server tính KM phí ship; load lại khi km đổi
  useEffect(() => {
    if (!phone || phone.length < 9) return;
    const fee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
    const t = setTimeout(() => {
      const payload = {
        subtotal,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty, line_total: l.unitPrice * l.qty })),
        shipping_fee: fee,
      };
      // Gói 13: truyền member_code từ profile (Gói 11 yêu cầu backend bắt buộc member_code)
      api.customerByPhone(phone, getProfile()?.member_code || '').then((c) => {
        if (c) {
          setPoints(c.points || 0);
          // Gói 13: lấy tỉ giá đổi điểm từ server
          if (c.redeem_points && c.redeem_amount) {
            setRedeemRate({ points: Number(c.redeem_points), amount: Number(c.redeem_amount) });
          }
          return api.eligiblePromotions({ ...payload, customer_id: c.id });
        }
        return api.eligiblePromotions({ ...payload, channel: 'online' });
      }).then(setPromos).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [phone, subtotal, km, shipCfg, type]);

  const calcDist = async () => {
    if (!address.trim()) { alert('Nhập địa chỉ nhận hàng trước.'); return; }
    if (!branch.latitude || !branch.longitude) {
      alert('Quán chưa cài tọa độ chi nhánh — Đại Vương cần nhập tọa độ trong quản trị. Tạm thời nhập số km thủ công.');
      return;
    }
    setGeoLoading(true);
    try {
      const g = await geocodeAddress(address + ', Việt Nam');
      const d = haversineKm(Number(branch.latitude), Number(branch.longitude), g.lat, g.lng);
      setKm(Math.round(d * 10) / 10);
    } catch (e) {
      alert(e.message);
    } finally { setGeoLoading(false); }
  };

  const shipFee = type === 'delivery' && km != null && shipCfg ? calcShipFee(km, shipCfg) : 0;
  const promo = promos.find((p) => String(p.id) === String(promoId));
  // Gói 10c: KM phí ship trừ thẳng vào phí ship (không cộng vào discount chung)
  const isShipPromo = !!(promo && (promo.is_shipping || promo.type === 'shipping') && type === 'delivery');
  const shipDisc = isShipPromo ? Math.min(Number(promo.discount) || 0, shipFee) : 0;
  const promoDisc = promo && !isShipPromo ? Number(promo.discount) : 0;
  const pointDisc = Math.min(redeem, points) * (redeemRate.amount / redeemRate.points); // Gói 13: tỉ giá từ server
  const total = Math.max(0, subtotal + shipFee - shipDisc - promoDisc - pointDisc);

  const place = async () => {
    if (!name.trim() || !phone.trim()) { alert('Nhập tên và số điện thoại.'); return; }
    if (type === 'delivery' && (!address.trim() || km == null)) { alert('Nhập địa chỉ và bấm "Tính khoảng cách".'); return; }
    if (type === 'scheduled' && !scheduledAt) { alert('Chọn giờ muốn tới lấy.'); return; }
    setPlacing(true);
    try {
      const order = await api.createOrder({
        branch_id: branch.id,
        order_type: type === 'delivery' ? 'delivery' : 'takeaway',
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        delivery_address: type === 'delivery' ? address.trim() : null,
        distance_km: type === 'delivery' ? km : null,
        scheduled_at: type === 'scheduled' ? scheduledAt : null,
        payment_method: payment,
        voucher_code: voucher.trim() || null,
        promotion_id: promoId || null,
        points_redeem: redeem || null,
        note: note.trim() || null,
        referred_by: getRef() || null, // Gói 9: mã giới thiệu (?ref=)
        items: cart.map((l) => ({
          product_id: l.product.id,
          product_option_id: l.optionId || null,
          option_ids: l.optionIds || [],
          quantity: l.qty,
          note: [l.optText, l.note].filter(Boolean).join(' | ') || null,
        })),
      });
      setProfile({ ...(getProfile() || {}), name: name.trim(), phone: phone.trim() }); // Gói 9: giữ member_code
      clearCart();
      nav(`/success/${order.code}`);
    } catch (e) {
      alert(e.message);
    } finally { setPlacing(false); }
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav('/cart')}>←</button><h1>Xác nhận đơn</h1></div>

      <div style={{ padding: '12px 16px 0' }}>
        <div className="zm-seg">
          <button className={type === 'delivery' ? 'on' : ''} onClick={() => setType('delivery')}>🛵 Giao hàng</button>
          <button className={type === 'takeaway' ? 'on' : ''} onClick={() => setType('takeaway')}>🏃 Mang đi</button>
          <button className={type === 'scheduled' ? 'on' : ''} onClick={() => setType('scheduled')}>⏰ Hẹn giờ lấy</button>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div className="zm-field">
          <label>Tên của bạn *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />
        </div>
        <div className="zm-field">
          <label>Số điện thoại * <span style={{ color: '#888', fontWeight: 400 }}>(để tích điểm thành viên)</span></label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" inputMode="tel" />
        </div>

        {type === 'delivery' && (
          <>
            <div className="zm-field">
              <label>Địa chỉ nhận hàng *</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Số nhà, đường, phường/quận..." />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button className="zm-btn-outline" style={{ width: 'auto', flex: 1 }} onClick={calcDist} disabled={geoLoading}>
                {geoLoading ? 'Đang tìm...' : '📍 Tính khoảng cách'}
              </button>
              <input
                style={{ width: 110, border: '1px solid #e0e0e0', borderRadius: 12, padding: 10, fontSize: 14 }}
                placeholder="km"
                type="number" step="0.1" min="0"
                value={km ?? ''}
                onChange={(e) => setKm(e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            {km != null && shipCfg && shipFee > 0 && (
              <div className="zm-alert">📏 Khoảng cách ~{km}km → Phí ship <b>{fmt(shipFee)}đ</b> (tự cộng vào "Phí dịch vụ")</div>
            )}
          </>
        )}

        {type === 'scheduled' && (
          <div className="zm-field">
            <label>Giờ muốn tới lấy *</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        )}

        <div className="zm-field">
          <label>Phương thức thanh toán</label>
        </div>
        <div className={`zm-pay-opt ${payment === 'transfer' ? 'on' : ''}`} onClick={() => setPayment('transfer')}>
          <div className="dot" /><div><b>Chuyển khoản / QR</b><div style={{ fontSize: 12, color: '#888' }}>Quán xác nhận đã nhận tiền rồi mới làm món</div></div>
        </div>
        <div className={`zm-pay-opt ${payment === 'pay_at_store' ? 'on' : ''}`} onClick={() => setPayment('pay_at_store')}>
          <div className="dot" /><div><b>Thanh toán tại quán</b><div style={{ fontSize: 12, color: '#888' }}>Trả tiền khi nhận món</div></div>
        </div>

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
        <div className="zm-field">
          <label>Mã voucher</label>
          <input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="Nhập mã nếu có" style={{ textTransform: 'uppercase' }} />
        </div>
        {points > 0 && (
          <div className="zm-field">
            <label>Đổi điểm ({fmt(points)} điểm khả dụng)</label>
            <input type="number" min="0" max={points} value={redeem} onChange={(e) => setRedeem(Number(e.target.value))} placeholder="Nhập số điểm muốn đổi" />
          </div>
        )}
        <div className="zm-field">
          <label>Ghi chú</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho quán..." />
        </div>

        <div style={{ margin: '8px 0 16px' }}>
          <div className="zm-total-row"><span>Tạm tính ({cart.reduce((s, l) => s + l.qty, 0)} món)</span><span>{fmt(subtotal)}đ</span></div>
          {/* Hiện phí gốc, KM trừ ở dòng riêng — tránh nhìn như trừ 2 lần */}
          {type === 'delivery' && shipFee > 0 && <div className="zm-total-row"><span>Phí dịch vụ (ship ~{km ?? '?'}km)</span><span>{fmt(shipFee)}đ</span></div>}
          {shipDisc > 0 && <div className="zm-total-row disc"><span>🚚 KM phí vận chuyển</span><span>−{fmt(shipDisc)}đ</span></div>}
          {promoDisc > 0 && <div className="zm-total-row disc"><span>Khuyến mại</span><span>−{fmt(promoDisc)}đ</span></div>}
          {pointDisc > 0 && <div className="zm-total-row disc"><span>Đổi điểm</span><span>−{fmt(pointDisc)}đ</span></div>}
          <div className="zm-total-row grand"><span>Tổng cộng</span><span>{fmt(total)}đ</span></div>
        </div>
      </div>

      <div className="zm-cartbar">
        <button className="zm-btn-primary" disabled={placing} onClick={place}>
          {placing ? 'Đang đặt món...' : `Đặt món · ${fmt(total)}đ`}
        </button>
      </div>
    </div>
  );
}
