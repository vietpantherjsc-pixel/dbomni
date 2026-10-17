import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, fmt, getProfile } from '../api';
import { fmtDateTime } from '../utils/format';
import { TabBar } from './Home';

const STEPS = [
  { key: 'pending', label: 'Đã đặt đơn' },
  { key: 'processing', label: 'Quán đang chuẩn bị' },
  { key: 'ready', label: 'Món đã sẵn sàng' },
  { key: 'completed', label: 'Hoàn thành' },
];
const ORDER = ['pending', 'processing', 'ready', 'completed'];

// Gói 60: timeline giao hàng (từ webhook hãng, poll 5s)
const DELIVERY_STEPS = [
  { key: 'searching_driver', label: 'Đang tìm tài xế' },
  { key: 'driver_assigned', label: 'Tài xế đang tới lấy' },
  { key: 'picked_up', label: 'Đã lấy hàng' },
  { key: 'delivering', label: 'Đang giao tới bạn' },
  { key: 'delivered', label: 'Giao thành công' },
];
const DELIVERY_ORDER = DELIVERY_STEPS.map((s) => s.key);

export default function TrackOrder() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [code, setCode] = useState(params.get('code') || '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);

  const lookup = async (c) => {
    const cd = (c || code).trim();
    if (!cd) return;
    setLoading(true);
    try {
      const o = await api.trackOrder(cd);
      setOrder(o);
    } catch (e) { alert(e.message); setOrder(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (params.get('code')) lookup(params.get('code')); }, []);

  // Gói 11: tự tải lại trạng thái mỗi 5s (không cần F5 tay)
  useEffect(() => {
    const cd = (params.get('code') || '').trim();
    if (!cd) return;
    const t = setInterval(() => {
      api.trackOrder(cd).then(setOrder).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const [cancelling, setCancelling] = useState(false);
  const cancel = async () => {
    if (!confirm('Chắc chắn hủy đơn này?')) return;
    // Gói SEC2: gửi SĐT đặt đơn để server xác thực người hủy
    let phone = getProfile()?.phone || '';
    if (!phone) {
      phone = prompt('Nhập SĐT đã dùng để đặt đơn (để xác nhận hủy):') || '';
      phone = phone.trim();
    }
    if (!phone) { alert('Cần SĐT đặt đơn để hủy.'); return; }
    setCancelling(true);
    try {
      await api.cancelOrder(order.code, phone);
      alert('Đã hủy đơn.');
      lookup(order.code);
    } catch (e) { alert(e.message); }
    finally { setCancelling(false); }
  };

  const stepIdx = order ? ORDER.indexOf(order.status) : -1;

  return (
    <div className="zm-page">
      <div className="zm-header"><h1>Theo dõi đơn hàng</h1></div>
      <div className="zm-search">
        <input placeholder="Nhập mã đơn (VD: ZL-...)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button className="zm-btn-outline" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => lookup()}>Tìm</button>
      </div>
      {loading && <div className="zm-empty">Đang tải...</div>}
      {order && (
        <>
          <div style={{ padding: '4px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 16 }}>{order.code}</b>
              <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: order.status === 'cancelled' ? '#ffebee' : 'color-mix(in srgb, var(--zm-primary) 12%, #fff)', color: order.status === 'cancelled' ? '#c62828' : 'var(--zm-primary)', fontWeight: 700 }}>
                {order.status === 'cancelled' ? 'Đã hủy' : STEPS.find((s) => s.key === order.status)?.label || order.status}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
              {order.order_type === 'delivery' ? '🛵 Giao hàng' : '🏃 Mang đi'} · {order.payment_method === 'transfer' ? 'Chuyển khoản' : 'Trả tại quán'}
              {order.payment_status === 'pending' && order.payment_method === 'transfer' && ' · ⏳ Chờ quán xác nhận tiền'}
              {order.scheduled_at && ` · ⏰ Lấy lúc ${fmtDateTime(order.scheduled_at)}`}
            </div>
          </div>

          {order.status !== 'cancelled' && (
            <div className="zm-timeline">
              {STEPS.map((s, i) => (
                <div key={s.key} className={`zm-step ${i <= stepIdx ? 'done' : ''}`}>
                  <div className="dot2">{i <= stepIdx ? '✓' : i + 1}</div>
                  <div className="lbl">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Gói 60: trạng thái giao hàng live */}
          {order.delivery?.status && !['failed', 'cancelled'].includes(order.delivery.status) && (
            <div style={{ margin: '8px 16px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                🛵 Giao hàng · {order.delivery.provider_label || ''}
                {order.delivery.failover_from && (
                  <span style={{ marginLeft: 6, fontSize: 11, background: '#fff7e6', color: '#b45309', border: '1px solid #fcd34d', borderRadius: 10, padding: '2px 8px' }}>
                    Đã chuyển hãng
                  </span>
                )}
              </div>
              <div className="zm-timeline" style={{ margin: 0 }}>
                {DELIVERY_STEPS.map((s, i) => {
                  const cur = DELIVERY_ORDER.indexOf(order.delivery.status);
                  return (
                    <div key={s.key} className={`zm-step ${i <= cur ? 'done' : ''}`}>
                      <div className="dot2">{i <= cur ? '✓' : i + 1}</div>
                      <div className="lbl">{s.label}</div>
                    </div>
                  );
                })}
              </div>
              {order.delivery.driver_name && (
                <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
                  👤 Tài xế: <b>{order.delivery.driver_name}</b>
                  {order.delivery.driver_phone && <> · <a href={`tel:${order.delivery.driver_phone}`}>{order.delivery.driver_phone}</a></>}
                  {order.delivery.driver_plate && <> · 🚗 {order.delivery.driver_plate}</>}
                </div>
              )}
              {order.delivery.tracking_url && (
                <a href={order.delivery.tracking_url} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', marginTop: 8, fontSize: 13, color: '#24305E', fontWeight: 700 }}>
                  📍 Theo dõi vị trí tài xế →
                </a>
              )}
            </div>
          )}
          {order.delivery?.status === 'failed' && (
            <div style={{ margin: '8px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12, fontSize: 13, color: '#991b1b' }}>
              ⚠️ Hiện chưa tìm được tài xế. Quán sẽ liên hệ với bạn ngay để chọn: chờ thêm / nhận tại quán / hủy hoàn tiền.
            </div>
          )}

          <div style={{ padding: '8px 16px' }}>
            <div className="zm-section-title" style={{ padding: '8px 0' }}>Món đã đặt</div>
            {/* Gói 10d: bảng món — tên riêng 1 dòng in đậm, mỗi tùy chọn 1 dòng */}
            <div className="zm-ot-head">
              <span className="c-name">Món</span>
              <span className="c-qty">SL</span>
              <span className="c-price">Đơn giá</span>
              <span className="c-total">Thành tiền</span>
            </div>
            {order.items.map((it, i) => {
              const parts = (it.note || '').split(' | ');
              const options = parts[0] ? parts[0].split(', ').filter(Boolean) : [];
              const freeNote = parts.slice(1).join(' | ');
              return (
                <div key={i} className="zm-ot-row">
                  <span className="c-name">
                    <b>{it.name}</b>
                    {options.map((o, j) => <span key={j} className="zm-ot-opt">• {o}</span>)}
                    {freeNote && <span className="zm-ot-note">📝 {freeNote}</span>}
                  </span>
                  <span className="c-qty">{it.quantity}</span>
                  <span className="c-price">{fmt(it.unit_price)}đ</span>
                  <span className="c-total">{fmt(it.unit_price * it.quantity)}đ</span>
                </div>
              );
            })}
            <div className="zm-total-row grand"><span>Tổng</span><span>{fmt(order.total_amount)}đ</span></div>
          </div>

          {order.status === 'pending' && order.payment_status === 'pending' && (
            <div style={{ padding: '8px 16px' }}>
              <button className="zm-btn-outline" onClick={cancel} disabled={cancelling}>{cancelling ? 'Đang hủy...' : 'Hủy đơn'}</button>
            </div>
          )}
        </>
      )}
      <TabBar />
    </div>
  );
}
