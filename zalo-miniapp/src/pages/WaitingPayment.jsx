import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { api, getProfile } from '../api';
import TransferGuide from '../components/TransferGuide';

// Spec Thanh toán QR (2026-10-21) — màn hình "Chờ thanh toán" (L15, trạng thái mới):
// hiện ngay sau đặt đơn BANK (kể cả khi mở Checkout SDK thất bại — không còn
// Success im lặng), và là nơi khách quay lại trả sau. Dữ liệu CK lấy từ state
// điều hướng; thiếu state (mở lại link) thì nạp qua API theo dõi đơn.
export default function WaitingPayment() {
  const { code } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [transfer, setTransfer] = useState(loc.state?.transfer || null);
  const [notifiedAt, setNotifiedAt] = useState(null);
  const [gone, setGone] = useState(false); // đơn đã được xác nhận tiền / không còn chờ
  const [cancelling, setCancelling] = useState(false);

  // Audit 2026-10-21 🟠12: khách đổi ý khi đang chờ CK phải có đường HỦY ngay tại đây
  // (trước đây màn này không có nút hủy — đơn treo vô thời hạn). Xác thực bằng SĐT
  // đặt đơn như TrackOrder; hủy xong về trang chủ.
  const cancelOrder = async () => {
    if (!window.confirm('Chắc chắn hủy đơn này? Nếu bạn đã chuyển khoản rồi, hãy liên hệ quán thay vì hủy.')) return;
    let phone = getProfile()?.phone || '';
    if (!phone) {
      phone = (prompt('Nhập SĐT đã dùng để đặt đơn (để xác nhận hủy):') || '').trim();
    }
    if (!phone) { alert('Cần SĐT đặt đơn để hủy.'); return; }
    setCancelling(true);
    try {
      await api.cancelOrder(code, phone);
      alert('Đã hủy đơn.');
      nav('/', { replace: true });
    } catch (e) {
      alert(e.message || 'Không hủy được đơn.');
      setCancelling(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.trackOrder(code, getProfile()?.phone || '').then((o) => {
        if (!alive) return;
        if (o.transfer) {
          setTransfer(o.transfer);
          setNotifiedAt(o.customer_notified_at || null);
        } else if (['confirmed', 'paid', 'completed'].includes(o.payment_status) || o.status !== 'pending') {
          setGone(true); // NV đã xác nhận → sang trang theo dõi
        }
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000); // NV xác nhận xong → khối CK biến mất
    return () => { alive = false; clearInterval(t); };
  }, [code]);

  useEffect(() => {
    if (gone) nav(`/track?code=${code}`, { replace: true });
  }, [gone, code, nav]);

  return (
    <div className="zm-page" style={{ paddingBottom: 24 }}>
      <div style={{ textAlign: 'center', paddingTop: 40 }}>
        <div style={{ fontSize: 56 }}>🏦</div>
        <h2 style={{ margin: '10px 0 4px' }}>Đơn đã đặt — chờ thanh toán</h2>
        <p style={{ color: '#666', fontSize: 14, margin: 0 }}>Mã đơn của bạn:</p>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--zm-primary)', margin: '6px 0' }}>{code}</div>
        <p style={{ color: '#888', fontSize: 13, padding: '0 24px', lineHeight: 1.6, margin: 0 }}>
          Quán xác nhận trong ít phút sau khi nhận được tiền. Đơn chỉ bắt đầu làm sau khi xác nhận thanh toán.
        </p>
      </div>
      {transfer ? (
        <TransferGuide code={code} transfer={transfer} notifiedAt={notifiedAt} onNotified={() => setNotifiedAt(new Date().toISOString())} />
      ) : (
        <div className="zm-empty">Đang tải thông tin chuyển khoản...</div>
      )}
      <div style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="zm-btn-primary" onClick={() => nav(`/track?code=${code}`)}>Theo dõi đơn hàng</button>
        <button className="zm-btn-outline" onClick={cancelOrder} disabled={cancelling} style={{ color: '#c62828', borderColor: '#ef9a9a' }}>
          {cancelling ? 'Đang hủy...' : 'Hủy đơn này'}
        </button>
        <Link to="/" style={{ color: 'var(--zm-primary)', fontWeight: 700, fontSize: 14, textDecoration: 'none', textAlign: 'center' }}>Về trang chủ</Link>
      </div>
    </div>
  );
}
