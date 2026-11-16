import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, fmt, getProfile } from '../api';
import ZmIcon, { CouponIcon } from './ZmIcon';
import SearchInput from './SearchInput';
import { formatPhone } from '../utils/checkoutFields.jsx';

// Panel Ưu đãi DÙNG CHUNG cho Checkout đơn thường + Checkout đơn nhóm
// (spec-panel-uu-dai-mo-hinh-chon, Đại Vương duyệt 2026-11-14 ~23:44).
// Mô hình chọn: vào màn CHƯA chọn mã nào · mã đang chọn ghim lên đầu, mã
// chồng được dồn sát ngay dưới, mã không chồng được mờ (~0,42) + khóa ·
// bỏ hẳn nhãn chữ về tính chồng trên thẻ — tương thích chỉ thể hiện bằng sáng/mờ.
// Hai phía: KM (kind='promotion' → promotion_id) + coupon (coupon ví
// kind='wallet_coupon' → customer_coupon_id · voucher gõ tay → voucher_code).
// Cặp hợp lệ khi cả hai phía cùng bật cờ chồng phía mình (KM:
// stack_with_coupon · coupon ví: stack_with_coupon của chương trình nguồn ·
// voucher: stack_with_promotion). Mã phí ship / tặng món đứng NGOÀI mô hình
// cặp tiền hàng: luôn sáng khi đủ điều kiện, chọn theo khe riêng của nguồn
// (1 promotion_id · 1 customer_coupon_id), không mờ/khóa mã tiền hàng và
// không bị mã tiền hàng mờ/khóa.
// Server là thẩm phán cuối: component này chỉ chạy phép phân xử hiển thị
// gương đúng store() §5d (gồm cặp KM + coupon ví) trên số server trả.

export const EMPTY_PROMO_RES = {
  promotion_id: null,
  customer_coupon_id: null,
  voucher_code: null,
  shipDiscTotal: 0,
  moneyDiscTotal: 0,
  totalDiscTotal: 0,
  promoApplied: null, // {kind, id, name, code, amount}
  couponApplied: null, // {source: 'wallet'|'voucher', id, code, name, amount, state: 'stacked'|'single'}
  couponNotApplied: null, // {source, code, name} — coupon đã nhận/chọn nhưng phân xử không áp
  shipApplied: [], // [{kind, id, name, amount}]
  giftApplied: [], // [{kind, id, name, gift_product_name}]
  pairCapped: false,
  hasSelection: false,
};

const isMoneyItem = (it) => !!it && !it.is_shipping && it.type !== 'gift';
const idOf = (it) => (it.kind === 'promotion' ? it.promotion_id : it.customer_coupon_id);

