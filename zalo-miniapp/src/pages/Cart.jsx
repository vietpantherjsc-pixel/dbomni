import React from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from '../api';
import { useShop } from '../store';
import { TabBar } from './Home';
import ZmIcon from '../components/ZmIcon';

export default function Cart() {
  const { cart, updateQty, subtotal, count } = useShop();
  const nav = useNavigate();

  if (cart.length === 0) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Giỏ hàng</h1></div>
        <div className="zm-empty"><ZmIcon name="cart" size={48} /><br />Giỏ hàng trống.<br />Quay lại chọn món ngon nhé!</div>
        <div className="zm-cartbar above-tab"><button className="zm-btn-primary" onClick={() => nav('/')}>Xem thực đơn</button></div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Giỏ hàng ({count})</h1></div>
      {cart.map((l) => (
        <div key={l.key} className="zm-row-item" style={{ cursor: 'default' }}>
          <img src={l.product.image_url || '/default-product.svg'} alt="" onError={(e) => { if (!e.target.src.endsWith('/default-product.svg')) e.target.src = '/default-product.svg'; }} />
          <div className="zm-row-info">
            <div className="zm-row-name">{l.product.name}</div>
            {/* 🟡13 UX 2026-10-26: ở Giỏ hiện ĐẦY ĐỦ tùy chọn/ghi chú (bỏ clamp 2 dòng của .zm-row-desc) để khách kiểm lại trước thanh toán */}
            {l.optText && <div className="zm-row-desc" style={{ display: 'block', WebkitLineClamp: 'unset', overflow: 'visible' }}>{l.optText}</div>}
            {l.note && <div className="zm-row-desc" style={{ display: 'block', WebkitLineClamp: 'unset', overflow: 'visible' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="note" size={12} />{l.note}</span></div>}
            <div className="zm-row-price">{fmt(l.unitPrice * l.qty)}đ</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div className="zm-qty">
              <button onClick={() => updateQty(l.key, -1)}>−</button>
              <span>{l.qty}</span>
              <button onClick={() => updateQty(l.key, 1)}>+</button>
            </div>
            {/* 🟡13: nút xóa dòng riêng (trước đây phải trừ về 0; store trừ về 0 = xóa dòng) */}
            <button onClick={() => updateQty(l.key, -l.qty)} style={{ border: 'none', background: 'none', color: '#b91c1c', fontSize: 12, fontWeight: 700, cursor: 'pointer', minHeight: 32, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="x" size={12} />Xóa</button>
          </div>
        </div>
      ))}
      <div style={{ padding: '14px 16px' }}>
        <div className="zm-total-row grand"><span>Tạm tính</span><span>{fmt(subtotal)}đ</span></div>
        <div className="zm-note">Phí ship (nếu giao hàng), khuyến mại và điểm tích lũy sẽ tính ở bước thanh toán.</div>
      </div>
      <div className="zm-cartbar above-tab">
        {/* Đợt fix rà soát VPS (S7): nhãn cũ "Tiếp tục đặt món" gây hiểu là quay lại thực đơn
            để gọi thêm, trong khi nút đi thẳng tới trang thanh toán → đổi nhãn theo hành vi thật. */}
        <button className="zm-btn-primary" onClick={() => nav('/checkout')}>Đi tới thanh toán</button>
      </div>
      <TabBar />
    </div>
  );
}
