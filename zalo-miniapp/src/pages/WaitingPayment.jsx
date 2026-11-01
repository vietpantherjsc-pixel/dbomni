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
  // UX 2026-10-26 (🟠3+🟠4): xác nhận hủy ngay trong trang (bỏ confirm/prompt) + trạng thái lỗi tải
  const [showCancel, setShowCancel] = useState(false);
  const [cancelPhone, setCancelPhone] = useState('');
  const [cancelErr, setCancelErr] = useState('');
  const [loadErr, setLoadErr] = useState(false);

  // Audit 2026-10-21 🟠12: khách đổi ý khi đang chờ CK phải có đường HỦY ngay tại đây
  // (trước đây màn này không có nút hủy — đơn treo vô thời hạn). Xác thực bằng SĐT
  // đặt đơn như TrackOrder; hủy xong về trang chủ.
  const cancelOrder = async () => {
    const phone = (getProfile()?.phone || cancelPhone).trim();
    if (!phone) { setCancelErr('Nhập SĐT đã dùng để đặt đơn để xác nhận hủy.'); return; }
    setCancelErr('');
    setCancelling(true);
    try {
      await api.cancelOrder(code, phone);
      nav('/', { replace: true });
    } catch (e) {
      setCancelErr(e.message || 'Không hủy được đơn.');
    } finally { setCancelling(false); }
  };

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.trackOrder(code, getProfile()?.phone || '').then((o) => {
        if (!alive) return;
        if (o.transfer) {
          setLoadErr(false);
          setTransfer(o.transfer);
          setNotifiedAt(o.customer_notified_at || null);
        } else if (['confirmed', 'paid', 'completed'].includes(o.payment_status) || o.status !== 'pending') {
          setGone(true); // NV đã xác nhận → sang trang theo dõi
        }
      }).catch(() => { if (alive) setLoadErr(true); });
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
      ) : loadErr ? (
        <div className="zm-empty">
          <div>Không tải được thông tin chuyển khoản. Trang sẽ tự thử lại sau ít giây, hoặc bấm Thử lại ngay.</div>
          <button className="zm-btn-inline" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Thử lại</button>
        </div>
      ) : (
        <div className="zm-empty">Đang tải thông tin chuyển khoản...</div>
      )}
      {transfer && loadErr && (
        <p style={{ color: '#b45309', fontSize: 12, textAlign: 'center', margin: '0 16px' }}>Chưa tải được trạng thái mới nhất — đang tự thử lại…</p>
      )}
      <div style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="zm-btn-primary" onClick={() => nav(`/track?code=${code}`)}>Theo dõi đơn hàng</button>
        {!showCancel ? (
          <button className="zm-btn-outline" onClick={() => setShowCancel(true)} style={{ color: '#c62828', borderColor: '#ef9a9a' }}>
            Hủy đơn này
          </button>
        ) : (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Chắc chắn hủy đơn này?</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>Nếu bạn đã chuyển khoản rồi, hãy liên hệ quán thay vì hủy.</div>
            {!getProfile()?.phone && (
              <div className="zm-field" style={{ marginBottom: 10 }}>
                <input type="tel" inputMode="tel" placeholder="SĐT đã dùng để đặt đơn" value={cancelPhone} onChange={(e) => setCancelPhone(e.target.value)} />
              </div>
            )}
            {cancelErr && <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600, marginBottom: 10 }}>⚠ {cancelErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="zm-btn-outline" style={{ flex: 1 }} onClick={() => setShowCancel(false)}>Giữ lại đơn</button>
              <button className="zm-btn-primary" style={{ flex: 1, background: '#c62828' }} onClick={cancelOrder} disabled={cancelling}>
                {cancelling ? 'Đang hủy...' : 'Xác nhận hủy'}
              </button>
            </div>
          </div>
        )}
        <Link to="/" style={{ color: 'var(--zm-primary)', fontWeight: 700, fontSize: 14, textDecoration: 'none', textAlign: 'center' }}>Về trang chủ</Link>
      </div>
    </div>
  );
}
