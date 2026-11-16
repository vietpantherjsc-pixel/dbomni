import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, fmt, getProfile } from '../api';
import { openCheckout } from '../utils/checkoutSdk'; // Gói Checkout SDK (2026-11-10): mở lại trang thanh toán Zalo cho nút "Thanh toán lại"
import { validPhone } from '../utils/checkoutFields.jsx';
import ZmIcon, { CouponIcon } from '../components/ZmIcon';

// Màn hình "Chờ thanh toán": hiện ngay sau đặt đơn BANK (kể cả khi mở
// Checkout SDK thất bại), và là nơi khách quay lại trả sau. Trạng thái nạp
// qua API theo dõi đơn (poll 5s).
// Gói vá sau vòng S — Mục 4 (Phương án 1 + bổ sung chốt 17:30 11/11):
// GỠ HẲN khối TransferGuide (VietQR + nút "Tôi đã chuyển khoản" gọi API
// báo CK) — một đường thanh toán duy nhất qua Checkout SDK. Màn chỉ còn:
// mã đơn + trạng thái chờ + "Thanh toán lại" + "Đã chuyển khoản" (CHỈ
// điều hướng sang màn theo dõi, không đổi trạng thái thanh toán) + theo
// dõi/hủy/về trang chủ. Cơ chế transfer_notified phía server giữ nguyên.
// Thiết kế lại PHƯƠNG ÁN C (spec đã khóa 2026-11-14): đầu màn rút gọn
// (pill + mã + giờ hẹn) · thẻ thân "Chi tiết thanh toán" đọc khối price
// của track() · khối hướng dẫn BANK nguyên văn · thẻ cuối chứa tổng +
// cụm hành động (ghim dính đã bỏ theo phán nghiệm thu 2026-11-14).
// CHỈ thay trình bày — cơ chế (poll · gone ·
// repay · ghi mốc · hủy) giữ nguyên tuyệt đối theo mục 7 của spec.

// Nhãn ngày hẹn theo spec mục 1.1: "Hôm nay" / "Ngày mai" / dd-MM.
function schedDayLabel(v) {
  const dstr = String(v || '').slice(0, 10);
  const tstr = String(v || '').slice(11, 16);
  if (!dstr) return '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let day;
  if (dstr === dayStr(now)) day = 'Hôm nay';
  else if (dstr === dayStr(new Date(now.getTime() + 86400000))) day = 'Ngày mai';
  else day = `${dstr.slice(8, 10)}-${dstr.slice(5, 7)}`;
  return tstr ? `${day} ${tstr}` : day;
}

const NAVY = '#24305E';
const GREEN_NEG = '#2E7D4F';

