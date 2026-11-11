import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { fmtDateTime } from './utils/format';
import { useBranch } from './contexts/BranchContext'; // C4: CN của KDS = trạng thái CN dùng chung (lưu theo tài khoản)
import {
  ChefHat, Clock, CheckCircle2, RefreshCw,
  Volume2, VolumeX, Check, Store, ShoppingCart, Eye, X, Printer, Receipt
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Gói 51: KDS dạng danh sách gọn — mã đơn, loại đơn, tổng tiền, thời gian nhận.
// Chi tiết xem trong popup. Nhận đơn: Xem/Xác nhận/Từ chối.
// Đang pha chế: In tem/In Bill (bấm lại -> In lại), Đã làm xong.

// Tên món + tùy chọn
const itemName = (it) => {
  const base = it.product?.name ?? it.product_name ?? '';
  const opts = [];
  if (it.option?.name) opts.push(it.option.name);
  const o = it.options;
  if (o && typeof o === 'object') opts.push(...Object.values(o));
  else if (typeof o === 'string' && o) opts.push(o);
  return { base, opts: opts.filter(Boolean).join(', ') };
};

// P0-2: escape HTML cho ghi chú món khi in (chống vỡ layout tem/bill)
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// In tem 50x30 qua hộp thoại in của trình duyệt
function printLabels(order, itemIds) {
  const items = [];
  let seq = 0;
  const labelItems = order.items?.filter((it) => it.product?.print_label !== false) || [];
  const total = labelItems.reduce((s, it) => s + (it.quantity || 1), 0);
  for (const it of labelItems) {
    if (itemIds && !itemIds.includes(it.id)) continue;
    const { base, opts } = itemName(it);
    for (let q = 0; q < (it.quantity || 1); q++) {
      seq++;
      // P0-2: in ghi chú món lên tem để barista pha đúng
      items.push({ seq, total, name: base, opts, note: it.note || '' });
    }
  }
  if (!items.length) { alert('Không có món nào cần in tem.'); return; }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tem ${order.code}</title>
<style>@media print{@page{size:50mm 30mm;margin:0}}body{margin:0;font-family:sans-serif}
.label{width:50mm;height:30mm;padding:2mm;box-sizing:border-box;page-break-after:always;overflow:hidden}
.code{font-family:monospace;font-size:9pt;font-weight:bold}
.name{font-size:11pt;font-weight:bold;margin:1mm 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opts{font-size:8pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note{font-size:9pt;font-weight:bold;color:#000;background:#ffe08a;padding:0.5mm 1mm;margin-top:0.5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style></head><body>` +
    items.map((l) => `<div class="label"><div class="code">${order.code} - ${l.seq}/${l.total}</div><div class="name">${escHtml(l.name)}</div><div class="opts">${escHtml(l.opts)}</div>${l.note ? `<div class="note">📝 ${escHtml(l.note)}</div>` : ''}</div>`).join('') +
    `</body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

// In bill qua hộp thoại in của trình duyệt
function printBill(order) {
  const rows = (order.items || []).map((it) => {
    const { base, opts } = itemName(it);
    const qty = it.quantity || 1;
    const amt = Number(it.line_total || it.price * qty || 0);
    // P0-2: in ghi chú món lên bill
    const noteHtml = it.note ? `<br><small>📝 ${escHtml(it.note)}</small>` : '';
    return `<tr><td>${qty}x ${escHtml(base)}${opts ? `<br><small>${escHtml(opts)}</small>` : ''}${noteHtml}</td><td align="right">${amt.toLocaleString('vi-VN')}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${order.code}</title>
<style>@media print{@page{size:80mm auto;margin:0}}body{margin:0;font-family:monospace;font-size:10pt;padding:3mm}
h2{text-align:center;margin:0 0 2mm}.c{text-align:center}table{width:100%;border-collapse:collapse}
td{padding:1mm 0;border-bottom:1px dashed #999}.t{font-weight:bold;font-size:12pt}</style></head><body>
<h2>${order.branch_name || ''}</h2><div class="c">Mã đơn: <b>${order.code}</b><br>${fmtDateTime(order.created_at)}</div>
<table>${rows}</table>
<div class="c t" style="margin-top:2mm">Tổng: ${Number(order.total_amount || 0).toLocaleString('vi-VN')}đ</div>
<div class="c" style="margin-top:2mm">Cảm ơn quý khách!</div></body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

// Dòng đơn hàng dạng danh sách
function KdsOrderRow({ ord, elapsed, typeLabel, warnLine, children }) {
  // P0-2: badge cảnh báo khi có món ghi chú (ít đá/ít đường...) để barista mở chi tiết
  const hasItemNote = (ord.items || []).some((it) => it.note && String(it.note).trim());
  return (
    <div className="bg-slate-800/90 rounded-2xl p-4 border border-slate-700 space-y-2.5">
      <div className="flex justify-between items-center">
        <span className="font-mono font-extrabold text-emerald-400 text-sm">#{ord.code}</span>
        <span className={`flex items-center gap-1 text-xs font-bold ${elapsed > 10 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>
          <Clock className="w-3.5 h-3.5" /> {elapsed} phút
        </span>
      </div>
      {hasItemNote && (
        <div className="px-2.5 py-1.5 rounded-xl bg-amber-400 text-slate-900 text-xs font-extrabold animate-pulse">
          📝 Đơn có ghi chú món — bấm "Xem" để đọc kỹ
        </div>
      )}
      {warnLine && (
        <div className="px-2.5 py-1.5 rounded-xl bg-red-500/20 border border-red-500/60 text-red-300 text-xs font-extrabold animate-pulse">
          {warnLine}
        </div>
      )}
      <div className="flex items-center justify-between">
        {typeLabel ? (
          <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 font-bold border border-sky-500/30 text-xs">
            {typeLabel}
          </span>
        ) : <span />}
        <span className="font-mono font-extrabold text-slate-100">
          {Number(ord.total_amount || 0).toLocaleString('vi-VN')}đ
        </span>
      </div>
      {ord.scheduled_at && (
        <p className="text-[11px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-xl px-2.5 py-1.5">
          📅 Hẹn: {fmtDateTime(ord.scheduled_at)}
        </p>
      )}
      <div className="flex gap-2 flex-wrap">{children}</div>
    </div>
  );
}

// Popup chi tiết đơn
function OrderDetailPop({ ord, onClose, typeLabel }) {
  if (!ord) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="relative bg-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col border border-slate-600" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-lg" title="Đóng">×</button>
        <div className="overflow-y-auto p-5">
        <h3 className="font-extrabold mb-3">🧾 Chi tiết đơn #{ord.code}</h3>
        <div className="space-y-2 text-sm">
          {(ord.items || []).map((it) => {
            const { base, opts } = itemName(it);
            return (
              <div key={it.id} className="flex justify-between border-b border-slate-700/60 pb-2">
                <div>
                  <span className="font-bold">{it.quantity}x {base}</span>
                  {opts && <div className="text-xs text-slate-400">{opts}</div>}
                  {/* P0-2: ghi chú từng món (ít đá/ít đường...) hiển thị nổi bật */}
                  {it.note && (
                    <div className="mt-1 inline-block px-2 py-1 rounded-lg bg-amber-400 text-slate-900 text-xs font-extrabold">
                      📝 {it.note}
                    </div>
                  )}
                </div>
                {/* Lát 2g (2026-11-04): đơn online lưu tiền dòng ở total_price, không có
                    line_total → trước đây hiện 0đ. Chuỗi dự phòng: total_price →
                    line_total → đơn giá (unit_price gồm phụ phí tùy chọn) × số lượng. */}
                <span className="font-mono">{Number(it.total_price ?? it.line_total ?? (it.unit_price || it.price || 0) * (it.quantity || 1)).toLocaleString('vi-VN')}đ</span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between font-extrabold mt-3 text-base">
          <span>Tổng cộng</span>
          <span>{Number(ord.total_amount || 0).toLocaleString('vi-VN')}đ</span>
        </div>
        <div className="text-xs text-slate-400 mt-3 space-y-1">
          {ord.customer_name && <p>👤 {ord.customer_name} ({ord.customer_phone})</p>}
          {/* Spec KDS book ship mục 5.5: địa chỉ + điểm ghim ĐÃ GỬI HÃNG kèm dấu đính chính — căn cứ đối soát khi khiếu nại giao sai điểm */}
          {ord.delivery_address && (
            <p>📍 {ord.delivery_address}
              {ord.delivery_dropoff_lat && <> · Ghim: {Number(ord.delivery_dropoff_lat).toFixed(5)}, {Number(ord.delivery_dropoff_lng).toFixed(5)}</>}
              {ord.pin_corrected && <span className="text-amber-400 font-bold"> · Đã đính chính tại quán</span>}
            </p>
          )}
          {ord.delivery_failure_reason && <p className="text-red-400 font-bold">✖ Lý do giao thất bại: {ord.delivery_failure_reason}</p>}
          {/* Gói 60: thông tin tài xế giao hàng */}
          {ord.delivery_provider && (
            <p>🛵 {ord.delivery_provider === 'ahamove' ? 'AhaMove' : ord.delivery_provider === 'manual' ? 'Quán tự giao' : 'Lalamove'}
              {ord.delivery_failover_from && <span className="text-amber-400"> (failover)</span>}
              {ord.delivery_driver_name && <> · 👤 {ord.delivery_driver_name} ({ord.delivery_driver_phone})</>}
            </p>
          )}
          {ord.delivery_tracking_url && (
            <p><a href={ord.delivery_tracking_url} target="_blank" rel="noreferrer" className="text-sky-400 underline">📍 Theo dõi tài xế</a></p>
          )}
          {ord.note && <p className="italic">📝 "{ord.note}"</p>}
          {typeLabel && <p>Loại: {typeLabel}</p>}
        </div>
        <button onClick={onClose} className="w-full mt-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-bold">Đóng</button>
        </div>
      </div>
    </div>
  );
}

// Popup chọn món in lại tem
function ReprintPop({ ord, onClose }) {
  const [sel, setSel] = useState({});
  // Gói 55 p11ac: hooks phải gọi trước mọi return sớm (Rules of Hooks)
  const labelItems = ((ord && ord.items) || []).filter((it) => it.product?.print_label !== false);
  const toggle = (id) => setSel((s) => ({ ...s, [id]: !s[id] }));
  // Mặc định chọn tất cả
  useEffect(() => {
    const init = {};
    labelItems.forEach((it) => { init[it.id] = true; });
    setSel(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ord && ord.id]);
  if (!ord) return null;
  const ids = Object.keys(sel).filter((k) => sel[k]).map(Number);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="relative bg-slate-800 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col border border-slate-600" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-lg" title="Đóng">×</button>
        <div className="overflow-y-auto p-5">
        <h3 className="font-extrabold mb-3">🖨 Chọn món in lại tem</h3>
        {labelItems.map((it) => {
          const { base, opts } = itemName(it);
          return (
            <label key={it.id} className="flex gap-3 items-start py-2.5 border-b border-slate-700/60 cursor-pointer">
              <input type="checkbox" checked={!!sel[it.id]} onChange={() => toggle(it.id)} className="w-5 h-5 mt-0.5" />
              <div className="text-sm">
                <b>{it.quantity}x {base}</b>
                {opts && <div className="text-xs text-slate-400">{opts}</div>}
              </div>
            </label>
          );
        })}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { printLabels(ord, ids); onClose(); }}
            className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" /> In tem đã chọn
          </button>
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-bold">Đóng</button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Spec KDS book ship (2026-11-06): khối giao hàng trên thẻ đơn cột Chờ Giao
// + popup Đặt Giao Hàng (báo phí · đối chiếu địa chỉ · đính chính ghim).
// ============================================================

const fmtMoney = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const PROV_LABEL = { ahamove: 'AhaMove', lalamove: 'Lalamove', manual: 'Quán tự giao' };

// Bản đồ nhỏ OSM (ô gạch zoom 17, không cần thư viện): hiện điểm ghim,
// bấm vào bản đồ để đặt lại ghim (đính chính mục 5.4)
function PinMap({ center, pin, onPick }) {
  const Z = 17, TS = 256, W = 3 * TS, H = 2 * TS;
  const merc = (lat, lng) => {
    const s = TS * Math.pow(2, Z);
    const rad = (lat * Math.PI) / 180;
    return {
      x: ((lng + 180) / 360) * s,
      y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * s,
    };
  };
  const inv = (x, y) => {
    const s = TS * Math.pow(2, Z);
    const lng = (x / s) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / s;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
  };
  const c = merc(center.lat, center.lng);
  const x0 = Math.floor((c.x - W / 2) / TS), y0 = Math.floor((c.y - H / 2) / TS);
  const tiles = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const tx = x0 + i, ty = y0 + j;
    tiles.push(
      <img key={`${tx}-${ty}`} src={`https://tile.openstreetmap.org/${Z}/${tx}/${ty}.png`} alt="" draggable={false}
        style={{ position: 'absolute', left: tx * TS - (c.x - W / 2), top: ty * TS - (c.y - H / 2), width: TS, height: TS }} />
    );
  }
  const pinPos = pin ? (() => { const p = merc(pin.lat, pin.lng); return { left: p.x - (c.x - W / 2), top: p.y - (c.y - H / 2) }; })() : null;
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const bx = (e.clientX - r.left) - (r.width - W) / 2 + (c.x - W / 2);
    const by = (e.clientY - r.top) - (r.height - H) / 2 + (c.y - H / 2);
    onPick(inv(bx, by));
  };
  return (
    <div onClick={pick} title="Bấm vào bản đồ để đặt lại điểm ghim"
      style={{ position: 'relative', width: '100%', height: 220, overflow: 'hidden', borderRadius: 12, cursor: 'crosshair', background: '#0f172a' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, transform: 'translate(-50%,-50%)' }}>
        {tiles}
        {pinPos && (
          <div style={{ position: 'absolute', left: pinPos.left, top: pinPos.top, transform: 'translate(-50%,-100%)', fontSize: 28, pointerEvents: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))' }}>📍</div>
        )}
      </div>
    </div>
  );
}

// Popup Đặt Giao Hàng: báo phí 2 hãng + quán chịu (mục 6b) + khối đối chiếu
// địa chỉ (mục 5.2) + cảnh báo lệch phía client (5.3b) + đính chính ghim (5.4)
function BookShipPop({ ord, onClose, onRefresh }) {
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [draftPin, setDraftPin] = useState(null);
  const [mismatch, setMismatch] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sugQ, setSugQ] = useState('');
  const [sugs, setSugs] = useState([]);

  const loadQuote = async () => {
    setLoading(true); setErr('');
    try {
      const res = await axios.post(`${API_BASE}/orders/${ord.id}/delivery/quote`);
      if (res.data?.success) { setQuote(res.data.data); setDraftPin(null); setArmed(false); }
      else setErr(res.data?.message || 'Không báo được phí');
    } catch (e) { setErr(e.response?.data?.message || 'Không báo được phí'); }
    setLoading(false);
  };
  useEffect(() => { loadQuote(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ord.id]);

  const pin = draftPin || (quote?.has_pin ? { lat: quote.pin_lat, lng: quote.pin_lng } : null);
  const center = pin || (quote?.pickup_lat ? { lat: quote.pickup_lat, lng: quote.pickup_lng } : { lat: 10.7769, lng: 106.7009 });

  // Mục 5.3b: so lệch ghim ↔ địa chỉ chữ NGAY PHÍA CLIENT (reverse-geocode
  // điểm ghim lấy quận/phường rồi đối chiếu với địa chỉ chữ). Chỉ cảnh báo —
  // không gửi server, không vào payload đặt. Geocoder lỗi/không rõ → im lặng.
  useEffect(() => {
    if (!quote?.has_pin) { setMismatch(false); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${quote.pin_lat}&lon=${quote.pin_lng}`);
        const j = await r.json();
        const a = j.address || {};
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
          .replace(/\b(quan|huyen|thi xa|thanh pho|phuong|xa)\b/g, ' ').replace(/\s+/g, ' ').trim();
        const addrN = norm(quote.address);
        const cands = [a.city_district, a.district, a.county, a.town].map(norm).filter((x) => x.length >= 3);
        if (!alive || !cands.length) return;
        setMismatch(!cands.some((cd) => addrN.includes(cd)));
      } catch { /* im lặng bỏ qua */ }
    })();
    return () => { alive = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [quote?.pin_lat, quote?.pin_lng]);

  const searchAddr = async () => {
    if (!sugQ.trim()) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=vn&q=${encodeURIComponent(sugQ)}`);
      const j = await r.json();
      setSugs(Array.isArray(j) ? j : []);
    } catch { setSugs([]); }
  };

  const savePin = async () => {
    if (!draftPin) return;
    setBusy(true);
    try {
      const res = await axios.post(`${API_BASE}/orders/${ord.id}/delivery/pin`, { lat: draftPin.lat, lng: draftPin.lng });
      if (res.data?.success) { setSugs([]); await loadQuote(); }
      else alert(res.data?.message || 'Không lưu được điểm ghim');
    } catch (e) { alert(e.response?.data?.message || 'Không lưu được điểm ghim'); }
    setBusy(false);
  };

  const doBook = async () => {
    if (mismatch && !armed) { setArmed(true); return; } // cảnh báo lệch: xác nhận thêm 1 lần
    setBusy(true);
    try {
      const res = await axios.post(`${API_BASE}/orders/${ord.id}/delivery/book`);
      if (res.data?.success) { onRefresh(); onClose(); }
      else alert(res.data?.message || 'Đặt hãng thất bại');
    } catch (e) { alert(e.response?.data?.message || 'Đặt hãng thất bại'); }
    setBusy(false);
  };

  const doManual = async () => {
    setBusy(true);
    try {
      const res = await axios.post(`${API_BASE}/orders/${ord.id}/delivery/manual/start`);
      if (res.data?.success) { onRefresh(); onClose(); }
      else alert(res.data?.message || 'Không bắt đầu được chế độ Quán Tự Đặt');
    } catch (e) { alert(e.response?.data?.message || 'Không bắt đầu được chế độ Quán Tự Đặt'); }
    setBusy(false);
  };

  const willLabel = quote?.will_use ? (quote.providers[quote.will_use]?.label || PROV_LABEL[quote.will_use]) : null;
  const bookDisabled = loading || !quote || !quote.has_pin || !quote.will_use || busy || !!draftPin;
  const bookLabel = !quote ? 'Đang báo phí…'
    : !quote.has_pin ? 'Chưa có điểm ghim — không đặt tự động được'
    : !quote.will_use ? 'Không có hãng khả dụng'
    : armed ? 'Đã kiểm tra địa chỉ — vẫn đặt'
    : quote.over_cap ? `Vẫn đặt — quán chịu ${fmtMoney(quote.shop_share)}`
    : `Xác nhận đặt — phí hãng ${fmtMoney(quote.chosen_fee)}`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="relative bg-slate-800 rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col border border-slate-600" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 w-11 h-11 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-lg" title="Đóng">×</button>
        <div className="overflow-y-auto p-5 space-y-4">
          <h3 className="font-extrabold">🚚 Đặt Giao Hàng — đơn #{ord.code}</h3>

          {/* Mục 5.2: khối đối chiếu địa chỉ sẽ gửi hãng */}
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-3 space-y-2">
            <div className="text-xs font-extrabold tracking-wide text-slate-300">📍 ĐỊA CHỈ GIAO SẼ GỬI HÃNG</div>
            <p className="text-sm font-semibold">{quote?.address || ord.delivery_address || '—'}</p>
            <p className="text-xs text-slate-400">
              {quote?.has_pin
                ? <>Khoảng cách theo điểm ghim: {quote.distance_km != null ? `${Number(quote.distance_km).toFixed(1)} km` : '—'} · Ghim: {Number(quote.pin_lat).toFixed(5)}, {Number(quote.pin_lng).toFixed(5)}{ord.pin_corrected && <span className="text-amber-400 font-bold"> · Đã đính chính tại quán</span>}</>
                : <span className="text-red-300 font-bold">Đơn chưa có tọa độ ghim — không đặt tự động được cho tới khi đính chính ghim bên dưới, hoặc chuyển Quán Tự Đặt.</span>}
            </p>
            {mismatch && quote?.has_pin && (
              <p className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-amber-400/15 border border-amber-400/50 text-amber-300">
                ⚠ Điểm ghim có thể lệch khu vực so với địa chỉ chữ — kiểm lại trên bản đồ trước khi đặt. Vẫn đặt được sau khi xác nhận thêm 1 lần.
              </p>
            )}
            <button onClick={() => setShowMap(!showMap)} className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold">
              {showMap ? 'Ẩn bản đồ' : '🗺 Xem vị trí ghim'}
            </button>
            {showMap && (
              <div className="space-y-2">
                <PinMap center={center} pin={pin} onPick={(p) => { setDraftPin(p); setArmed(false); }} />
                <p className="text-[11px] text-slate-400">Bấm vào bản đồ để đặt lại điểm ghim (đính chính). Phí khách đã trả <b>không tính lại</b>; phí hãng sẽ báo lại theo ghim mới.</p>
                <div className="flex gap-2">
                  <input value={sugQ} onChange={(e) => setSugQ(e.target.value)} placeholder="Hoặc gõ địa chỉ để chọn lại…"
                    className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm outline-none" />
                  <button onClick={searchAddr} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold">Tìm</button>
                </div>
                {sugs.map((s, i) => (
                  <button key={i} onClick={() => { setDraftPin({ lat: Number(s.lat), lng: Number(s.lon) }); setSugs([]); }}
                    className="block w-full text-left text-xs px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700">
                    📍 {s.display_name}
                  </button>
                ))}
                {draftPin && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-300 font-bold">Ghim mới: {draftPin.lat.toFixed(5)}, {draftPin.lng.toFixed(5)}</span>
                    <button onClick={savePin} disabled={busy} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold disabled:opacity-50">Lưu điểm ghim</button>
                    <button onClick={() => setDraftPin(null)} className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold">Hủy</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mục 6b: báo phí thật tại thời điểm đặt */}
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-3 space-y-2">
            <div className="text-xs font-extrabold tracking-wide text-slate-300">💰 PHÍ GIAO HÀNG</div>
            {loading && <p className="text-sm text-slate-400">Đang lấy phí thật từ các hãng…</p>}
            {err && <p className="text-sm text-red-300 font-bold">{err}</p>}
            {quote && (
              <>
                {Object.entries(quote.providers).map(([code, p]) => (
                  <div key={code} className="flex justify-between text-sm">
                    <span>{p.label} {quote.will_use === code && <span className="ml-1 text-[11px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Sẽ dùng</span>}</span>
                    {p.available
                      ? <b className="font-mono">{fmtMoney(p.fee)}</b>
                      : <span className="text-slate-400 text-xs">Không khả dụng{p.error ? ` — ${p.error}` : ''}</span>}
                  </div>
                ))}
                {quote.is_cod && <p className="text-[11px] text-slate-400">Đơn thu hộ (COD) — chỉ giao qua AhaMove theo quy định.</p>}
                <div className="border-t border-slate-700 pt-2 space-y-1 text-sm">
                  <div className="flex justify-between"><span>Phí ship khách đã trả</span><span className="font-mono">{fmtMoney(quote.customer_fee)}</span></div>
                  <div className="flex justify-between"><span>Phí hãng {willLabel ? `(${willLabel})` : ''}</span><span className="font-mono">{quote.chosen_fee != null ? fmtMoney(quote.chosen_fee) : '—'}</span></div>
                  <div className="flex justify-between font-extrabold"><span>Phần quán chịu</span><span className="font-mono">{quote.shop_share != null ? fmtMoney(quote.shop_share) : '—'}</span></div>
                  <p className="text-[11px] text-slate-400">Trần quán chịu: {fmtMoney(quote.cap)}/đơn.</p>
                </div>
                {quote.over_cap && (
                  <p className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/60 text-red-300">
                    🔴 Quán chịu vượt trần: {fmtMoney(quote.shop_share)} (trần {fmtMoney(quote.cap)}) — đặt thành công sẽ ghi log đối soát cuối ngày.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={doManual} disabled={busy}
              className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-bold disabled:opacity-50">
              Chuyển Quán Tự Đặt
            </button>
            <button onClick={doBook} disabled={bookDisabled}
              className={`flex-1 py-2.5 rounded-xl text-sm font-extrabold disabled:opacity-50 ${quote?.over_cap ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'} text-white`}>
              {bookLabel}
            </button>
          </div>
          {draftPin && <p className="text-[11px] text-amber-300">Đang có ghim mới chưa lưu — lưu điểm ghim (hoặc Hủy) rồi mới đặt được, để hãng nhận đúng điểm đã kiểm.</p>}
        </div>
      </div>
    </div>
  );
}

// Khối giao hàng trên thẻ đơn ở cột Chờ Giao: khung phí + nút trạng thái chạy
// theo delivery_status (mục 3 + 6). Đơn giao nằm yên ở cột này suốt quá trình.
function DeliveryPanel({ ord, btnBase, timeoutMin, carrierAvailable, onBook, onStartManual, onToManual, onAdvance, onFail, onComplete }) {
  const ds = ord.delivery_status || '';
  const isManual = ord.delivery_provider === 'manual';
  const customerFee = Number(ord.shipping_fee || 0);
  const carrierFee = ord.delivery_fee != null ? Number(ord.delivery_fee) : null;
  const share = carrierFee != null ? Math.max(0, carrierFee - customerFee) : null;
  const chip = "w-full px-3 py-2 rounded-xl text-xs font-extrabold text-center border";

  // Vị trí (c): phí hãng thật sau khi đặt
  const feeAfter = !isManual && carrierFee != null && (
    <div className="w-full px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs font-semibold">
      Phí hãng ({PROV_LABEL[ord.delivery_provider] || ''}): <b className="font-mono">{fmtMoney(carrierFee)}</b> · Quán chịu: <b className="font-mono">{fmtMoney(share)}</b>
    </div>
  );

  if (ds === 'failed') {
    return (
      <>
        <div className="w-full px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/60 text-red-300 text-xs font-bold">
          ✖ Giao thất bại{ord.delivery_failure_reason ? <> — {ord.delivery_failure_reason}</> : ''}. Đơn ở lại Chờ Giao chờ quán xử lý.
        </div>
        {isManual && (
          <>
            {carrierAvailable && (
              <button onClick={() => onBook(ord)} className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}>🚚 Đặt Giao Hàng</button>
            )}
            <button onClick={() => onStartManual(ord)} className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}>🛵 Chạy lại Quán Tự Đặt</button>
          </>
        )}
        <button onClick={() => onComplete(ord)} className={`${btnBase} bg-slate-600 hover:bg-slate-500 text-white`}>Khách nhận tại quán — hoàn tất</button>
      </>
    );
  }
  if (ds === 'cancelled') {
    return (
      <>
        <div className={`${chip} bg-slate-700/40 border-slate-600 text-slate-300`}>Đã hủy giao</div>
        <button onClick={() => onComplete(ord)} className={`${btnBase} bg-slate-600 hover:bg-slate-500 text-white`}>Khách nhận tại quán — hoàn tất</button>
      </>
    );
  }

  if (isManual) {
    const steps = {
      '': { chipText: '🛵 Quán tự giao · Chờ tài xế nhận đơn', next: ['driver_assigned', '✅ Đã Có Tài Xế'] },
      driver_assigned: { chipText: '🛵 Quán tự giao · Đã có tài xế', next: ['delivering', '🏃 Tài Xế Đang Giao Hàng'] },
      delivering: { chipText: '🛵 Quán tự giao · Tài xế đang giao', next: ['arrived', '📍 Tài Xế Đã Đến Nơi'] },
      arrived: { chipText: '🛵 Quán tự giao · Tài xế đã đến nơi', next: ['delivered', '🎉 Giao Hàng Thành Công'] },
    };
    const st = steps[ds];
    if (st) {
      return (
        <>
          <div className="w-full px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs font-semibold">
            Phí ship khách đã trả: <b className="font-mono">{fmtMoney(customerFee)}</b> · Quán tự giao — không qua hãng
          </div>
          <div className={`${chip} bg-sky-500/10 border-sky-500/40 text-sky-300`}>{st.chipText}</div>
          <button onClick={() => onAdvance(ord, st.next[0])} className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}>{st.next[1]}</button>
          <button onClick={() => onFail(ord)} className={`${btnBase} bg-red-900/60 hover:bg-red-800 text-red-300`}>✖ Giao thất bại</button>
        </>
      );
    }
  }

  if (!ds && !ord.delivery_order_id) {
    // Chưa bắt đầu giao — khung phí (a) + 2 nút chọn chế độ
    return (
      <>
        <div className="w-full px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-700 text-xs font-semibold space-y-0.5">
          <div>Phí ship khách đã trả: <b className="font-mono">{fmtMoney(customerFee)}</b></div>
          {carrierAvailable
            ? <div className="text-slate-400">Phí hãng dự kiến: — bấm Đặt Giao Hàng để xem</div>
            : <div className="text-slate-400">Chưa cấu hình hãng giao — quán tự giao</div>}
        </div>
        {carrierAvailable && (
          <button onClick={() => onBook(ord)} className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}>🚚 Đặt Giao Hàng</button>
        )}
        <button onClick={() => onStartManual(ord)} className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}>🛵 Quán Tự Đặt Giao Hàng</button>
      </>
    );
  }

  if (ds === 'searching_driver') {
    const elapsed = ord.delivery_searching_since ? Math.max(0, Math.floor((Date.now() - new Date(ord.delivery_searching_since).getTime()) / 1000)) : 0;
    const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    const over = elapsed > timeoutMin * 60;
    return (
      <>
        <div className={`${chip} ${over ? 'bg-red-500/15 border-red-500/60 text-red-300 animate-pulse' : 'bg-amber-500/10 border-amber-500/40 text-amber-300'}`}>
          🔎 Đang tìm tài xế · {mmss}{over ? ` — quá ${timeoutMin} phút chưa có tài xế!` : ''}
        </div>
        {feeAfter}
        <button onClick={() => onToManual(ord)} className={`${btnBase} ${over ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}>
          {over ? '🛵 Chuyển Quán Tự Đặt Giao Hàng' : 'Hủy tìm — chuyển Quán Tự Đặt'}
        </button>
      </>
    );
  }

  const carrierChips = {
    driver_assigned: `✅ Đã có tài xế${ord.delivery_driver_name ? ` · ${ord.delivery_driver_name}` : ''}${ord.delivery_driver_plate ? ` · ${ord.delivery_driver_plate}` : ''}`,
    picked_up: '📦 Tài xế đã lấy hàng',
    delivering: '🏃 Đang giao hàng',
    delivered: '🎉 Giao thành công',
  };
  if (carrierChips[ds]) {
    return (
      <>
        <div className={`${chip} bg-emerald-500/10 border-emerald-500/40 text-emerald-300`}>{carrierChips[ds]}</div>
        {feeAfter}
      </>
    );
  }
  return null;
}

export default function KdsScreen({ onBackToClient }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [branches, setBranches] = useState([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false); // guard C4 (2026-10-21): chưa tải xong DS chi nhánh thì chưa gọi đơn
  // C4 (2026-10-21): BỎ mặc định cứng CN1 — CN của KDS lấy từ BranchContext dùng chung:
  // lựa chọn được lưu theo tài khoản (F5/lần sau giữ nguyên); đổi CN tại KDS = đổi trạng
  // thái chung. Lần đầu chưa chọn CN cụ thể (context = '0' Tất cả) thì tạm xem CN đầu
  // tiên trong danh sách — tên CN luôn hiện rõ ở ô chọn trên đầu màn hình.
  const { branchId, setBranchId } = useBranch();
  const selectedBranch = branchId !== '0' ? Number(branchId) : (branches[0]?.id || 1);
  // Vá đổi CN (2026-11-04, RUNTIME sống 23:06): đổi CN xong hàng đợi vẫn giữ
  // đơn CN cũ tới khi bấm Làm mới. Từ nay CN đang xem được giữ trong ref cập
  // nhật NGAY khi chọn (không chờ chu trình render/effect), và lần chọn mới
  // kích hoạt nạp lại tường minh — nhịp poll cũng đọc ref nên không thể kẹt
  // ở CN cũ vì bất kỳ độ trễ effect nào.
  const branchRef = useRef(selectedBranch);
  useEffect(() => { branchRef.current = selectedBranch; }, [selectedBranch]);
  const setSelectedBranch = (id) => { branchRef.current = id; setBranchId(String(id)); };
  const [detailOrd, setDetailOrd] = useState(null);
  const [reprintOrd, setReprintOrd] = useState(null);
  const [printedTem, setPrintedTem] = useState({}); // orderId -> true
  const [printedBill, setPrintedBill] = useState({});
  const seenIdsRef = useRef(null); // Gói chuông (2026-11-11): tập id đơn đã thấy trên bảng; null = chưa ghi mốc lượt nạp đầu
  const audioCtxRef = useRef(null); // Gói chuông (2026-11-11): MỘT AudioContext chung, tạo lười 1 lần
  // Spec KDS book ship: popup đặt ship + popup lý do giao thất bại + ngưỡng
  // cảnh báo tìm tài xế (đọc từ /delivery/config, mặc định 5 phút)
  const [bookOrdId, setBookOrdId] = useState(null);
  const [failOrd, setFailOrd] = useState(null);
  const [failReason, setFailReason] = useState('');
  const [deliveryTimeout, setDeliveryTimeout] = useState(5);
  // Gói ẩn nút hãng KDS (Đại Vương chốt 2026-11-11): mặc định FALSE (ẩn nút
  // "Đặt Giao Hàng") — chỉ bật khi /delivery/config trả về có ít nhất 1 hãng
  // enabled && configured; gọi lỗi cũng giữ FALSE (fail-safe Quán Tự Đặt).
  const [carrierAvailable, setCarrierAvailable] = useState(false);
  const [, setTick] = useState(0); // nhịp 1s cho đồng hồ đang tìm tài xế
  const alertedSearchRef = useRef(new Set()); // đơn đã kêu chuông quá ngưỡng (tránh kêu lặp mỗi nhịp poll)

  // Gói chuông (2026-11-11): MỘT AudioContext chung, tạo lười 1 lần — bản cũ
  // tạo context mới mỗi lần kêu và không resume → Chrome treo 'suspended'
  // trước lần chạm đầu tiên, chuông kêu mà không ra tiếng.
  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    return audioCtxRef.current;
  };

  // Mở khóa âm thanh ở cử chỉ đầu tiên (chạm / gõ phím): chính sách autoplay
  // của trình duyệt chỉ cho phát tiếng sau khi người dùng đã tương tác.
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  const playNotificationSound = () => {
    if (!soundEnabled) return;
    const audioCtx = getAudioCtx();
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) { /* bỏ qua */ }
  };

  const [pollFails, setPollFails] = useState(0); // UX 2026-10-26 (🟠8): trước đây poll lỗi bị nuốt im lặng — bếp không biết đang xem dữ liệu cũ
  const fetchKdsOrders = async (branchOverride) => {
    try {
      const res = await axios.get(`${API_BASE}/kds/orders?branch_id=${branchOverride ?? branchRef.current}`);
      if (res.data.success) {
        setPollFails(0);
        const newOrders = res.data.data;
        // Gói chuông (2026-11-11): kích hoạt theo ĐƠN MỚI XUẤT HIỆN (id chưa
        // từng thấy) — bản cũ đếm TỔNG số đơn nên hụt ca đơn cũ vừa xong +
        // đơn mới vào cùng nhịp (tổng không đổi). Lượt nạp thành công đầu
        // tiên chỉ ghi mốc, không kêu.
        if (seenIdsRef.current === null) {
          seenIdsRef.current = new Set(newOrders.map((o) => o.id));
        } else {
          const hasFresh = newOrders.some((o) => !seenIdsRef.current.has(o.id));
          newOrders.forEach((o) => seenIdsRef.current.add(o.id));
          if (hasFresh) playNotificationSound();
        }
        // Spec KDS book ship mục 4: chuông 1 lần cho mỗi đơn tìm tài xế quá ngưỡng
        newOrders.forEach((o) => {
          if (o.status === 'ready' && o.delivery_status === 'searching_driver' && o.delivery_searching_since
            && (Date.now() - new Date(o.delivery_searching_since).getTime()) > deliveryTimeout * 60000
            && !alertedSearchRef.current.has(o.id)) {
            alertedSearchRef.current.add(o.id);
            playNotificationSound();
          }
        });
        setOrders(newOrders);
      }
    } catch (error) { setPollFails((n) => n + 1); }
  };

  useEffect(() => {
    // Guard lần tải đầu: selectedBranch chỉ đáng tin sau khi DS chi nhánh về
    // (trước đó nó tạm rơi về CN1) — chờ branchesLoaded mới gọi đơn + chạy nhịp 3s.
    if (!branchesLoaded) return;
    fetchKdsOrders();
    const timer = setInterval(fetchKdsOrders, 3000);
    return () => clearInterval(timer);
  }, [selectedBranch, branchesLoaded]);

  // Lát 2g (2026-11-04): đổi chi nhánh thì đóng popup chi tiết/in lại đang mở —
  // popup giữ bản chụp của đơn thuộc chi nhánh cũ, không tự cập nhật theo nhịp
  // poll nên người dùng tưởng dữ liệu chi nhánh mới không nạp.
  useEffect(() => {
    setDetailOrd(null);
    setReprintOrd(null);
    setBookOrdId(null);
    setFailOrd(null);
    // Gói chuông (2026-11-11): đổi chi nhánh → ghi mốc lại tập đơn đã thấy,
    // lượt nạp đầu của chi nhánh mới không kêu oan cho đơn đang có sẵn.
    seenIdsRef.current = null;
  }, [selectedBranch]);

  // Spec KDS book ship: ngưỡng cảnh báo tìm tài xế từ cấu hình giao hàng
  // (dùng lại khóa delivery_failover_timeout_minutes — mục 4)
  useEffect(() => {
    axios.get(`${API_BASE}/delivery/config`)
      .then((res) => {
        const m = Number(res.data?.data?.failover_timeout_minutes);
        if (m > 0) setDeliveryTimeout(m);
        // Gói ẩn nút hãng KDS (2026-11-11): hãng dùng được = enabled && configured
        const providers = res.data?.data?.providers || {};
        setCarrierAvailable(Object.values(providers).some((p) => p && p.enabled && p.configured));
      })
      .catch(() => { /* giữ mặc định 5 phút + carrierAvailable = false */ });
  }, []);

  // Nhịp 1 giây cho đồng hồ đếm trên thẻ đang tìm tài xế
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    axios.get(`${API_BASE}/branches`)
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        setBranches(list);
        setBranchesLoaded(true);
      })
      .catch(() => setBranchesLoaded(true)); // lỗi tải DS: vẫn mở guard, selectedBranch rơi về mặc định như cũ — không treo trang
  }, []);

  const handleUpdateStatus = async (orderCode, nextStatus) => {
    try {
      const res = await axios.patch(`${API_BASE}/orders/${orderCode}/status`, { status: nextStatus });
      if (res.data.success) fetchKdsOrders();
    } catch (error) {
      alert(error.response?.data?.message || 'Không thể cập nhật trạng thái');
    }
  };

  // Gói SEC: Từ chối → gọi API cancel (hoàn kho/điểm/giải phóng bàn) thay vì updateStatus
  const handleReject = async (ord) => {
    if (!confirm(`Từ chối đơn #${ord.code}? Kho và điểm sẽ được hoàn lại.`)) return;
    try {
      const res = await axios.post(`${API_BASE}/orders/${ord.id}/cancel`, { reason: 'KDS từ chối' });
      if (res.data?.success) { alert('Đã từ chối và hoàn kho.'); fetchKdsOrders(); }
      else alert(res.data?.message || 'Lỗi');
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
  };

  const handleConfirmPayment = async (orderId, orderCode) => {
    if (!confirm(`Xác nhận đã nhận tiền đơn ${orderCode}? Đơn sẽ trừ kho và chuyển sang Đang pha chế.`)) return;
    try {
      const res = await axios.post(`${API_BASE}/orders/${orderId}/confirm-payment`);
      if (res.data?.success) fetchKdsOrders();
      else alert(res.data?.message || 'Lỗi');
    } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
  };

  // ---- Spec KDS book ship: thao tác giao hàng tại KDS ----
  const deliveryAction = async (ord, path, body) => {
    try {
      const res = await axios.post(`${API_BASE}/orders/${ord.id}/delivery/${path}`, body || {});
      if (res.data?.success) { fetchKdsOrders(); return true; }
      alert(res.data?.message || 'Thao tác thất bại');
      return false;
    } catch (e) { alert(e.response?.data?.message || 'Thao tác thất bại'); return false; }
  };
  const startManual = (ord) => deliveryAction(ord, 'manual/start');
  const toManual = (ord) => {
    if (!confirm(`Chuyển đơn #${ord.code} sang Quán Tự Đặt? Phiên đặt hãng đang tìm tài xế sẽ bị hủy.`)) return;
    deliveryAction(ord, 'to-manual');
  };
  const advanceManual = (ord, to) => deliveryAction(ord, 'manual/advance', { to });
  const openBook = (ord) => {
    // C3: đặt lại hãng sau khi đã chuyển tay phải qua hộp hỏi xác nhận riêng
    if (ord.delivery_provider === 'manual'
      && !confirm(`Đơn #${ord.code} đang ở chế độ Quán Tự Đặt — quán có thể đã gọi ship ngoài. Vẫn mở đặt qua hãng?`)) return;
    setBookOrdId(ord.id);
  };
  const submitFail = async () => {
    if (!failOrd) return;
    if (!failReason.trim()) { alert('Nhập lý do giao thất bại.'); return; }
    const ok = await deliveryAction(failOrd, 'manual/advance', { to: 'failed', reason: failReason.trim() });
    if (ok) { setFailOrd(null); setFailReason(''); }
  };

  // C4: đơn giao nằm ở Chờ Giao quá 10 phút (từ ready_at) mà chưa bắt đầu giao
  const isStaleUnbooked = (ord) => ord.order_type === 'delivery' && ord.status === 'ready'
    && !ord.delivery_status && !ord.delivery_order_id && ord.delivery_provider !== 'manual'
    && ord.ready_at && (Date.now() - new Date(ord.ready_at).getTime()) > 10 * 60000;
  const isOverSearch = (ord) => ord.order_type === 'delivery' && ord.delivery_status === 'searching_driver'
    && ord.delivery_searching_since
    && (Date.now() - new Date(ord.delivery_searching_since).getTime()) > deliveryTimeout * 60000;

  const doPrintTem = (ord) => {
    if (printedTem[ord.id]) { setReprintOrd(ord); return; }
    printLabels(ord, null);
    setPrintedTem((s) => ({ ...s, [ord.id]: true }));
  };
  const doPrintBill = (ord) => {
    printBill(ord);
    setPrintedBill((s) => ({ ...s, [ord.id]: true }));
  };

  const pendingOrders = orders.filter((o) => o.status === 'pending' || o.status === 'confirmed'); // SPEC-01: đơn COD (confirmed) hiện ở cột chờ
  const processingOrders = orders.filter((o) => o.status === 'processing');
  const readyOrders = orders.filter((o) => o.status === 'ready');
  const overSearchOrders = readyOrders.filter(isOverSearch); // banner cảnh báo mục 4

  const orderTypeLabel = (o) => {
    if (o.scheduled_at) return 'Hẹn lấy';
    if (o.order_type === 'delivery') return 'Giao đi';
    if (o.order_type === 'takeaway') return 'Mang đi';
    return o.order_type || '';
  };
  const getElapsedMinutes = (dateString) => {
    const diffMs = new Date() - new Date(dateString);
    return Math.max(0, Math.floor(diffMs / 60000));
  };

  const btnBase = "px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-lg tracking-wide">
            <ChefHat className="w-6 h-6" />
            <span>KDS BARISTA MONITOR</span>
          </div>
          <label className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700 flex items-center gap-1.5 cursor-pointer hover:border-emerald-500/50">
            <Store className="w-3.5 h-3.5 text-emerald-500" />
            <select
              value={selectedBranch}
              onChange={(e) => { const id = Number(e.target.value); setSelectedBranch(id); fetchKdsOrders(id); }}
              className="bg-transparent outline-none cursor-pointer text-slate-200 font-semibold [&>option]:text-slate-900"
            >
              {branches.length > 0 ? branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              )) : (
                <option value={selectedBranch}>Chi nhánh {selectedBranch}</option>
              )}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl text-xs flex items-center gap-1.5 border transition ${
              soundEnabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Chuông Bật' : 'Chuông Tắt'}</span>
          </button>
          {pollFails >= 2 ? (
            <span className="px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/50 text-red-300 text-xs font-bold">⚠ Mất kết nối — đang thử lại…</span>
          ) : (
            <span className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 text-xs">● Trực tuyến</span>
          )}
          <button onClick={() => fetchKdsOrders()} className="p-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5 text-xs">
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
          <button onClick={() => navigate('/pos')} title="Về màn hình Bán hàng (POS)"
            className="p-2 rounded-xl bg-orange-500/15 border border-orange-500/40 hover:bg-orange-500/25 text-orange-300 transition flex items-center gap-1.5 text-xs font-bold">
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">POS</span>
          </button>
          <button onClick={onBackToClient} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-emerald-900/30">
            Mở App Khách Đặt
          </button>
        </div>
      </header>

      {/* Spec KDS book ship mục 4: banner đơn tìm tài xế quá ngưỡng — đơn KHÔNG
          bị hủy/tự chuyển hãng; NV bấm chuyển tay ngay trên thẻ đơn */}
      {overSearchOrders.length > 0 && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-500/50 text-red-200 text-sm font-bold animate-pulse">
          ⏰ {overSearchOrders.length} đơn đã quá {deliveryTimeout} phút chưa có tài xế: {overSearchOrders.map((o) => `#${o.code}`).join(', ')} — bấm "Chuyển Quán Tự Đặt Giao Hàng" trên thẻ đơn để quán tự giao. Đơn không bị hủy.
        </div>
      )}

      <main className={`flex-1 p-6 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden ${pollFails >= 2 ? 'outline outline-2 outline-red-500/60 -outline-offset-2' : ''}`}>
        {/* CỘT 1: ĐƠN MỚI (spec KDS book ship mục 2: đổi tên, ánh xạ giữ nguyên) */}
        <section className="bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-amber-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <h2 className="font-extrabold text-sm text-amber-400 tracking-wider uppercase">Đơn Mới</h2>
              {/* Spec QR 2026-10-21: badge hàng đợi chờ thanh toán */}
              {pendingOrders.filter((o) => o.needs_confirm).length > 0 && (
                <span className="text-xs font-mono font-bold bg-sky-500/20 text-sky-300 px-2.5 py-0.5 rounded-full">Chờ thanh toán ({pendingOrders.filter((o) => o.needs_confirm).length})</span>
              )}
            </div>
            <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full">{pendingOrders.length}</span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3 no-scrollbar">
            {pendingOrders.length === 0 && <p className="text-xs text-slate-500 text-center py-10">Không có đơn hàng nào chờ</p>}
            {pendingOrders.map((ord) => (
              <KdsOrderRow key={ord.id} ord={ord} elapsed={getElapsedMinutes(ord.created_at)} typeLabel={orderTypeLabel(ord)}>
                {/* Spec QR 2026-10-21: cờ đối chiếu tiền cho đơn chờ thanh toán */}
                {ord.needs_confirm && (ord.customer_notified_at || ord.pay_overdue) && (
                  <div className="w-full space-y-1">
                    {ord.customer_notified_at && (
                      <div className="text-[11px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 font-semibold">💳 Khách đã báo chuyển khoản — đối chiếu sao kê rồi xác nhận</div>
                    )}
                    {ord.pay_overdue && (
                      <div className="text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-300 font-semibold">⚠️ Chờ thanh toán quá lâu — kiểm tra ngay</div>
                    )}
                  </div>
                )}
                <button onClick={() => setDetailOrd(ord)} className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}>
                  <Eye className="w-3.5 h-3.5" /> Xem đơn hàng
                </button>
                {ord.needs_confirm ? (
                  <button onClick={() => handleConfirmPayment(ord.id, ord.code)} className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                    <Check className="w-3.5 h-3.5" /> Xác nhận đơn
                  </button>
                ) : (
                  <button onClick={() => handleUpdateStatus(ord.code, 'processing')} className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}>
                    <Check className="w-3.5 h-3.5" /> Xác nhận đơn
                  </button>
                )}
                <button onClick={() => handleReject(ord)} className={`${btnBase} bg-red-900/60 hover:bg-red-800 text-red-300`}>
                  <X className="w-3.5 h-3.5" /> Từ chối
                </button>
              </KdsOrderRow>
            ))}
          </div>
        </section>

        {/* CỘT 2: ĐANG LÀM */}
        <section className="bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-blue-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
              <h2 className="font-extrabold text-sm text-blue-400 tracking-wider uppercase">Đang Làm</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-blue-500/20 text-blue-300 px-2.5 py-0.5 rounded-full">{processingOrders.length}</span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3 no-scrollbar">
            {processingOrders.length === 0 && <p className="text-xs text-slate-500 text-center py-10">Không có đơn đang làm</p>}
            {processingOrders.map((ord) => (
              <KdsOrderRow key={ord.id} ord={ord} elapsed={getElapsedMinutes(ord.created_at)} typeLabel={orderTypeLabel(ord)}>
                <button onClick={() => setDetailOrd(ord)} className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}>
                  <Eye className="w-3.5 h-3.5" /> Xem
                </button>
                <button onClick={() => doPrintTem(ord)} className={`${btnBase} bg-amber-700 hover:bg-amber-600 text-white`}>
                  <Printer className="w-3.5 h-3.5" /> {printedTem[ord.id] ? 'In lại Tem' : 'In tem'}
                </button>
                <button onClick={() => doPrintBill(ord)} className={`${btnBase} bg-amber-700 hover:bg-amber-600 text-white`}>
                  <Receipt className="w-3.5 h-3.5" /> {printedBill[ord.id] ? 'In lại Bill' : 'In Bill'}
                </button>
                <button onClick={() => handleUpdateStatus(ord.code, 'ready')} className={`${btnBase} bg-blue-600 hover:bg-blue-500 text-white`}>
                  <Check className="w-3.5 h-3.5" /> Đã làm xong
                </button>
              </KdsOrderRow>
            ))}
          </div>
        </section>

        {/* CỘT 3: CHỜ GIAO — đơn lấy tại quầy giữ nút Khách đã nhận; đơn giao
            hàng nằm yên ở cột này, trạng thái chạy trên thẻ (spec mục 2+3) */}
        <section className="bg-slate-900/90 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-emerald-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="font-extrabold text-sm text-emerald-400 tracking-wider uppercase">Chờ Giao</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full">{readyOrders.length}</span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3 no-scrollbar">
            {readyOrders.length === 0 && <p className="text-xs text-slate-500 text-center py-10">Không có đơn chờ lấy</p>}
            {readyOrders.map((ord) => (
              <KdsOrderRow key={ord.id} ord={ord} elapsed={getElapsedMinutes(ord.created_at)} typeLabel={orderTypeLabel(ord)}
                warnLine={isStaleUnbooked(ord) ? `⏰ Chưa đặt ship — đơn đã chờ giao ${Math.floor((Date.now() - new Date(ord.ready_at).getTime()) / 60000)} phút` : null}>
                <button onClick={() => setDetailOrd(ord)} className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}>
                  <Eye className="w-3.5 h-3.5" /> Xem
                </button>
                {ord.order_type === 'delivery' ? (
                  <DeliveryPanel ord={ord} btnBase={btnBase} timeoutMin={deliveryTimeout} carrierAvailable={carrierAvailable}
                    onBook={openBook} onStartManual={startManual} onToManual={toManual}
                    onAdvance={advanceManual} onFail={(o) => { setFailOrd(o); setFailReason(''); }}
                    onComplete={(o) => handleUpdateStatus(o.code, 'completed')} />
                ) : (
                  <button onClick={() => handleUpdateStatus(ord.code, 'completed')} className={`${btnBase} bg-slate-600 hover:bg-slate-500 text-white`}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Khách đã nhận
                  </button>
                )}
              </KdsOrderRow>
            ))}
          </div>
        </section>
      </main>

      {/* Lát 2g: popup đọc bản đơn MỚI NHẤT theo id từ danh sách đang poll (trước đây là bản chụp lúc bấm mở — đứng yên trong khi bảng ngoài cập nhật 3s/lần) */}
      <OrderDetailPop ord={detailOrd ? (orders.find((o) => o.id === detailOrd.id) || detailOrd) : null} onClose={() => setDetailOrd(null)} typeLabel={detailOrd ? orderTypeLabel(orders.find((o) => o.id === detailOrd.id) || detailOrd) : ''} />
      <ReprintPop ord={reprintOrd} onClose={() => setReprintOrd(null)} />

      {/* Spec KDS book ship: popup Đặt Giao Hàng (đọc bản đơn mới nhất theo id như popup chi tiết) */}
      {bookOrdId && (() => {
        const o = orders.find((x) => x.id === bookOrdId);
        return o ? <BookShipPop ord={o} onClose={() => setBookOrdId(null)} onRefresh={fetchKdsOrders} /> : null;
      })()}

      {/* Spec KDS book ship mục 8 C2: popup ghi lý do Giao thất bại (chế độ tay) */}
      {failOrd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setFailOrd(null)}>
          <div className="relative bg-slate-800 rounded-2xl w-full max-w-md border border-slate-600 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-extrabold">✖ Giao thất bại — đơn #{failOrd.code}</h3>
            <p className="text-xs text-slate-400">Đơn <b>không</b> hoàn tất — ở lại cột Chờ Giao chờ quán xử lý. Lý do hiện trên thẻ + app khách.</p>
            <textarea value={failReason} onChange={(e) => setFailReason(e.target.value)} rows={3} maxLength={255}
              placeholder="Lý do giao thất bại (bắt buộc) — VD: khách không nghe máy, địa chỉ sai…"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm outline-none" />
            <div className="flex gap-2">
              <button onClick={() => setFailOrd(null)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-bold">Hủy</button>
              <button onClick={submitFail} className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-extrabold text-white">Ghi nhận giao thất bại</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
