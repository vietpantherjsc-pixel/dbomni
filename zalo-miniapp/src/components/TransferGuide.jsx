import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, fmt, getProfile } from '../api';

// Spec Thanh toán QR (2026-10-21) — phương án A (NV xác nhận tay):
// Khối hướng dẫn chuyển khoản dùng chung cho màn "Chờ thanh toán" (L15) và
// trang Theo dõi đơn: VietQR sinh TẠI MÁY từ chuỗi EMV backend trả + STK sao
// chép được + nút "Tôi đã chuyển khoản" gắn cờ cho NV đối chiếu sao kê.
export default function TransferGuide({ code, transfer, notifiedAt, onNotified, shopPhone }) {
  // Lát 3c (2026-11-04): dòng hướng dẫn hủy cho đơn đã báo CK — luật 2026-10-26
  // không cho hủy online nữa, khách phải gọi quán để hủy + hoàn tiền tay.
  const cancelHint = (
    <div style={{ fontSize: 12.5, color: '#065f46', marginTop: 8, lineHeight: 1.55 }}>
      Cần hủy đơn? Đơn đã báo chuyển khoản không tự hủy online được —{' '}
      {shopPhone
        ? <>gọi quán <a href={`tel:${shopPhone}`} style={{ color: '#065f46', fontWeight: 800 }}>{shopPhone}</a> để quán hỗ trợ hủy &amp; hoàn tiền.</>
        : <>hãy liên hệ quán để được hỗ trợ hủy &amp; hoàn tiền.</>}
    </div>
  );
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState('');
  const [sending, setSending] = useState(false);
  const [notified, setNotified] = useState(!!notifiedAt);
  // Thu gọn panel sau khi đã báo CK (Đại Vương yêu cầu 2026-11-04): panel VietQR
  // chiếm gần trọn màn hình và vẫn mở nguyên sau khi khách báo đã chuyển khoản,
  // che phần trạng thái đơn phía dưới. Đã báo → chỉ còn dải tóm tắt + nút xem lại;
  // khách bấm xem lại thì mở full (vẽ lại QR), thu gọn lại được.
  const [expanded, setExpanded] = useState(false);
  // UX 2026-10-26 (🟠3): bỏ prompt() — nhập SĐT ngay trong khối CK + lỗi hiện tại chỗ
  const [phoneForm, setPhoneForm] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [notifyErr, setNotifyErr] = useState('');

  useEffect(() => { setNotified(!!notifiedAt); }, [notifiedAt]);

  useEffect(() => {
    if (transfer?.vietqr_payload && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, transfer.vietqr_payload, { width: 224, margin: 1 })
        .catch(() => { /* không sinh được QR thì vẫn còn khối STK sao chép tay */ });
    }
  }, [transfer?.vietqr_payload, notified, expanded]); // notified/expanded: canvas tháo ra khi thu gọn → mở lại phải vẽ lại QR

  if (!transfer) return null;
  // Lát 3e (2026-11-04): notifiedAt === undefined nghĩa là trang cha CHƯA biết
  // cờ đã-báo (đang chờ lượt tải đầu) — giữ khối ở trạng thái chờ gọn thay vì
  // dựng panel đầy rồi gấp lại gây lóe như trước (WaitingPayment nạp transfer
  // từ state điều hướng nhưng cờ báo CK phải chờ API).
  if (notifiedAt === undefined) {
    return (
      <div style={{ margin: '12px 16px', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 14, padding: '12px 16px', fontSize: 13.5, color: '#64748b', textAlign: 'center' }}>
        Đang kiểm tra trạng thái chuyển khoản…
      </div>
    );
  }
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
    let phone = getProfile()?.phone || phoneInput.trim();
    if (!phone) { setPhoneForm(true); setNotifyErr('Nhập SĐT đã dùng để đặt đơn để quán đối chiếu.'); return; }
    setNotifyErr('');
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
            setNotifyErr('Bạn thao tác hơi nhanh — vui lòng đợi ít giây rồi bấm lại.');
          }
        } catch {
          setNotifyErr('Bạn thao tác hơi nhanh — vui lòng đợi ít giây rồi bấm lại.');
        }
      } else {
        setNotifyErr(msg || 'Không gửi được thông báo. Vui lòng thử lại.');
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
          style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 8, fontSize: 12, padding: '9px 12px', minHeight: 44, cursor: 'pointer', color: 'var(--zm-primary)', fontWeight: 700 }}>
          {copied === key ? '✓ Đã chép' : 'Sao chép'}
        </button>
      </span>
    </div>
  );

  // Đã báo CK và chưa bấm xem lại → dải tóm tắt gọn thay cho cả panel.
  if (notified && !expanded) {
    return (
      <div style={{ margin: '12px 16px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 14, padding: '12px 16px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#065f46', lineHeight: 1.55 }}>
          ✅ Đã báo chuyển khoản — quán đang đối chiếu. Đơn chỉ bắt đầu làm sau khi quán xác nhận thanh toán.
        </div>
        {cancelHint}
        <button onClick={() => setExpanded(true)}
          style={{ marginTop: 10, width: '100%', minHeight: 44, border: '1px solid #065f46', background: '#fff', color: '#065f46', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
          Xem lại thông tin chuyển khoản
        </button>
      </div>
    );
  }

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
      {notifyErr && !notified && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>⚠ {notifyErr}</div>
      )}
      {phoneForm && !notified && (
        <div className="zm-field" style={{ marginBottom: 10 }}>
          <input type="tel" inputMode="tel" placeholder="SĐT đã dùng để đặt đơn" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} />
        </div>
      )}
      {notified ? (
        <div>
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            ✅ Đã báo chuyển khoản — chờ quán đối chiếu. Đơn chỉ bắt đầu làm sau khi quán xác nhận thanh toán.
          </div>
          {cancelHint}
          <button onClick={() => setExpanded(false)}
            style={{ display: 'block', margin: '10px auto 0', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--zm-primary)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Thu gọn thông tin chuyển khoản
          </button>
        </div>
      ) : (
        <button className="zm-btn-primary" onClick={markNotified} disabled={sending}>
          {sending ? 'Đang gửi...' : (phoneForm ? 'Xác nhận đã chuyển khoản' : 'Tôi đã chuyển khoản')}
        </button>
      )}
    </div>
  );
}