export default function WaitingPayment() {
  const { code } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null); // dữ liệu đơn đầy đủ từ track() (món + khối price) cho phần trình bày phương án C
  const [notifiedAt, setNotifiedAt] = useState(undefined); // mốc khách đã báo CK (customer_notified_at) — undefined = chưa biết (chờ lượt tải đầu)
  const [branchPhone, setBranchPhone] = useState(''); // SĐT quán cho dòng gọi hủy khi đơn đã báo CK
  const [gone, setGone] = useState(false); // đơn đã được xác nhận tiền / không còn chờ
  const [cancelling, setCancelling] = useState(false);
  // UX 2026-10-26 (🟠3+🟠4): xác nhận hủy ngay trong trang (bỏ confirm/prompt) + trạng thái lỗi tải
  const [showCancel, setShowCancel] = useState(false);
  const [cancelPhone, setCancelPhone] = useState('');
  const [cancelErr, setCancelErr] = useState('');
  const [loadErr, setLoadErr] = useState(false);
  // Chính sách 2026-10-26: đã báo chuyển khoản (transfer_notified) thì ẩn hẳn nút hủy,
  // khớp backend cancel() — cần hủy thì gọi quán để hoàn tiền tay.
  const [payStatus, setPayStatus] = useState(null);
  const [payChannel, setPayChannel] = useState(null); // BANK/COD từ API track — nút "Đã chuyển khoản" chỉ cho đơn BANK
  // Gói Checkout SDK (spec §3): "Thanh toán lại" cho đơn còn
  // pending_payment — server cấp lại params cho CHÍNH đơn này.
  const [repaying, setRepaying] = useState(false);
  const [repayErr, setRepayErr] = useState('');
  // Chưa biết trạng thái (payStatus còn null) thì CHƯA hiện nút hủy —
  // tránh lóe nút Hủy trên đơn đã báo CK trong lúc chờ lượt tải đầu.
  const canCancel = payStatus !== null && payStatus !== 'transfer_notified' && !notifiedAt;

  // Audit 2026-10-21 🟠12: khách đổi ý khi đang chờ CK phải có đường HỦY ngay tại đây
  // (trước đây màn này không có nút hủy — đơn treo vô thời hạn). Xác thực bằng SĐT
  // đặt đơn như TrackOrder; hủy xong về trang chủ.
  const cancelOrder = async () => {
    const phone = (getProfile()?.phone || cancelPhone).trim();
    if (!phone) { setCancelErr('Nhập SĐT đã dùng để đặt đơn để xác nhận hủy.'); return; }
    // Luật SĐT 2026-11-07 (áp đồng nhất): sai mẫu 0 + 10 số thì chặn tại chỗ.
    if (!validPhone(phone)) { setCancelErr('Số điện thoại chưa đúng — cần bắt đầu bằng 0 và đủ 10 số.'); return; }
    setCancelErr('');
    setCancelling(true);
    try {
      await api.cancelOrder(code, phone);
      nav('/', { replace: true });
    } catch (e) {
      setCancelErr(e.message || 'Không hủy được đơn.');
    } finally { setCancelling(false); }
  };

  // Gói Checkout SDK (spec §3): bấm "Thanh toán lại" → xin params mới
  // từ server → mở CheckoutSDK → gắn lại mã đơn SDK nếu có orderId mới →
  // nạp lại trạng thái đơn từ server (đường track hiện có của trang).
  // Lỗi mở SDK → hiện câu §3 ngay trong trang, không chuyển màn.
  const repay = async () => {
    setRepayErr('');
    setRepaying(true);
    try {
      const res = await api.repayParams(code);
      let sdkRes;
      try {
        sdkRes = await openCheckout(res.sdk_params);
      } catch (e) {
        // Mục 2 gói vá sau vòng S: nối chi tiết lỗi gốc (chặng/name/message
        // do checkoutSdk gắn vào message) — không nuốt trắng như catch cũ.
        setRepayErr('Không mở được trang thanh toán của Zalo. Đơn của bạn đã được lưu — bạn có thể thanh toán lại trong mục Đơn hàng.' + (e?.message ? ` [${e.message}]` : ''));
        return;
      }
      if (sdkRes?.orderId) {
        try { await api.linkSdkOrder(code, sdkRes.orderId); } catch (e) { console.warn('Gắn mã đơn SDK lỗi:', e); }
      }
      const o = await api.trackOrder(code, getProfile()?.phone || '');
      setOrder(o);
      if (o.payment_status) setPayStatus(o.payment_status);
      if (o.pay_channel) setPayChannel(o.pay_channel);
    } catch (e) {
      setRepayErr(e.message || 'Không cấp lại được thanh toán. Vui lòng thử lại.');
    } finally { setRepaying(false); }
  };

  // Nút "Đã chuyển khoản" (Mục 4 — bổ sung chốt 17:30 11/11): CHỈ ĐIỀU
  // HƯỚNG sang màn theo dõi đơn, tuyệt đối không gọi API báo CK và không
  // đổi trạng thái thanh toán — tiền chỉ ghi nhận qua notify của Zalo +
  // NV đối chiếu sao kê. Khác hẳn nút cũ trong TransferGuide (gọi API
  // transferNotified lật trạng thái — đã gỡ cùng khối).
  const onPaidAlready = () => {
    // Ghi mốc giờ khách bấm vào customer_notified_at (PM phán Phương án A
    // 2026-11-12): gọi route ghi-mốc-riêng transfer-mark — server CHỈ ghi
    // mốc, giữ nguyên payment_status. Bắn rồi đi ngay, lỗi ghi mốc nuốt
    // êm (điều hướng không bị chặn; mốc là tín hiệu ưu tiên đối chiếu,
    // không phải cổng trạng thái).
    try {
      const p = api.markTransfer(code, getProfile()?.phone || '');
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* bỏ qua — vẫn chuyển màn theo dõi */ }
    nav(`/track?code=${code}`);
  };

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.trackOrder(code, getProfile()?.phone || '').then((o) => {
        if (!alive) return;
        setLoadErr(false);
        setOrder(o);
        if (o.payment_status) setPayStatus(o.payment_status);
        if (o.pay_channel) setPayChannel(o.pay_channel);
        if (o.branch_phone) setBranchPhone(o.branch_phone);
        setNotifiedAt(o.customer_notified_at || null);
        if (['confirmed', 'paid', 'completed'].includes(o.payment_status) || o.status !== 'pending') {
          setGone(true); // NV đã xác nhận → sang trang theo dõi
        }
      }).catch(() => { if (alive) setLoadErr(true); });
    };
    load();
    const t = setInterval(load, 5000); // NV xác nhận xong → tự chuyển sang theo dõi
    return () => { alive = false; clearInterval(t); };
  }, [code]);

  useEffect(() => {
    if (gone) nav(`/track?code=${code}`, { replace: true });
  }, [gone, code, nav]);

  // ---- Trình bày phương án C (chỉ khi đã có dữ liệu đơn) ----
  const p = order?.price || null;
  const promoDisc = p?.promotion ? (Number(p.promotion.discount) || 0) : 0;
  const voucherDisc = p?.voucher ? (Number(p.voucher.discount) || 0) : 0;
  // Coupon ví phía coupon của cặp thắng (khối price.coupon, 2026-11-15)
  // + phần dư chưa thuộc dòng nào: tách dòng phải cộng khớp
  // discount_amount (điểm nối TESTER — trước đây màn chờ không có dòng
  // hứng nên đơn cặp tách dòng không khớp tổng giảm).
  const couponDisc = p?.coupon ? (Number(p.coupon.discount) || 0) : 0;
  const discountTotal = p?.discount_amount != null ? Number(p.discount_amount) : promoDisc + couponDisc + voucherDisc;
  const restDisc = Math.max(0, discountTotal - promoDisc - couponDisc - voucherDisc);
  const shipDisc = p?.shipping ? (Number(p.shipping.discount) || 0) : 0;
  const shipFee = p?.shipping ? (Number(p.shipping.fee) || 0) : (Number(order?.shipping_fee) || 0);
  const codFee = p?.shipping ? (Number(p.shipping.cod_fee) || 0) : 0;
  const totalVal = p?.total_amount != null ? Number(p.total_amount) : (Number(order?.total_amount) || 0);

  const trow = { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: 14 };
  const trowLabel = { color: '#444' };
  const trowVal = { fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const trowNeg = { color: GREEN_NEG, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

  return (
    <div className="zm-page" style={{ paddingBottom: 24 }}>
      <div className="zm-header"><button className="zm-back" onClick={() => nav(-1)}>←</button><h1>Chờ thanh toán</h1></div>

      {/* 1.1 Đầu màn rút gọn: pill trạng thái + mã đơn cùng hàng */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {payStatus === 'transfer_notified' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: '5px 12px', background: '#E9EEF9', color: NAVY }}>✔ Đã báo chuyển khoản — chờ quán xác nhận</span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: '5px 12px', background: '#FFF3DE', color: '#8A5A00' }}>⏳ Đang chờ thanh toán</span>
          )}
          <span style={{ fontSize: 13, color: '#757575' }}>Mã đơn <b style={{ color: NAVY }}>{code}</b></span>
        </div>
        {order?.scheduled_at && (
          <div style={{ fontSize: 13.5, color: '#444', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ZmIcon name="clock" size={15} />
            <span>{order.order_type === 'delivery' ? 'Hẹn giao' : 'Hẹn lấy'}: <b>{schedDayLabel(order.scheduled_at)}</b>{order.branch_name ? ` · ${order.branch_name}` : ''}</span>
          </div>
        )}
        {/* Đoạn chữ trạng thái — nguyên văn hiện hành (spec mục 5) */}
        {!loadErr && payStatus === 'transfer_notified' ? (
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6, margin: '8px 0 0' }}>
            {/* Vá A2 (Đại Vương chốt 2026-11-13 ~00:33): câu trung tính —
                notify chỉ nghĩa là khách đã CHỌN phương thức BANK, có thể
                chưa chuyển đồng nào; không khẳng định quán đã nhận tiền. */}
            Đơn đang chờ xác nhận thanh toán. Nếu bạn đã chuyển khoản, quán sẽ đối chiếu sao kê và xác nhận trong ít phút. Nếu chưa chuyển khoản, bấm Thanh toán lại bên dưới để mở lại trang thanh toán.
            {branchPhone ? <> Cần hỗ trợ, gọi quán <a href={`tel:${branchPhone}`} style={{ color: 'var(--zm-primary)', fontWeight: 800 }}>{branchPhone}</a>.</> : ''}
          </p>
        ) : !loadErr && payStatus === 'pending_payment' ? (
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6, margin: '8px 0 0' }}>
            Đơn đang chờ thanh toán. Bấm <b>Thanh toán lại</b> bên dưới để mở lại trang thanh toán của Zalo — hoặc bấm <b>Đã chuyển khoản</b> nếu bạn đã trả qua ngân hàng để quán ưu tiên đối chiếu.<br />
            Quán xác nhận trong ít phút sau khi nhận được tiền. Đơn chỉ bắt đầu làm sau khi xác nhận thanh toán.
          </p>
        ) : null}
      </div>

      {loadErr ? (
        <div className="zm-empty">
          <div>Không tải được trạng thái đơn. Trang sẽ tự thử lại sau ít giây, hoặc bấm Thử lại ngay.</div>
          <button className="zm-btn-inline" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Thử lại</button>
        </div>
      ) : !order ? (
        <div className="zm-empty">Đang tải trạng thái đơn...</div>
      ) : (
        <>
          {/* 1.2 Thân — thẻ "Chi tiết thanh toán" (KHÔNG chứa hàng tổng) */}
          <div style={{ background: '#fff', border: '1px solid #E4E8F0', borderRadius: 16, padding: 16, margin: '12px 16px 0' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Chi tiết thanh toán</div>
            <div>
              {(order.items || []).map((it, i, arr) => {
                const parts = (it.note || '').split(' | ');
                const options = parts[0] ? parts[0].split(', ').filter(Boolean) : [];
                const freeNote = parts.slice(1).join(' | ');
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: i < arr.length - 1 ? '1px dashed #EDF0F5' : 'none' }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{it.name} × {it.quantity}</span>
                      {options.length > 0 && <span style={{ fontSize: 12, color: '#757575', display: 'block', marginTop: 1 }}>{options.join(' · ')}</span>}
                      {freeNote && <span style={{ fontSize: 12, color: '#757575', display: 'block', marginTop: 1 }}>{freeNote}</span>}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt((Number(it.unit_price) || 0) * (Number(it.quantity) || 0))}đ</span>
                  </div>
                );
              })}
            </div>
            {/* Các dòng tiền đọc từ khối price của track() — khối price
                chưa sẵn sàng thì ẩn phần tách chi tiết (spec mục 3). */}
            {p && (
              <div style={{ borderTop: '1px solid #E4E8F0', marginTop: 6, paddingTop: 8 }}>
                <div style={trow}><span style={trowLabel}>Tạm tính</span><span style={trowVal}>{fmt(p.goods_subtotal)}đ</span></div>
                {promoDisc > 0 && (
                  <div style={trow}>
                    <span style={trowLabel}>{p.coupon ? `Giảm khuyến mãi${p.promotion.name ? ` — ${p.promotion.name}` : ''}` : p.promotion.coupon_code ? <><CouponIcon size={14} /> Coupon {p.promotion.coupon_code}</> : `Giảm khuyến mãi${p.promotion.name ? ` — ${p.promotion.name}` : ''}`}</span>
                    <span style={trowNeg}>−{fmt(promoDisc)}đ</span>
                  </div>
                )}
                {couponDisc > 0 && p.coupon && (
                  <div style={trow}>
                    <span style={trowLabel}><CouponIcon size={14} /> Coupon {p.coupon.name && p.coupon.name !== p.coupon.code ? `${p.coupon.name} (${p.coupon.code})` : p.coupon.code}</span>
                    <span style={trowNeg}>−{fmt(couponDisc)}đ</span>
                  </div>
                )}
                {voucherDisc > 0 && p.voucher && (
                  <div style={trow}>
                    <span style={trowLabel}><CouponIcon size={14} /> Voucher {p.voucher.name && p.voucher.name !== p.voucher.code ? `${p.voucher.name} (${p.voucher.code})` : p.voucher.code}</span>
                    <span style={trowNeg}>−{fmt(voucherDisc)}đ</span>
                  </div>
                )}
                {shipDisc > 0 && (
                  <div style={trow}>
                    <span style={trowLabel}>Giảm phí giao{p.shipping.promotion_name ? ` — ${p.shipping.promotion_name}` : ''}</span>
                    <span style={trowNeg}>−{fmt(shipDisc)}đ</span>
                  </div>
                )}
                {restDisc > 0 && (
                  <div style={trow}>
                    <span style={trowLabel}>Giảm giá</span>
                    <span style={trowNeg}>−{fmt(restDisc)}đ</span>
                  </div>
                )}
                {order.order_type === 'delivery' && (
                  <>
                    <div style={trow}><span style={trowLabel}>Phí giao hàng</span><span style={trowVal}>{fmt(shipFee)}đ</span></div>
                    {codFee > 0 && (
                      <div style={{ fontSize: 12, color: '#888', margin: '-2px 0 4px' }}>Đã gồm phí thu hộ COD {fmt(codFee)}đ</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* 1.3 Khối hướng dẫn chuyển khoản — chỉ đơn BANK, nguyên văn
              đã chốt ở màn thanh toán (Checkout). */}
          {payChannel === 'BANK' && (
            <div style={{ background: '#f0f4ff', borderRadius: 12, padding: 12, margin: '12px 16px 0' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#24305E', marginBottom: 4 }}>Thanh toán bằng chuyển khoản</div>
              <div style={{ fontSize: 13, color: '#444', lineHeight: 1.55 }}>
                Zalo sẽ hiện mã QR để bạn quét bằng app ngân hàng. Chuyển khoản xong, bạn có thể đóng màn hình QR để tiếp tục theo dõi đơn hàng tại đây.
              </div>
            </div>
          )}

          {/* 1.4 Thẻ cuối — tổng tiền + cụm hành động. GHIM DÍNH ĐÃ BỎ
              theo phán nghiệm thu của Đại Vương (2026-11-14): đặt ở cuối
              nội dung, cuộn theo trang như bình thường để đơn nhiều dòng
              có đủ diện tích quan sát. */}
          <div style={{ padding: '0 16px', marginTop: 16 }}>
            <div style={{ background: '#FFFDF6', border: '1px solid #FFE0B2', borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: '#666' }}>Tổng cần thanh toán</span>
                <span style={{ fontSize: 26, fontWeight: 800, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalVal)}đ</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(payStatus === 'pending_payment' || payStatus === 'transfer_notified') && (
                  <>
                    <button className="zm-btn-primary" style={{ height: 52, padding: 0 }} onClick={repay} disabled={repaying}>
                      {repaying ? 'Đang mở thanh toán...' : 'Thanh toán lại'}
                    </button>
                    {repayErr && <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>⚠ {repayErr}</div>}
                    {/* Vá A2 (2026-11-13): nút "Đã chuyển khoản" CHỈ cho
                        pending_payment + BANK — nhánh transfer_notified
                        KHÔNG có nút ghi mốc (Đại Vương chốt bỏ). */}
                    {payStatus === 'pending_payment' && payChannel === 'BANK' && (
                      <button className="zm-btn-outline" style={{ height: 48, padding: 0 }} onClick={onPaidAlready}>Đã chuyển khoản</button>
                    )}
                  </>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="zm-btn-outline" style={{ flex: 1, height: 48, padding: 0, borderColor: '#D5DAE4', color: '#444' }} onClick={() => nav(`/track?code=${code}`)}>Theo dõi đơn</button>
                  {canCancel && !showCancel && (
                    <button className="zm-btn-outline" style={{ flex: 1, height: 48, padding: 0, color: '#C0392B', borderColor: '#EF9A9A' }} onClick={() => setShowCancel(true)}>
                      Hủy đơn
                    </button>
                  )}
                </div>
                {canCancel && showCancel && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>Chắc chắn hủy đơn này?</div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>Nếu bạn đã chuyển khoản rồi, hãy liên hệ quán thay vì hủy.</div>
                    {!getProfile()?.phone && (
                      <div className="zm-field" style={{ marginBottom: 10 }}>
                        <input type="tel" inputMode="tel" placeholder="SĐT đã dùng để đặt đơn" value={cancelPhone} onChange={(e) => setCancelPhone(e.target.value)} />
                        {cancelPhone && !validPhone(cancelPhone) && (
                          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>Số điện thoại cần bắt đầu bằng 0 và đủ 10 số.</div>
                        )}
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
                {/* Trạng thái đã báo chuyển khoản: ẩn hẳn hủy, thay bằng
                    dòng gọi quán (luật 26/10 + spec mục 2). */}
                {payStatus === 'transfer_notified' && (
                  <div style={{ fontSize: 12.5, color: '#666', lineHeight: 1.55, textAlign: 'center' }}>
                    Đơn đã báo chuyển khoản nên không hủy online được.{branchPhone ? <> Cần hủy, gọi quán <a href={`tel:${branchPhone}`} style={{ color: NAVY, fontWeight: 800 }}>{branchPhone}</a> để được hỗ trợ.</> : ''}
                  </div>
                )}
              </div>
            </div>
          </div>
          <Link to="/" style={{ color: 'var(--zm-primary)', fontWeight: 700, fontSize: 14, textDecoration: 'none', textAlign: 'center', display: 'block', padding: '4px 0 8px' }}>Về trang chủ</Link>
        </>
      )}
    </div>
  );
}
