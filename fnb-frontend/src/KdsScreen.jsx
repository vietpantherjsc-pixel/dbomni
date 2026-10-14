import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { fmtDateTime } from './utils/format';
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
      items.push({ seq, total, name: base, opts });
    }
  }
  if (!items.length) { alert('Không có món nào cần in tem.'); return; }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tem ${order.code}</title>
<style>@media print{@page{size:50mm 30mm;margin:0}}body{margin:0;font-family:sans-serif}
.label{width:50mm;height:30mm;padding:2mm;box-sizing:border-box;page-break-after:always;overflow:hidden}
.code{font-family:monospace;font-size:9pt;font-weight:bold}
.name{font-size:11pt;font-weight:bold;margin:1mm 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.opts{font-size:8pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style></head><body>` +
    items.map((l) => `<div class="label"><div class="code">${order.code} - ${l.seq}/${l.total}</div><div class="name">${l.name}</div><div class="opts">${l.opts}</div></div>`).join('') +
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
    return `<tr><td>${qty}x ${base}${opts ? `<br><small>${opts}</small>` : ''}</td><td align="right">${amt.toLocaleString('vi-VN')}</td></tr>`;
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
function KdsOrderRow({ ord, elapsed, typeLabel, children }) {
  return (
    <div className="bg-slate-800/90 rounded-2xl p-4 border border-slate-700 space-y-2.5">
      <div className="flex justify-between items-center">
        <span className="font-mono font-extrabold text-emerald-400 text-sm">#{ord.code}</span>
        <span className={`flex items-center gap-1 text-xs font-bold ${elapsed > 10 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>
          <Clock className="w-3.5 h-3.5" /> {elapsed} phút
        </span>
      </div>
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
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto border border-slate-600" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-extrabold mb-3">🧾 Chi tiết đơn #{ord.code}</h3>
        <div className="space-y-2 text-sm">
          {(ord.items || []).map((it) => {
            const { base, opts } = itemName(it);
            return (
              <div key={it.id} className="flex justify-between border-b border-slate-700/60 pb-2">
                <div>
                  <span className="font-bold">{it.quantity}x {base}</span>
                  {opts && <div className="text-xs text-slate-400">{opts}</div>}
                </div>
                <span className="font-mono">{Number(it.line_total || 0).toLocaleString('vi-VN')}đ</span>
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
          {ord.delivery_address && <p>📍 {ord.delivery_address}</p>}
          {ord.note && <p className="italic">📝 "{ord.note}"</p>}
          {typeLabel && <p>Loại: {typeLabel}</p>}
        </div>
        <button onClick={onClose} className="w-full mt-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-bold">Đóng</button>
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
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto border border-slate-600" onClick={(e) => e.stopPropagation()}>
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
  );
}

export default function KdsScreen({ onBackToClient }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState(1);
  const [branches, setBranches] = useState([]);
  const [detailOrd, setDetailOrd] = useState(null);
  const [reprintOrd, setReprintOrd] = useState(null);
  const [printedTem, setPrintedTem] = useState({}); // orderId -> true
  const [printedBill, setPrintedBill] = useState({});
  const previousOrderCount = useRef(0);

  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

  const fetchKdsOrders = async () => {
    try {
      const res = await axios.get(`${API_BASE}/kds/orders?branch_id=${selectedBranch}`);
      if (res.data.success) {
        const newOrders = res.data.data;
        if (newOrders.length > previousOrderCount.current && previousOrderCount.current !== 0) {
          playNotificationSound();
        }
        previousOrderCount.current = newOrders.length;
        setOrders(newOrders);
      }
    } catch (error) { /* bỏ qua */ }
  };

  useEffect(() => {
    fetchKdsOrders();
    const timer = setInterval(fetchKdsOrders, 3000);
    return () => clearInterval(timer);
  }, [selectedBranch]);

  useEffect(() => {
    axios.get(`${API_BASE}/branches`)
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        setBranches(list);
      })
      .catch(() => {});
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

  const doPrintTem = (ord) => {
    if (printedTem[ord.id]) { setReprintOrd(ord); return; }
    printLabels(ord, null);
    setPrintedTem((s) => ({ ...s, [ord.id]: true }));
  };
  const doPrintBill = (ord) => {
    printBill(ord);
    setPrintedBill((s) => ({ ...s, [ord.id]: true }));
  };

  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const processingOrders = orders.filter((o) => o.status === 'processing');
  const readyOrders = orders.filter((o) => o.status === 'ready');

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
              onChange={(e) => setSelectedBranch(Number(e.target.value))}
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
          <button onClick={fetchKdsOrders} className="p-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5 text-xs">
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

      <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-3 gap-6 overflow-hidden">
        {/* CỘT 1: NHẬN ĐƠN */}
        <section className="bg-slate-900/90 rounded-3xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-amber-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <h2 className="font-extrabold text-sm text-amber-400 tracking-wider uppercase">Nhận Đơn</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full">{pendingOrders.length}</span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3 no-scrollbar">
            {pendingOrders.length === 0 && <p className="text-xs text-slate-500 text-center py-10">Không có đơn hàng nào chờ</p>}
            {pendingOrders.map((ord) => (
              <KdsOrderRow key={ord.id} ord={ord} elapsed={getElapsedMinutes(ord.created_at)} typeLabel={orderTypeLabel(ord)}>
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

        {/* CỘT 2: ĐANG PHA CHẾ */}
        <section className="bg-slate-900/90 rounded-3xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-blue-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
              <h2 className="font-extrabold text-sm text-blue-400 tracking-wider uppercase">Đang Pha Chế</h2>
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

        {/* CỘT 3: CHỜ KHÁCH NHẬN */}
        <section className="bg-slate-900/90 rounded-3xl border border-slate-800 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-emerald-500/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 className="font-extrabold text-sm text-emerald-400 tracking-wider uppercase">Chờ Khách Nhận</h2>
            </div>
            <span className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full">{readyOrders.length}</span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3 no-scrollbar">
            {readyOrders.length === 0 && <p className="text-xs text-slate-500 text-center py-10">Không có đơn chờ lấy</p>}
            {readyOrders.map((ord) => (
              <KdsOrderRow key={ord.id} ord={ord} elapsed={getElapsedMinutes(ord.created_at)} typeLabel={orderTypeLabel(ord)}>
                <button onClick={() => setDetailOrd(ord)} className={`${btnBase} bg-slate-700 hover:bg-slate-600 text-white`}>
                  <Eye className="w-3.5 h-3.5" /> Xem
                </button>
                <button onClick={() => handleUpdateStatus(ord.code, 'completed')} className={`${btnBase} bg-slate-600 hover:bg-slate-500 text-white`}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Khách đã nhận
                </button>
              </KdsOrderRow>
            ))}
          </div>
        </section>
      </main>

      <OrderDetailPop ord={detailOrd} onClose={() => setDetailOrd(null)} typeLabel={detailOrd ? orderTypeLabel(detailOrd) : ''} />
      <ReprintPop ord={reprintOrd} onClose={() => setReprintOrd(null)} />
    </div>
  );
}
