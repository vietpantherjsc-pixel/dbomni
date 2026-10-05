import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useShop } from '../store';

export default function BranchSelect() {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setBranch } = useShop();
  const nav = useNavigate();

  useEffect(() => {
    api.branches().then(setBranches).catch(() => alert('Không tải được chi nhánh')).finally(() => setLoading(false));
  }, []);

  const choose = (b) => { setBranch(b); nav('/'); };

  return (
    <div className="zm-page">
      <div className="zm-header"><h1>Chọn chi nhánh</h1></div>
      {loading && <div className="zm-empty">Đang tải...</div>}
      {!loading && branches.map((b) => (
        <div key={b.id} className="zm-row-item" onClick={() => choose(b)}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--zm-primary) 12%, #fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🏪</div>
          <div className="zm-row-info">
            <div className="zm-row-name">{b.name}</div>
            <div className="zm-row-desc">{b.address || 'Xem địa chỉ khi đặt món'}</div>
          </div>
          <span style={{ color: 'var(--zm-primary)', fontWeight: 700 }}>›</span>
        </div>
      ))}
      {!loading && branches.length === 0 && <div className="zm-empty">Chưa có chi nhánh nào.</div>}
    </div>
  );
}
