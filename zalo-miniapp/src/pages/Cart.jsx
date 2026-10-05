import React from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from '../api';
import { useShop } from '../store';
import { TabBar } from './Home';

export default function Cart() {
  const { cart, updateQty, subtotal, count } = useShop();
  const nav = useNavigate();

  if (cart.length === 0) {
    return (
      <div className="zm-page">
        <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Giỏ hàng</h1></div>
        <div className="zm-empty">🛒<br />Giỏ hàng trống.<br />Quay lại chọn món ngon nhé!</div>
        <div className="zm-cartbar"><button className="zm-btn-primary" onClick={() => nav('/')}>Xem thực đơn</button></div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="zm-page">
      <div className="zm-header"><button className="zm-back" onClick={() => nav('/')}>←</button><h1>Giỏ hàng ({count})</h1></div>
      {cart.map((l) => (
        <div key={l.key} className="zm-row-item" style={{ cursor: 'default' }}>
          <img src={l.product.image_url || 'https://via.placeholder.com/100?text=☕'} alt="" />
          <div className="zm-row-info">
            <div className="zm-row-name">{l.product.name}</div>
            {l.optText && <div className="zm-row-desc">{l.optText}</div>}
            {l.note && <div className="zm-row-desc">📝 {l.note}</div>}
            <div className="zm-row-price">{fmt(l.unitPrice * l.qty)}đ</div>
          </div>
          <div className="zm-qty">
            <button onClick={() => updateQty(l.key, -1)}>−</button>
            <span>{l.qty}</span>
            <button onClick={() => updateQty(l.key, 1)}>+</button>
          </div>
        </div>
      ))}
      <div style={{ padding: '14px 16px' }}>
        <div className="zm-total-row grand"><span>Tạm tính</span><span>{fmt(subtotal)}đ</span></div>
        <div className="zm-note">Phí ship (nếu giao hàng), khuyến mại và điểm tích lũy sẽ tính ở bước thanh toán.</div>
      </div>
      <div className="zm-cartbar">
        <button className="zm-btn-primary" onClick={() => nav('/checkout')}>Tiếp tục đặt món</button>
      </div>
      <TabBar />
    </div>
  );
}
