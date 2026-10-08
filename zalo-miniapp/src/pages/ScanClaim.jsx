import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api, getProfile } from '../api';
import { TabBar } from './Home';

// Gói 11: quét QR tích điểm tại quầy — khách quét mã trên màn hình POS
// để gán đơn vào tài khoản thành viên (cần đăng nhập Tài khoản trước).
export default function ScanClaim() {
  const nav = useNavigate();
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [scanning, setScanning] = useState(true);
  const qrRef = useRef(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const qr = new Html5Qrcode('qr-reader');
    qrRef.current = qr;
    qr.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (text) => {
        if (handledRef.current) return;
        handledRef.current = true;
        setScanning(false);
        handleScan(text);
      },
      () => {}
    ).catch(() => setError('Không mở được camera. Hãy cấp quyền camera cho trình duyệt.'));
    return () => { qr.stop().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScan = async (text) => {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      setError('Mã QR không hợp lệ.');
      return;
    }
    if (!payload.code || !payload.token) { setError('Mã QR không hợp lệ.'); return; }
    const profile = getProfile();
    if (!profile?.member_code || !profile?.phone) {
      setError('Hãy đăng nhập Tài khoản (SĐT + Mã TV) trước khi quét.');
      return;
    }
    try {
      const res = await api.claimOrder(payload.code, {
        claim_token: payload.token,
        member_code: profile.member_code,
        phone: profile.phone,
      });
      setDone(res.member);
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="zm-page">
      <div className="zm-header">
        <button className="zm-btn-outline" style={{ width: 'auto', padding: '8px 14px' }} onClick={() => nav(-1)}>←</button>
        <h1>Quét tích điểm</h1>
      </div>
      <div style={{ padding: 16 }}>
        {done ? (
          <div className="zm-note" style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <div style={{ fontWeight: 800, margin: '8px 0' }}>Đã gán đơn vào tài khoản!</div>
            <div>{done.name} · {done.member_code}{done.tier ? ` · Hạng ${done.tier}` : ''}</div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 8 }}>Điểm sẽ được cộng khi đơn hoàn tất.</div>
          </div>
        ) : (
          <>
            {scanning && <div id="qr-reader" style={{ width: '100%' }} />}
            <p className="zm-note" style={{ marginTop: 12 }}>
              Hướng camera vào mã QR tích điểm trên màn hình thu ngân.
            </p>
          </>
        )}
        {error && <div className="zm-note" style={{ color: '#c00', marginTop: 12 }}>{error}</div>}
      </div>
      <TabBar />
    </div>
  );
}
