import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, fmt, getProfile } from '../api';

// Spec Thanh toán QR (2026-10-21) — phương án A (NV xác nhận tay):
// Khối hướng dẫn chuyển khoản dùng chung cho màn "Chờ thanh toán" (L15) và
// trang Theo dõi đơn: VietQR sinh TẠI MÁY từ chuỗi EMV backend trả + STK sao
// chép được + nút "Tôi đã chuyển khoản" gắn cờ cho NV đối chiếu sao kê.
export default function TransferGuide({ code, transfer, notifiedAt, onNotified }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState('');
  const [sending, setSending] = useState(false);
  const [notified, setNotified] = useState(!!notifiedAt);

  useEffect(() => { setNotified(!!notifiedAt); }, [notifiedAt]);

  useEffect(() => {
    if (transfer?.vietqr_payload && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, transfer.vietqr_payload, { width: 224, margin: 1 })
        .catch(() => { /* không sinh được QR thì vẫn còn khối STK sao chép tay */ });
    }
  }, [transfer?.vietqr_payload]);

  if (!transfer) return null;
  const b = transfer.bank_info || {};

  const copy = async (key, text) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(text));
      else {
        const ta = document.createElement('textarea');
        ta.value = String(text); document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopied(key); setTimeout(() => setCopied(''), 1500);
    } catch { /* bỏ qua */ }
  };

  const markNotified = async () => {
    let phone = getProfile()?.phone || '';
    if (!phone) {
      phone = (prompt('Nhập SĐT đã dùng để đặt đơn:') || '').trim();
      if (!phone) return;
    }
    setSending(true);
    try {
      await api.transferNotified(code, phone);
      setNotified(true);
      if (onNotified) onNotified();
    } catch (e) {
      // Audit bổ sung F17 (2026-10-21): KHÔNG alert nguyên văn "Too Many Attempts." —
      // gặp 429 thì kiểm tra lại trạng thái đơn: lần báo trước có thể đã được ghi
      // nhận (server idempotent) → hiện trạng thái đã báo; chưa ghi nhận thì nhắc
      // khách đợi ít giây bấm lại bằng câu thân thiện.
      const msg = String(e.message || '');
      if (/too many attempts/i.test(msg)) {
        try {
          const o = await api.trackOrder(code, getProfile()?.phone || '');
          if (o?.customer_notified_at) {
            setNotified(true);
            if (onNotified) onNotified();
          } else {
            alert('Bạn thao tác hơi nhanh — vui lòng đợi ít giây rồi bấm lại.');
          }
        } catch {
          alert('Bạn thao tác hơi nhanh — vui lòng đợi ít giây rồi bấm lại.');
        }
      } else {
        alert(msg);
      }
    }
    finally { setSending(false); }
  };

  const row = (label, value, key) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px dashed #eee' }}>
      <span style={{ fontSize: 13, color: '#888' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 14 }}>{value}</b>
        <button onClick={() => copy(key, value)}
          style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 6, fontSize: 11, padding: '3px 8px', cursor: 'pointer', color: 'var(--zm-primary)', fontWeight: 700 }}>
          {copied === key ? '✓ Đã chép' : 'Sao chép'}
        </button>
      </span>
    </div>
  );

  return (
    <div style={{ margin: '12px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 15, textAlign: 'center' }}>Quét mã VietQR để thanh toán</div>
      {transfer.vietqr_payload ? (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 2px' }}>
          <canvas ref={canvasRef} style={{ width: 224, height: 224 }} />
        </div>
      ) : (
        <p style={{ fontSize: 13, color: '#b45309', textAlign: 'center', margin: '10px 0 2px' }}>
          Quán chưa cấu hình mã QR — vui lòng chuyển khoản theo thông tin bên dưới.
        </p>
      )}
      <div>
        {row('Ngân hàng', b.bank_name || '—', 'bank')}
        {row('Số tài khoản', b.account_number || '—', 'acc')}
        {row('Chủ tài khoản', b.account_name || '—', 'name')}
        {row('Số tiền', `${fmt(transfer.amount)}đ`, 'amount')}
        {row('Nội dung CK', transfer.transfer_content || code, 'content')}
      </div>
      <ol style={{ fontSize: 13, color: '#555', lineHeight: 1.7, paddingLeft: 18, margin: '12px 0' }}>
        <li>Mở app ngân hàng, quét mã QR (hoặc nhập số tài khoản ở trên).</li>
        <li>Kiểm tra đúng <b>số tiền</b> và <b>giữ nguyên nội dung chuyển khoản</b>.</li>
        <li>Bấm nút <b>"Tôi đã chuyển khoản"</b> bên dưới để quán đối chiếu nhanh.</li>
      </ol>
      {notified ? (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          ✅ Đã báo chuyển khoản — chờ quán đối chiếu. Đơn chỉ bắt đầu làm sau khi quán xác nhận thanh toán.
        </div>
      ) : (
        <button className="zm-btn-primary" onClick={markNotified} disabled={sending}>
          {sending ? 'Đang gửi...' : 'Tôi đã chuyển khoản'}
        </button>
      )}
    </div>
  );
}
