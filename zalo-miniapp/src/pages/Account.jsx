import React, { useState, useEffect, useRef } from 'react';
import { api, API, fmt, imgUrl, getProfile, setProfile } from '../api';
import { fmtDate } from '../utils/format';
import { TabBar } from './Home';

// Gói 11: Tài khoản đăng nhập bằng SĐT + Mã thành viên (bỏ tra cứu tự do bằng SĐT
// để tránh lộ thông tin khách hàng). Mã TV in trên thẻ/quét QR tại quầy.
// Gói 48: chỉ hiện điểm (ẩn tổng chi tiêu); carousel banner KM trước lịch sử đơn.

// Carousel banner KM trượt ngang tự động
function PromoCarousel() {
  const [banners, setBanners] = useState([]);
  const [idx, setIdx] = useState(0);
  const [intervalSec, setIntervalSec] = useState(5);
  const timer = useRef(null);

  useEffect(() => {
    api.promoBanners().then((r) => setBanners(r?.data || r || [])).catch(() => {});
    // Lấy thời gian trượt từ cài đặt (cùng API theme)
    fetch(`${API}/theme`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json()).then((d) => {
        const v = (d?.data || d)?.promo_slide_interval;
        if (v > 0) setIntervalSec(v);
      }).catch(() => {});
  }, []);

  useEffect(() => {
    if (banners.length < 2) return;
    timer.current = setInterval(() => setIdx((i) => (i + 1) % banners.length), intervalSec * 1000);
    return () => clearInterval(timer.current);
  }, [banners.length, intervalSec]);

  if (banners.length === 0) return null;
  return (
    <div style={{ marginTop: 12, position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', width: '100%', transform: `translateX(-${idx * 100}%)`, transition: 'transform .5s ease' }}>
        {banners.map((b) => (
          <img key={b.id} src={imgUrl(b.banner_url)} alt={b.name}
            style={{ width: '100%', flexShrink: 0, aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
        ))}
      </div>
      {banners.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', gap: 6, justifyContent: 'center' }}>
          {banners.map((b, i) => (
            <span key={b.id} onClick={() => setIdx(i)}
              style={{ width: 8, height: 8, borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,.5)', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Account() {
  const [phone, setPhone] = useState(() => getProfile()?.phone || '');
  const [memberCode, setMemberCode] = useState(() => getProfile()?.member_code || '');
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  // Gói 49: sổ địa chỉ
  const [addrBook, setAddrBook] = useState([]);

  const loadAddrs = (cid) => {
    api.addresses(cid).then((r) => setAddrBook(r?.data || [])).catch(() => {});
  };

  const doLookup = async (ph, mc, silent) => {
    setLoading(true);
    try {
      const c = await api.customerByPhone(ph.trim(), mc.trim());
      setCustomer(c);
      if (c) {
        // Gói 49g: lưu phiên đăng nhập (kèm customer_id cho sổ địa chỉ)
        setProfile({ name: c.name, phone: c.phone, member_code: c.member_code, customer_id: c.id });
        loadAddrs(c.id);
      }
      else if (!silent) alert('SĐT hoặc mã thành viên không đúng. Mã TV in trên thẻ thành viên của bạn.');
      return c;
    } catch (e) { if (!silent) alert(e.message); return null; }
    finally { setLoading(false); }
  };

  const lookup = () => {
    if (!phone.trim() || !memberCode.trim()) { alert('Nhập số điện thoại và mã thành viên.'); return; }
    doLookup(phone, memberCode, false);
  };

  // Gói 49g: tự động đăng nhập lại từ phiên đã lưu
  useEffect(() => {
    const p = getProfile();
    if (p?.phone && p?.member_code) {
      setPhone(p.phone);
      setMemberCode(p.member_code);
      doLookup(p.phone, p.member_code, true);
    }
  }, []);

  const logout = () => {
    setProfile(null);
    setCustomer(null);
    setPhone('');
    setMemberCode('');
  };

  return (
    <div className="zm-page">
      <div className="zm-header"><h1>Tài khoản</h1></div>
      {!customer && (
        <>
          <div className="zm-search" style={{ flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
            <input placeholder="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            <input placeholder="Mã thành viên (VD: TV6BDAFA)" value={memberCode} onChange={(e) => setMemberCode(e.target.value)} style={{ textTransform: 'uppercase' }} />
            <button className="zm-btn-primary" onClick={lookup} disabled={loading}>
              {loading ? '...' : 'Đăng nhập'}
            </button>
          </div>
          <div className="zm-note" style={{ margin: '0 16px' }}>
            Đăng nhập bằng SĐT + mã thành viên (in trên thẻ của bạn) để xem điểm, hạng và lịch sử đơn hàng.
          </div>
        </>
      )}

      {customer && (
        <div style={{ padding: '4px 16px' }}>
          <div style={{ background: 'linear-gradient(135deg, var(--zm-primary), color-mix(in srgb, var(--zm-primary) 70%, #000))', borderRadius: 16, padding: 20, color: '#fff' }}>
            <div style={{ fontSize: 13, opacity: .85 }}>Thẻ thành viên</div>
            <div style={{ fontSize: 20, fontWeight: 800, margin: '4px 0' }}>{customer.name}</div>
            <div style={{ fontSize: 13 }}>{customer.member_code} · Hạng {customer.tier || 'Regular'}</div>
            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              <div><div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(customer.points)}</div><div style={{ fontSize: 11, opacity: .85 }}>điểm</div></div>
            </div>
          </div>

          <PromoCarousel />

          {/* Gói 49: sổ địa chỉ */}
          <div className="zm-section-title" style={{ padding: '16px 0 8px' }}>📒 Sổ địa chỉ</div>
          {addrBook.length === 0 && <div className="zm-empty" style={{ padding: 16 }}>Chưa có địa chỉ nào. Địa chỉ sẽ tự lưu khi đặt hàng.</div>}
          {addrBook.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{a.is_default ? '★ ' : ''}{a.label}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{a.full_address}</div>
              </div>
              {!a.is_default && (
                <button style={{ fontSize: 12, color: '#0d6efd' }} onClick={async () => {
                  await api.updateAddress(a.id, { customer_id: customer.id, street: a.street, is_default: true });
                  loadAddrs(customer.id);
                }}>Đặt mặc định</button>
              )}
              <button style={{ fontSize: 12, color: '#dc2626' }} onClick={async () => {
                if (!confirm('Xóa địa chỉ này?')) return;
                await api.deleteAddress(a.id, customer.id);
                loadAddrs(customer.id);
              }}>Xóa</button>
            </div>
          ))}

          <div className="zm-section-title" style={{ padding: '16px 0 8px' }}>Đơn gần đây</div>
          {customer.orders.length === 0 && <div className="zm-empty" style={{ padding: 20 }}>Chưa có đơn nào.</div>}
          {customer.orders.map((o) => (
            <div key={o.id} className="zm-total-row" style={{ padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
              <span><b>{o.code}</b><br /><span style={{ fontSize: 12, color: '#888' }}>{fmtDate(o.created_at)} · {o.status}</span></span>
              <span><b>{fmt(o.total_amount)}đ</b></span>
            </div>
          ))}
          <button className="zm-btn-outline" style={{ margin: '20px 0 8px' }} onClick={logout}>Đăng xuất</button>
        </div>
      )}
      <TabBar />
    </div>
  );
}
