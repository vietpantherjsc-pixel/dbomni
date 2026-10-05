import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, fmt } from '../api';
import { TabBar } from './Home';

const STEPS = [
  { key: 'pending', label: 'Đã đặt đơn' },
  { key: 'processing', label: 'Quán đang chuẩn bị' },
  { key: 'ready', label: 'Món đã sẵn sàng' },
  { key: 'completed', label: 'Hoàn thành' },
];
const ORDER = ['pending', 'processing', 'ready', 'completed'];

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

  const cancel = async () => {
    if (!confirm('Chắc chắn hủy đơn này?')) return;
    try {
      await api.cancelOrder(order.code);
      alert('Đã hủy đơn.');
      lookup(order.code);
    } catch (e) { alert(e.message); }
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
              {order.scheduled_at && ` · ⏰ Lấy lúc ${new Date(order.scheduled_at).toLocaleString('vi-VN')}`}
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
              <button className="zm-btn-outline" onClick={cancel}>Hủy đơn</button>
            </div>
          )}
        </>
      )}
      <TabBar />
    </div>
  );
}
