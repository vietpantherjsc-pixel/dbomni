import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useShop } from '../store';
import { openStatus } from '../utils/openingHours';
import ZmIcon from '../components/ZmIcon';

export default function BranchSelect() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(''); // Lát 3b: lý do khi lần chọn bị chặn
  const { setBranch } = useShop();
  const nav = useNavigate();

  useEffect(() => {
    api.branches().then(setBranches).catch(() => alert('Không tải được chi nhánh')).finally(() => setLoading(false));
  }, []);

  // Lát 3b (2026-11-04): setBranch trả false khi giỏ còn món của CN khác —
  // ở lại trang và nói rõ lý do thay vì im lặng như window.confirm trước đây.
  const choose = (b) => {
    if (setBranch(b)) { nav('/'); return; }
    setNotice('Giỏ hàng đang có món của chi nhánh hiện tại nên chưa đổi được chi nhánh. Bạn hãy thanh toán hoặc xóa giỏ trước khi đổi nhé.');
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><h1>Chọn chi nhánh</h1></div>
      {notice && (
        <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 12, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 13, lineHeight: 1.5 }}>
          ⚠ {notice}
          <div style={{ marginTop: 8 }}>
            <button className="zm-chip" onClick={() => nav('/cart')}>Xem giỏ hàng</button>
          </div>
        </div>
      )}
      {loading && <div className="zm-empty">Đang tải...</div>}
      {/* Lát 3a (2026-11-04): thẻ chi nhánh hiện đủ địa chỉ + SĐT + giờ/trạng thái
          mở cửa — mọi trường đều lấy thẳng từ phản hồi API /online/branches của
          lần tải này, không qua cache đã lưu, để không còn lệch dữ kiện như #27. */}
      {!loading && branches.map((b) => {
        const st = openStatus(b);
        return (
          <div key={b.id} className="zm-row-item" onClick={() => choose(b)}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--zm-primary) 12%, #fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}><ZmIcon name="store" size={22} /></div>
            <div className="zm-row-info">
              <div className="zm-row-name">{b.name}</div>
              <div className="zm-row-desc">{b.address || 'Xem địa chỉ khi đặt món'}</div>
              {b.phone && <div className="zm-row-desc"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZmIcon name="phone" size={13} />{b.phone}</span></div>}
              {st && (
                <div className="zm-row-desc">
                  <span className={st.open ? 'zm-open' : 'zm-closed'}>{st.open ? 'Đang mở cửa' : 'Đã đóng cửa'}</span>
                  {st.hours && <span> · {st.hours}</span>}
                </div>
              )}
            </div>
            <span style={{ color: 'var(--zm-primary)', fontWeight: 700 }}>›</span>
          </div>
        );
      })}
      {!loading && branches.length === 0 && <div className="zm-empty">Chưa có chi nhánh nào.</div>}
    </div>
  );
}
