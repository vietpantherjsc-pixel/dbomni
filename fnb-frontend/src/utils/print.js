// Gói 3 (2026-10-04): In bill K80 (80mm) và tem dán ly 50x30mm qua trình duyệt.
// Cách dùng: Đại Vương cài driver máy in vào máy (USB cắm là nhận, LAN thì Add printer qua IP),
// khi bấm in -> hộp thoại Chrome hiện ra -> chọn đúng máy in K80 / máy in tem.

import { fmtDateTime, fmtTime } from './format.js';

// Gói 36: "Giờ" trên bill — order.date từ POS ("HH:MM") hoặc created_at ISO → chuẩn hiển thị
const fmtOrderTime = (v) => {
  const s = String(v || '').trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return fmtTime(s);
  return fmtDateTime(s);
};

// Mở cửa sổ in mới, ghi HTML rồi gọi print()
function openPrintWindow(html, title) {
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) {
    alert('Trình duyệt chặn popup. Hãy cho phép popup cho trang này rồi bấm in lại.');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.document.title = title;
  w.onload = () => {
    w.focus();
    w.print();
  };
  // Fallback nếu onload không kích hoạt
  setTimeout(() => { try { w.print(); } catch (e) {} }, 800);
}

const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');

// order: { code, created_at/date, customer_name, order_type, items: [{quantity, name|product_name, optionsText|note, price|unit_price}], subtotal, discount, total, payment_method, cashier }
export function printBill(order) {
  const items = order.items || [];
  const typeLabel = { takeaway: 'MANG ĐI', delivery: 'GIAO HÀNG', dine_in: 'TẠI BÀN' }[order.order_type] || '';
  const itemRows = items.map((it) => {
    const name = it.product_name || it.name;
    const qty = it.quantity;
    const price = it.unit_price ?? it.price ?? 0;
    const disc = it.itemDiscount ?? it.discount_amount ?? it.discount ?? 0;
    const net = price * qty - disc;
    const opt = it.optionsText || it.note;
    return `
      <div class="item">
        <div class="row"><span>${qty}x ${escapeHtml(name)}</span><span>${fmt(net)}</span></div>
        ${opt ? `<div class="opt">↳ ${escapeHtml(opt)}</div>` : ''}
        ${disc > 0 ? `<div class="opt">Giảm giá món: -${fmt(disc)}</div>` : ''}
      </div>`;
  }).join('');

  const html = `
  <html><head><meta charset="utf-8">
  <style>
    @page { size: 80mm auto; margin: 0; }
    body { width: 72mm; margin: 0 auto; padding: 4mm 2mm; font-family: 'Courier New', monospace; font-size: 11px; color: #000; }
    .center { text-align: center; }
    .title { font-size: 15px; font-weight: bold; }
    .dashed { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; }
    .item { margin: 3px 0; }
    .opt { font-size: 9px; color: #333; padding-left: 8px; }
    .total { font-size: 14px; font-weight: bold; }
  </style></head>
  <body>
    <div class="center title">CAFE & TEA OMNI</div>
    <div class="center">HÓA ĐƠN BÁN HÀNG ${typeLabel ? '(' + typeLabel + ')' : ''}</div>
    <div class="dashed"></div>
    <div class="row"><span>Mã đơn:</span><span><b>${escapeHtml(order.code || '')}</b></span></div>
    <div class="row"><span>Giờ:</span><span>${escapeHtml(fmtOrderTime(order.date || order.created_at))}</span></div>
    <div class="row"><span>Khách:</span><span>${escapeHtml(order.customer_name || 'Khách lẻ')}</span></div>
    ${order.table_name ? `<div class="row"><span>Bàn:</span><span>${escapeHtml(order.table_name)}</span></div>` : ''}
    <div class="dashed"></div>
    ${itemRows}
    <div class="dashed"></div>
    <div class="row"><span>Tạm tính:</span><span>${fmt(order.subtotal)}</span></div>
    ${Number(order.discount) > 0 ? `<div class="row"><span>Chiết khấu:</span><span>-${fmt(order.discount)}</span></div>` : ''}
    <div class="row total"><span>TỔNG CỘNG:</span><span>${fmt(order.total)} đ</span></div>
    <div class="row"><span>Thanh toán:</span><span>${order.payment_method === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt'}</span></div>
    <div class="dashed"></div>
    <div class="center">Cảm ơn quý khách!<br/>Hẹn gặp lại</div>
  </body></html>`;

  openPrintWindow(html, 'Bill ' + (order.code || ''));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// In tem dán ly 50x30mm: 1 tem / 1 ly (theo số lượng từng món).
// Nội dung: mã đơn + tên món + nhóm tùy chọn + ghi chú.
export function printLabels(order) {
  const items = order.items || [];
  const labels = [];
  items.forEach((it) => {
    const name = it.product_name || it.name;
    const opt = it.optionsText || it.note || '';
    const qty = it.quantity || 1;
    for (let i = 0; i < qty; i++) {
      labels.push(`
        <div class="label">
          <div class="code">${escapeHtml(order.code || '')}</div>
          <div class="name">${escapeHtml(name)}</div>
          ${opt ? `<div class="opt">${escapeHtml(opt)}</div>` : ''}
        </div>`);
    }
  });

  if (labels.length === 0) {
    alert('Đơn hàng không có món để in tem.');
    return;
  }

  const html = `
  <html><head><meta charset="utf-8">
  <style>
    @page { size: 50mm 30mm; margin: 0; }
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    .label {
      width: 50mm; height: 30mm; padding: 2mm 3mm; box-sizing: border-box;
      page-break-after: always; overflow: hidden;
      display: flex; flex-direction: column; justify-content: center;
    }
    .label:last-child { page-break-after: auto; }
    .code { font-size: 9px; font-weight: bold; }
    .name { font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .opt { font-size: 8px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head>
  <body>${labels.join('')}</body></html>`;

  openPrintWindow(html, 'Tem ' + (order.code || ''));
}