const PromoPanel = forwardRef(function PromoPanel(props, ref) {
  const { offers, subtotal, shipFee, phone, preselectCouponId, onResolve } = props;
  const [panelOpen, setPanelOpen] = useState(false);
  const [offerSearch, setOfferSearch] = useState('');
  // Lựa chọn giữ theo KHE NGUỒN (đúng payload server nhận): 1 promotion_id
  // + 1 customer_coupon_id + voucher gõ tay (phía coupon tiền hàng).
  const [selPromo, setSelPromo] = useState(null); // {id}
  const [selWallet, setSelWallet] = useState(null); // {id}
  const [voucher, setVoucher] = useState('');
  const [voucherInfo, setVoucherInfo] = useState(null); // {code, name, discount, stack_with_promotion}
  const [voucherActive, setVoucherActive] = useState(false); // voucher đang là phía coupon tiền hàng đang áp
  const [voucherErr, setVoucherErr] = useState('');
  const [voucherMsg, setVoucherMsg] = useState('');
  const [offerWarn, setOfferWarn] = useState('');
  const preselectRef = useRef(preselectCouponId || null);

  const items = useMemo(() => offers?.items || [], [offers]);
  const promoItem = useMemo(
    () => items.find((i) => selPromo && i.kind === 'promotion' && i.promotion_id === selPromo.id) || null,
    [items, selPromo],
  );
  const walletItem = useMemo(
    () => items.find((i) => selWallet && i.kind === 'wallet_coupon' && i.customer_coupon_id === selWallet.id) || null,
    [items, selWallet],
  );
  const promoMoney = isMoneyItem(promoItem) ? promoItem : null;
  const walletMoney = isMoneyItem(walletItem) ? walletItem : null;
  // Phía coupon tiền hàng đang áp: coupon ví tiền hàng thắng ô (khi khách
  // chọn nó thì voucher tự nhường), else voucher đang active.
  const couponMoney = walletMoney
    ? { source: 'wallet', item: walletItem, discount: Number(walletItem.discount) || 0, stack: !!walletItem.stack_with_coupon, code: walletItem.code, name: walletItem.name }
    : (voucherActive && voucherInfo
      ? { source: 'voucher', info: voucherInfo, discount: Number(voucherInfo.discount) || 0, stack: !!voucherInfo.stack_with_promotion, code: voucherInfo.code, name: voucherInfo.name }
      : null);

  // ===== Danh sách hợp nhất nạp lại: xử lý coupon chọn sẵn từ Ví (1 lần)
  // và tự nhả lựa chọn đã mất điều kiện kèm cảnh báo (như panel cũ). =====
  useEffect(() => {
    if (!offers) return;
    if (preselectRef.current) {
      const cid = Number(preselectRef.current);
      preselectRef.current = null;
      const it = items.find((i) => i.kind === 'wallet_coupon' && i.customer_coupon_id === cid);
      if (it?.eligible) {
        setSelWallet({ id: cid });
        setOfferWarn('');
      } else if (it) {
        setOfferWarn(`Coupon ${it.code} chưa dùng được cho đơn này: ${it.reason_text || 'chưa đủ điều kiện.'}`);
      } else {
        setOfferWarn('Coupon bạn chọn từ Ví không còn dùng được cho đơn này.');
      }
      return;
    }
    const check = (sel, kind) => {
      if (!sel) return;
      const it = items.find((i) => i.kind === kind && idOf(i) === sel.id);
      if (!it) {
        if (kind === 'promotion') setSelPromo(null); else setSelWallet(null);
        setOfferWarn('Ưu đãi đã chọn không còn áp dụng được cho đơn này — đã bỏ chọn.');
      } else if (!it.eligible) {
        if (kind === 'promotion') setSelPromo(null); else setSelWallet(null);
        setOfferWarn(`Ưu đãi đã chọn không còn đủ điều kiện: ${it.reason_text || ''} — đã bỏ chọn.`);
      }
    };
    check(selPromo, 'promotion');
    check(selWallet, 'wallet_coupon');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers]);

  // ===== Voucher gõ tay: validate bằng endpoint server (số giảm thật). =====
  const checkVoucher = async (code) => {
    const c = String(code || '').trim().toUpperCase();
    setVoucherErr('');
    setVoucherMsg('');
    if (!c) { setVoucherInfo(null); setVoucherActive(false); return true; }
    // Mã gõ vào trùng coupon ví của chính khách → chọn luôn coupon ví đó.
    const walletHit = items.find((i) => i.kind === 'wallet_coupon' && String(i.code || '').toUpperCase() === c);
    if (walletHit) {
      if (walletHit.eligible) {
        setSelWallet({ id: walletHit.customer_coupon_id });
        setOfferWarn('');
        setVoucher('');
        setVoucherInfo(null);
        setVoucherActive(false);
        setVoucherMsg('Mã này là coupon trong ví của bạn — đã chọn ở danh sách ưu đãi bên dưới.');
        return true;
      }
      setVoucherErr(`Coupon ${walletHit.code} trong ví của bạn chưa dùng được: ${walletHit.reason_text || 'chưa đủ điều kiện.'}`);
      return false;
    }
    try {
      const prof = getProfile() || {};
      const res = await api.validateVoucher({
        code: c,
        subtotal,
        phone: formatPhone(phone || '') || prof.phone || '',
        member_code: prof.member_code || '',
      });
      const info = {
        code: res.code, name: res.name,
        discount: Math.round(Number(res.discount) || 0),
        stack_with_promotion: !!res.stack_with_promotion,
      };
      setVoucherInfo(info);
      // Spec §5: voucher thành 1 dòng phía coupon trong danh sách; TỰ ÁP
      // chỉ khi phía coupon tiền hàng còn trống và không mâu thuẫn KM đang
      // chọn — mâu thuẫn thì giữ dòng ở trạng thái đã nhận, chưa áp, khách
      // tự bỏ chọn phía kia trước (client không tự thay lựa chọn của khách).
      const sideFree = !walletMoney;
      const conflictsPromo = !!promoMoney && !(promoMoney.stack_with_coupon && info.stack_with_promotion);
      if (sideFree && !conflictsPromo) {
        setVoucherActive(true);
      } else {
        setVoucherActive(false);
        setVoucherMsg(!sideFree
          ? `Phía coupon đang dùng mã khác — bỏ chọn mã đó để áp ${info.code}.`
          : `Mã ${info.code} không cộng dồn với ${promoMoney.name} — bỏ chọn ${promoMoney.name} hoặc để mã này chưa áp.`);
      }
      return true;
    } catch (err) {
      setVoucherInfo(null);
      setVoucherActive(false);
      setVoucherErr(err.message || 'Mã voucher không hợp lệ.');
      return false;
    }
  };

  // Giỏ đổi (subtotal đổi) mà đã áp voucher → tính lại số giảm lặng lẽ.
  const voucherSubtotalRef = useRef(null);
  useEffect(() => {
    if (!voucherInfo) { voucherSubtotalRef.current = null; return; }
    if (voucherSubtotalRef.current === subtotal) return;
    voucherSubtotalRef.current = subtotal;
    checkVoucher(voucherInfo.code).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, voucherInfo]);

  // Trang cha (Checkout) cần chốt voucher chưa validate trước khi sang
  // bước tóm tắt — lộ đúng 1 cổng này ra ngoài.
  useImperativeHandle(ref, () => ({
    ensureVoucher: async () => {
      const v = voucher.trim().toUpperCase();
      if (v && v !== (voucherInfo?.code || '')) return checkVoucher(v);
      return true;
    },
  }));

  // ===== Phân xử hiển thị — gương store() §5d (gồm cặp KM + coupon ví) =====
  const resolved = useMemo(() => {
    const stackCap = offers ? Number(offers.stack_cap_amount) || 0 : subtotal;
    // Phí ship: mỗi mã chọn ở khe nguồn của nó áp độc lập, trừ dần vào phí.
    let shipRemain = Math.max(0, Number(shipFee) || 0);
    const shipApplied = [];
    [promoItem, walletItem].forEach((it) => {
      if (it?.is_shipping) {
        const amt = Math.min(Number(it.discount) || 0, shipRemain);
        shipRemain -= amt;
        shipApplied.push({ kind: it.kind, id: idOf(it), name: it.name, amount: amt });
      }
    });
    const shipDiscTotal = shipApplied.reduce((s, x) => s + x.amount, 0);
    const giftApplied = [promoItem, walletItem]
      .filter((it) => it?.type === 'gift')
      .map((it) => ({ kind: it.kind, id: idOf(it), name: it.name, gift_product_name: it.gift_product_name }));

    const pDisc = promoMoney ? Number(promoMoney.discount) || 0 : 0;
    const cDisc = couponMoney ? couponMoney.discount : 0;
    const promoSingle = pDisc > 0 ? Math.min(pDisc, stackCap) : 0;
    const couponSingle = cDisc > 0 ? Math.min(cDisc, stackCap) : 0;
    const pairAllowed = pDisc > 0 && cDisc > 0 && !!promoMoney?.stack_with_coupon && !!couponMoney?.stack;
    const pairTotal = pairAllowed ? Math.min(pDisc + cDisc, stackCap) : 0;
    let moneyDiscTotal = 0;
    let promoApplied = null;
    let couponApplied = null;
    let couponNotApplied = null;
    let pairCapped = false;
    if (pairAllowed && pairTotal > promoSingle && pairTotal > couponSingle) {
      moneyDiscTotal = pairTotal;
      promoApplied = { kind: 'promotion', id: promoMoney.promotion_id, name: promoMoney.name, code: promoMoney.code, amount: pDisc };
      couponApplied = { source: couponMoney.source, id: couponMoney.source === 'wallet' ? walletItem.customer_coupon_id : null, code: couponMoney.code, name: couponMoney.name, amount: pairTotal - pDisc, state: 'stacked' };
      pairCapped = pDisc + cDisc > stackCap;
    } else if (cDisc > pDisc) {
      // Coupon thắng hẳn (hòa → phía KM thắng, như luật server).
      moneyDiscTotal = couponSingle;
      couponApplied = { source: couponMoney.source, id: couponMoney.source === 'wallet' ? walletItem.customer_coupon_id : null, code: couponMoney.code, name: couponMoney.name, amount: couponSingle, state: 'single' };
    } else if (pDisc > 0) {
      moneyDiscTotal = promoSingle;
      promoApplied = { kind: 'promotion', id: promoMoney.promotion_id, name: promoMoney.name, code: promoMoney.code, amount: promoSingle };
      if (cDisc > 0 && couponMoney) {
        couponNotApplied = { source: couponMoney.source, code: couponMoney.code, name: couponMoney.name };
      }
    } else if (cDisc > 0) {
      moneyDiscTotal = couponSingle;
      couponApplied = { source: couponMoney.source, id: couponMoney.source === 'wallet' ? walletItem.customer_coupon_id : null, code: couponMoney.code, name: couponMoney.name, amount: couponSingle, state: 'single' };
    }
    return {
      promotion_id: selPromo?.id ?? null,
      customer_coupon_id: selWallet?.id ?? null,
      voucher_code: voucherActive && voucherInfo ? voucherInfo.code : null,
      shipDiscTotal,
      moneyDiscTotal,
      totalDiscTotal: shipDiscTotal + moneyDiscTotal,
      promoApplied,
      couponApplied,
      couponNotApplied,
      shipApplied,
      giftApplied,
      pairCapped,
      hasSelection: !!(selPromo || selWallet || (voucherActive && voucherInfo)),
    };
  }, [offers, subtotal, shipFee, promoItem, walletItem, promoMoney, walletMoney, couponMoney, selPromo, selWallet, voucherActive, voucherInfo]);

  useEffect(() => { onResolve?.(resolved); }, [resolved, onResolve]);

  // ===== Khóa/dồn nhóm cho mã TIỀN HÀNG (mã phí ship/tặng món miễn nhiễm) =====
  const moneyLockOf = (row) => {
    // row: {side: 'promo'|'coupon', stack: bool} — chỉ gọi cho mã tiền hàng eligible chưa chọn.
    const pOn = !!promoMoney;
    const cOn = !!couponMoney;
    if (pOn && cOn) return true; // đủ cặp → mọi mã tiền hàng còn lại khóa
    if (pOn) {
      if (row.side === 'promo') return true; // cùng phía KM không bao giờ chồng
      return !(promoMoney.stack_with_coupon && row.stack);
    }
    if (cOn) {
      if (row.side === 'coupon') return true;
      return !(couponMoney.stack && row.stack);
    }
    return false;
  };

  // Thứ tự hiển thị: mỏ neo (KM đã chọn → coupon đã chọn) → mã chồng được
  // dồn sát dưới → phần còn lại theo thứ tự gốc của server → mã chưa đủ
  // điều kiện ở cuối (thứ tự gốc). Thứ tự tương đối trong từng nhóm giữ
  // nguyên (ổn định). Voucher gõ tay là 1 dòng phía coupon, chèn theo số
  // giảm vào nhóm eligible như spec §5.
  const orderedRows = useMemo(() => {
    const elig = [];
    const inelig = [];
    items.forEach((it) => (it.eligible ? elig : inelig).push(it));
    let base = elig.map((it) => ({ item: it }));
    if (voucherInfo) {
      const vRow = {
        voucher: true,
        item: {
          kind: 'voucher', code: voucherInfo.code, name: voucherInfo.name || voucherInfo.code,
          type: 'percent', is_shipping: false, discount: voucherInfo.discount,
          stack_with_coupon: voucherInfo.stack_with_promotion, eligible: true,
        },
      };
      const idx = base.findIndex((r) => (Number(r.item.discount) || 0) < voucherInfo.discount);
      if (idx === -1) base.push(vRow); else base.splice(idx, 0, vRow);
    }
    const keyOf = (r) => (r.voucher ? `voucher-${r.item.code}` : `${r.item.kind}-${idOf(r.item)}`);
    const isSelMoney = (r) => {
      if (r.voucher) return !!couponMoney && couponMoney.source === 'voucher';
      if (!isMoneyItem(r.item)) return false;
      if (r.item.kind === 'promotion') return !!promoMoney && promoMoney.promotion_id === r.item.promotion_id;
      return !!walletMoney && walletItem && walletItem.customer_coupon_id === r.item.customer_coupon_id;
    };
    const anchor = [];
    const partners = [];
    const rest = [];
    const singleOn = !!promoMoney !== !!couponMoney;
    base.forEach((r) => {
      if (isSelMoney(r)) { anchor.push(r); return; }
      if (singleOn && isMoneyItem(r.item)) {
        const row = r.voucher
          ? { side: 'coupon', stack: !!voucherInfo?.stack_with_promotion }
          : { side: r.item.kind === 'promotion' ? 'promo' : 'coupon', stack: !!r.item.stack_with_coupon };
        if (!moneyLockOf(row)) { partners.push(r); return; }
      }
      rest.push(r);
    });
    // Mỏ neo: KM trước, coupon sau (như trạng thái 4 của demo).
    anchor.sort((a, b) => (a.item.kind === 'promotion' ? 0 : 1) - (b.item.kind === 'promotion' ? 0 : 1));
    return [...anchor, ...partners, ...rest, ...inelig.map((it) => ({ item: it }))].map((r) => ({ ...r, key: keyOf(r) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, voucherInfo, promoMoney, walletMoney, couponMoney, walletItem]);

  const rowState = (r) => {
    const it = r.item;
    if (!it.eligible) return { dim: true, locked: false, selected: false, ineligible: true };
    if (r.voucher) {
      const active = !!couponMoney && couponMoney.source === 'voucher';
      if (active) return { dim: false, locked: false, selected: true };
      // Đã nhận nhưng chưa áp: khóa khi phía coupon tiền hàng đang có mã
      // khác, hoặc KM đang chọn không chồng được với nó.
      const blocked = !!walletMoney || (!!promoMoney && !(promoMoney.stack_with_coupon && voucherInfo?.stack_with_promotion));
      return { dim: blocked, locked: blocked, selected: false, voucherInactive: true };
    }
    const selected = (it.kind === 'promotion' && selPromo?.id === it.promotion_id)
      || (it.kind === 'wallet_coupon' && selWallet?.id === it.customer_coupon_id);
    if (!isMoneyItem(it)) return { dim: false, locked: false, selected: !!selected };
    if (selected) return { dim: false, locked: false, selected: true };
    const locked = moneyLockOf({ side: it.kind === 'promotion' ? 'promo' : 'coupon', stack: !!it.stack_with_coupon });
    return { dim: locked, locked, selected: false };
  };

  const toggleRow = (r) => {
    const st = rowState(r);
    if (st.ineligible || st.locked) return;
    const it = r.item;
    if (r.voucher) {
      if (!st.selected) setVoucherActive(true);
      return;
    }
    if (it.kind === 'promotion') {
      setSelPromo((cur) => (cur?.id === it.promotion_id ? null : { id: it.promotion_id }));
    } else {
      setSelWallet((cur) => (cur?.id === it.customer_coupon_id ? null : { id: it.customer_coupon_id }));
    }
    setOfferWarn('');
  };

  // Hiệu ứng trượt khi dồn nhóm (FLIP nhẹ, không nảy — DESIGN.md).
  const rowRefs = useRef(new Map());
  const prevTops = useRef(new Map());
  useLayoutEffect(() => {
    if (!panelOpen) { prevTops.current = new Map(); return; }
    const tops = new Map();
    rowRefs.current.forEach((el, k) => { if (el) tops.set(k, el.getBoundingClientRect().top); });
    tops.forEach((top, k) => {
      const prev = prevTops.current.get(k);
      const el = rowRefs.current.get(k);
      if (el && prev != null && Math.abs(prev - top) > 2) {
        const dy = prev - top;
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 260ms ease';
          el.style.transform = '';
        });
      }
    });
    prevTops.current = tops;
  }, [orderedRows, panelOpen, offerSearch]);

  // Chân panel: dòng hướng dẫn động theo trạng thái (spec mục 1.7).
  const footerHint = (() => {
    const names = [];
    if (promoMoney) names.push(promoMoney.name);
    if (couponMoney) names.push(couponMoney.name);
    if (!promoMoney && !couponMoney) {
      return { main: 'Chưa chọn ưu đãi nào', sub: null, subGreen: false };
    }
    if (promoMoney && couponMoney) {
      return { main: `Đang chọn: ${names.join(' + ')}`, sub: resolved.pairCapped ? 'Đã chạm trần giảm tối đa' : 'Đã đủ cặp — bỏ chọn 1 mã để đổi mã khác', subGreen: false };
    }
    const only = promoMoney || couponMoney;
    const onlyStack = promoMoney ? !!promoMoney.stack_with_coupon : !!couponMoney.stack;
    if (!onlyStack) {
      return { main: `Đang chọn: ${only.name}`, sub: 'Mã này không cộng dồn — bỏ chọn để mở lại các mã khác', subGreen: false };
    }
    return {
      main: `Đang chọn: ${only.name}`,
      sub: promoMoney ? 'Chọn thêm 1 coupon sáng ở trên để cộng dồn' : 'Chọn thêm 1 khuyến mãi sáng ở trên để cộng dồn',
      subGreen: true,
    };
  })();

  const q = offerSearch.trim().toLowerCase();
  const visibleRows = q
    ? orderedRows.filter((r) => String(r.item.name || '').toLowerCase().includes(q) || String(r.item.code || '').toLowerCase().includes(q))
    : orderedRows;
  const couponNames = new Set(items.filter((i) => i.kind === 'wallet_coupon').map((i) => i.name));

  return (
    <>
      {/* ===== Khối Ưu đãi (thẻ tóm tắt ở trang thanh toán) ===== */}
      <div
        onClick={() => setPanelOpen(true)}
        style={{ background: '#fff', border: '1.5px solid #fde68a', borderRadius: 12, padding: 12, marginBottom: 14, cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>🎁 Ưu đãi</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {resolved.totalDiscTotal > 0 && <b style={{ color: '#16a34a', fontSize: 13.5 }}>−{fmt(resolved.totalDiscTotal)}đ</b>}
            <span style={{ color: '#999', fontSize: 18 }}>›</span>
          </span>
        </div>
        {resolved.shipApplied.filter((s) => s.amount > 0).map((s) => (
          <div key={`${s.kind}-${s.id}`} style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>🚚 {s.name}: giảm ship {fmt(s.amount)}đ</div>
        ))}
        {resolved.giftApplied.map((g) => (
          <div key={`${g.kind}-${g.id}`} style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>🎁 {g.name}: tặng {g.gift_product_name}</div>
        ))}
        {resolved.promoApplied && (
          <div style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
            🎉 {resolved.promoApplied.name}: −{fmt(resolved.promoApplied.amount)}đ{resolved.couponApplied?.state === 'stacked' ? ' (cộng dồn)' : ''}
          </div>
        )}
        {resolved.couponApplied && (
          <div style={{ fontSize: 12.5, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
            <CouponIcon size={14} /> {resolved.couponApplied.source === 'voucher' ? 'Voucher' : 'Coupon'} {resolved.couponApplied.code}: −{fmt(resolved.couponApplied.amount)}đ{resolved.couponApplied.state === 'stacked' ? ' (cộng dồn)' : ''}{resolved.pairCapped ? ' — đã chạm trần giảm tối đa' : ''}
          </div>
        )}
        {resolved.couponNotApplied && resolved.couponNotApplied.source === 'voucher' && (
          <div style={{ fontSize: 12.5, color: '#92400e', fontWeight: 600, marginTop: 4 }}>
            <CouponIcon size={14} /> Voucher {resolved.couponNotApplied.code} chưa áp dụng cho đơn này — áp cùng {promoMoney?.name} không lợi hơn; mã giữ nguyên, chưa bị trừ lượt.
          </div>
        )}
        {offerWarn && (
          <div style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, marginTop: 4 }}>⚠ {offerWarn}</div>
        )}
        {voucherMsg && (
          <div style={{ fontSize: 12.5, color: '#92400e', fontWeight: 600, marginTop: 4 }}>{voucherMsg}</div>
        )}
        {!resolved.hasSelection && !voucherInfo && !offerWarn && (
          <div style={{ fontSize: 12.5, color: '#888', marginTop: 4 }}>
            {(() => {
              const best = Math.max(0, ...items.filter((i) => i.eligible).map((i) => Number(i.discount) || 0));
              return best > 0 ? `Có ưu đãi giảm đến ${fmt(best)}đ — chạm để chọn` : 'Nhập mã giảm giá nếu có';
            })()}
          </div>
        )}
      </div>

      {/* ===== Sheet chọn ưu đãi ===== */}
      {panelOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setPanelOpen(false)}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 480, maxHeight: '92vh', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#D5DAE4', margin: '8px auto 2px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 16px 0' }}>
              <b style={{ fontSize: 17, fontWeight: 800, color: '#24305E' }}>Ưu đãi</b>
              <button type="button" onClick={() => setPanelOpen(false)}
                style={{ width: 44, height: 44, border: 'none', background: 'transparent', fontSize: 20, color: '#666', cursor: 'pointer' }}><ZmIcon name="x" size={16} /></button>
            </div>
            <div style={{ fontSize: 12.5, color: '#757575', padding: '0 16px 10px' }}>
              Mức giảm tính theo giỏ hiện tại · chọn tối đa 1 khuyến mãi + 1 coupon khi được cộng dồn
            </div>
            <div style={{ overflowY: 'auto', padding: '0 16px 8px' }}>
              {/* Ô nhập voucher gõ tay — giữ nguyên vị trí hiện tại trong panel */}
              <div style={{ fontWeight: 700, fontSize: 13.5, margin: '4px 0 6px' }}><CouponIcon size={15} /> Mã voucher</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={voucher}
                  onChange={(e) => { setVoucher(e.target.value); setVoucherInfo(null); setVoucherActive(false); setVoucherErr(''); setVoucherMsg(''); }}
                  placeholder="NHẬP MÃ NẾU CÓ"
                  style={{ flex: 1, minWidth: 0, minHeight: 44, border: '1px solid #ddd', borderRadius: 8, padding: '0 12px', textTransform: 'uppercase', fontSize: 14 }} />
                <button type="button" className="zm-btn-inline" style={{ minHeight: 44 }}
                  onClick={() => checkVoucher(voucher)}>
                  Áp dụng
                </button>
              </div>
              {voucherErr && <div style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 6, fontWeight: 600 }}>⚠ {voucherErr}</div>}
              {voucherMsg && <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 6, fontWeight: 600 }}>{voucherMsg}</div>}
              <SearchInput value={offerSearch} onChange={(e) => setOfferSearch(e.target.value)} onSearch={(v) => setOfferSearch(v)}
                placeholder="Tìm ưu đãi theo tên hoặc mã…"
                style={{ marginTop: 14 }} inputStyle={{ minHeight: 44, border: '1px solid #ddd', borderRadius: 8, padding: '0 12px', fontSize: 14 }} />
              <div style={{ marginTop: 12 }}>
                {visibleRows.length === 0 && (
                  <div style={{ fontSize: 13, color: '#888', padding: '14px 2px' }}>
                    {q ? `Không có ưu đãi nào khớp '${offerSearch.trim()}' — mã giảm giá gõ tay nhập ở ô Mã voucher phía trên.` : 'Chưa có ưu đãi nào cho đơn này.'}
                  </div>
                )}
                {visibleRows.map((r) => {
                  const it = r.item;
                  const st = rowState(r);
                  const isKm = it.kind === 'promotion';
                  const rightAmt = it.is_shipping
                    ? { big: it.eligible ? `−${fmt(it.discount)}đ` : '', sub: 'phí giao' }
                    : it.type === 'gift'
                      ? { big: '', sub: '' }
                      : it.eligible
                        ? { big: `−${fmt(it.discount)}đ`, sub: 'trên giỏ này' }
                        : { big: Number(it.would_discount) > 0 ? `−${fmt(it.would_discount)}đ` : '', sub: '' };
                  return (
                    <div key={r.key}
                      ref={(el) => { if (el) rowRefs.current.set(r.key, el); else rowRefs.current.delete(r.key); }}
                      onClick={() => toggleRow(r)}
                      style={{
                        position: 'relative', display: 'flex', gap: 12, alignItems: 'center', background: st.selected ? '#F6F8FF' : '#fff',
                        border: `1.5px solid ${st.selected ? '#24305E' : '#E4E8F0'}`, borderRadius: 12, padding: 12, marginBottom: 10, minHeight: 64,
                        cursor: st.locked || st.ineligible ? 'not-allowed' : 'pointer', opacity: st.dim ? (st.ineligible ? 0.55 : 0.42) : 1,
                        boxShadow: st.selected ? '0 2px 10px rgba(36,48,94,.10)' : 'none',
                      }}>
                      <span style={{
                        width: 22, height: 22, flex: '0 0 22px', borderRadius: 7, boxSizing: 'border-box',
                        border: `2px solid ${st.selected ? '#24305E' : '#C3CADB'}`,
                        background: st.selected ? '#24305E' : (st.locked ? '#EEF1F6' : 'transparent'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800,
                      }}>{st.selected ? '✓' : (st.locked ? <span style={{ fontSize: 11 }}>🔒</span> : '')}</span>
                      <span style={{
                        width: 40, height: 40, flex: '0 0 40px', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isKm ? '#FFF3DE' : '#E9EEF9',
                        color: isKm ? '#D98A06' : '#24305E',
                      }}>
                        <ZmIcon name={isKm ? 'gift' : 'ticket'} size={20} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14.5, fontWeight: 700, color: '#1A1A1A' }}>
                          {it.name}
                          <span style={{
                            fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '2px 8px', letterSpacing: '.02em',
                            background: isKm ? '#FFF3DE' : '#E9EEF9', color: isKm ? '#8A5A00' : '#24305E',
                          }}>{isKm ? 'KHUYẾN MÃI' : 'COUPON'}</span>
                          {isKm && couponNames.has(it.name) && (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#24305E', background: '#EDF0F8', borderRadius: 999, padding: '1px 7px' }}>Khuyến mãi</span>
                          )}
                          {r.voucher && st.voucherInactive && (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#92400e', background: '#fffbeb', borderRadius: 999, padding: '1px 7px' }}>Đã nhận — chưa áp</span>
                          )}
                        </span>
                        {it.kind === 'wallet_coupon' && it.code && (
                          <span style={{ display: 'block', fontSize: 12.5, color: '#757575', marginTop: 2, lineHeight: 1.45 }}>
                            Mã {it.code}
                            {it.expires_at ? (() => {
                              const [y, m, d] = String(it.expires_at).split('-');
                              const daysLeft = Math.ceil((new Date(`${it.expires_at}T23:59:59`) - new Date()) / 86400000);
                              return <> · Hạn dùng <span style={daysLeft <= 7 ? { color: '#D97706', fontWeight: 700 } : undefined}>{d}/{m}/{y}</span></>;
                            })() : null}
                          </span>
                        )}
                        {it.is_shipping && (
                          <span style={{ display: 'block', fontSize: 12.5, color: '#757575', marginTop: 2 }}>Giảm phí giao hàng</span>
                        )}
                        {it.type === 'gift' && (
                          <span style={{ display: 'block', fontSize: 12.5, color: '#757575', marginTop: 2 }}>Tặng {it.gift_product_name || 'món'}</span>
                        )}
                        {st.ineligible && (
                          <span style={{ display: 'block', fontSize: 12.5, color: '#b91c1c', marginTop: 2 }}>
                            {it.reason_code === 'MIN_ORDER' && it.missing_amount
                              ? `Đặt thêm ${fmt(it.missing_amount)}đ để được hưởng`
                              : (it.reason_text || 'Chưa đủ điều kiện cho đơn này')}
                          </span>
                        )}
                      </span>
                      {it.type === 'gift' ? (
                        <span style={{ textAlign: 'right', flex: '0 0 auto', fontSize: 13, fontWeight: 700, color: st.dim ? '#999' : '#2E7D4F' }}>
                          Tặng {it.gift_product_name || 'món'}
                        </span>
                      ) : rightAmt.big ? (
                        <span style={{ textAlign: 'right', flex: '0 0 auto' }}>
                          <b style={{ fontSize: 17, color: st.dim ? '#999' : '#2E7D4F', fontVariantNumeric: 'tabular-nums', display: 'block' }}>{rightAmt.big}</b>
                          {rightAmt.sub && <span style={{ fontSize: 11, color: '#757575' }}>{rightAmt.sub}</span>}
                        </span>
                      ) : null}
                      {r.voucher && (
                        <button type="button" aria-label="Gỡ voucher"
                          onClick={(e) => { e.stopPropagation(); setVoucherInfo(null); setVoucherActive(false); setVoucher(''); setVoucherMsg(''); }}
                          style={{ position: 'absolute', top: 4, right: 4, width: 36, height: 36, border: 'none', background: 'transparent', color: '#999', cursor: 'pointer' }}>
                          <ZmIcon name="x" size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ borderTop: '1px solid #E4E8F0', padding: '12px 16px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: '#555', lineHeight: 1.5 }}>
                  {footerHint.main}
                  {footerHint.sub && <><br /><span style={{ color: footerHint.subGreen ? '#2E7D4F' : '#9AA0B4', fontSize: 12, fontWeight: footerHint.subGreen ? 600 : 400 }}>{footerHint.sub}</span></>}
                </span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#24305E', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>−{fmt(resolved.totalDiscTotal)}đ</span>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 50, border: 'none', borderRadius: 12, background: '#24305E', color: '#fff', fontSize: 15.5, fontWeight: 700, marginTop: 12, cursor: 'pointer' }}>
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default PromoPanel;
