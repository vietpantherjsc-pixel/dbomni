// Spec Phiếu đặt hàng NCC (2026-11-08) §4: xuất ẢNH phiếu đặt hàng gửi NCC.
// Hàm vẽ Canvas 2D DÙNG CHUNG Admin + Hub (§6A/T-11: ảnh hai bề mặt phải
// giống hệt nhau) — bố cục khớp demo đã duyệt
// (your_files/demo-phieu-dat-hang-ncc-20261108.html): khổ 1200px vẽ ở tỉ lệ
// ×2 (canvas 2400px) cho nét chữ khi gửi qua Zalo. Logo là file GỐC nguyên
// bản của Đại Vương (chép nguyên file, không vẽ lại — lệ 2026-11-01).
// Phiếu KHÔNG có giá (giá chỉ nhập ở bước nhập kho).
import logoUrl from '../assets/daybreak-logo-full.png';

const NAVY = '#24305E';
const ORANGE = '#F5A623';
const FONT = '"Segoe UI", Arial, sans-serif';

function fmtQty(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
}
function fmtDMY(ymd) {
    const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(ymd || '');
}
// Bo góc an toàn: trình duyệt cũ chưa có roundRect thì vẽ hình chữ nhật thường.
function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}
// Cắt chữ theo bề rộng thật của font đang đặt trên ctx → mảng dòng.
function wrap(ctx, text, maxW) {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
        const t = cur + ' ' + words[i];
        if (ctx.measureText(t).width <= maxW) cur = t;
        else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines;
}

export async function exportPurchaseOrderImage(po) {
    const S = 2; // tỉ lệ vẽ ×2
    const W = 1200, PADX = 52, PADT = 48, PADB = 40;
    const CW = W - PADX * 2; // 1096 — bề rộng nội dung

    // Nạp logo gốc (lỗi nạp thì bỏ qua hình, vẫn xuất phiếu chữ)
    let logo = null;
    try {
        logo = new Image();
        logo.src = logoUrl;
        await logo.decode();
        if (!logo.naturalWidth) logo = null;
    } catch { logo = null; }

    // ---- Lượt đo (scratch ctx) để tính chiều cao trước khi vẽ thật ----
    const meas = document.createElement('canvas').getContext('2d');
    const setF = (ctx, spec) => { ctx.font = spec; };

    // Thẻ thông tin (NCC / chi nhánh)
    const cardW = (CW - 32) / 2; // 532
    const cardInnerW = cardW - 36; // padding 18 × 2
    const measureCard = (name, lines) => {
        setF(meas, `700 18px ${FONT}`);
        const nameLines = wrap(meas, name || '', cardInnerW);
        setF(meas, `15px ${FONT}`);
        let h = 16 + 18 + 8 + nameLines.length * 24.3; // pad-top + cap + gap + tên
        const wrapped = lines.map((ln) => wrap(meas, ln, cardInnerW));
        for (const wl of wrapped) h += 4 + wl.length * 21.75;
        return { h: h + 16, nameLines, wrapped };
    };
    const supLines = [];
    if (po.partner?.phone) supLines.push('SĐT: ' + po.partner.phone);
    if (po.partner?.address) supLines.push('Địa chỉ: ' + po.partner.address);
    const brLines = [];
    if (po.branch?.address) brLines.push('Địa chỉ: ' + po.branch.address);
    if (po.branch?.phone) brLines.push('SĐT chi nhánh: ' + po.branch.phone);
    const supCard = measureCard(po.partner?.name || '', supLines);
    const brCard = measureCard(po.branch?.name || '', brLines);
    const cardsH = Math.max(supCard.h, brCard.h);

    // Bảng mặt hàng: STT 56 · Mặt hàng 500 · Đơn vị 110 · SL 130 · Ghi chú 300
    const colX = [PADX, PADX + 56, PADX + 556, PADX + 666, PADX + 796];
    const rows = (po.items || []).map((it) => {
        setF(meas, `16px ${FONT}`);
        const nameLines = wrap(meas, it.material_name || '', 472);
        setF(meas, `15px ${FONT}`);
        const noteLines = it.note ? wrap(meas, it.note, 272) : [];
        const h = 24 + Math.max(nameLines.length, noteLines.length, 1) * 22.4;
        return { it, nameLines, noteLines, h };
    });
    const tableH = 44 + rows.reduce((s, r) => s + r.h, 0);

    // Khối ghi chú chung
    let noteH = 0, noteLines = [];
    if (po.note) {
        setF(meas, `15px ${FONT}`);
        noteLines = wrap(meas, 'Ghi chú: ' + po.note, CW - 36);
        noteH = 18 + 24 + noteLines.length * 22.5;
    }
    const totalH = PADT + 82 + 22 + 4 + 26 + cardsH + 26 + tableH + 14 + 22 + noteH + 34 + 89 + PADB;

    // ---- Lượt vẽ thật ----
    const cv = document.createElement('canvas');
    cv.width = W * S;
    cv.height = Math.ceil(totalH) * S;
    const ctx = cv.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, totalH);
    ctx.textBaseline = 'alphabetic';

    // Đầu phiếu: logo trái · tiêu đề phải
    if (logo) {
        const lh = 64, lw = (lh * logo.naturalWidth) / logo.naturalHeight;
        ctx.drawImage(logo, PADX, PADT, lw, lh);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = NAVY;
    setF(ctx, `800 30px ${FONT}`);
    ctx.fillText('PHIẾU ĐẶT HÀNG', PADX + CW, PADT + 32);
    setF(ctx, `19px ${FONT}`);
    ctx.fillStyle = '#1f2430';
    const codeLabel = 'Mã phiếu: ';
    const codeVal = po.code || '';
    const wVal = (() => { setF(ctx, `700 19px ${FONT}`); return ctx.measureText(codeVal).width; })();
    setF(ctx, `19px ${FONT}`);
    const wLab = ctx.measureText(codeLabel).width;
    ctx.fillText(codeLabel, PADX + CW - wVal, PADT + 62);
    setF(ctx, `700 19px ${FONT}`);
    ctx.fillStyle = NAVY;
    ctx.fillText(codeVal, PADX + CW, PADT + 62);
    setF(ctx, `16px ${FONT}`);
    ctx.fillStyle = '#4b5563';
    ctx.fillText('Ngày đặt: ' + fmtDMY(po.order_date), PADX + CW, PADT + 84);
    ctx.textAlign = 'left';

    // Đường kẻ cam
    let y = PADT + 82 + 22;
    ctx.fillStyle = ORANGE;
    rr(ctx, PADX, y, CW, 4, 2);
    ctx.fill();
    y += 4 + 26;

    // Hai thẻ thông tin
    const drawCard = (x, cap, card) => {
        ctx.fillStyle = '#f6f7fb';
        ctx.strokeStyle = '#e3e6ef';
        ctx.lineWidth = 1;
        rr(ctx, x, y, cardW, cardsH, 12);
        ctx.fill();
        ctx.stroke();
        let cy = y + 16;
        setF(ctx, `700 13px ${FONT}`);
        ctx.fillStyle = ORANGE;
        ctx.fillText(cap, x + 18, cy + 13);
        cy += 18 + 8;
        setF(ctx, `700 18px ${FONT}`);
        ctx.fillStyle = NAVY;
        for (const ln of card.nameLines) { cy += 24.3; ctx.fillText(ln, x + 18, cy - 6); }
        setF(ctx, `15px ${FONT}`);
        ctx.fillStyle = '#374151';
        for (const wl of card.wrapped) {
            cy += 4;
            for (const ln of wl) { cy += 21.75; ctx.fillText(ln, x + 18, cy - 5); }
        }
    };
    drawCard(PADX, 'NHÀ CUNG CẤP', supCard);
    drawCard(PADX + cardW + 32, 'CHI NHÁNH ĐẶT HÀNG', brCard);
    y += cardsH + 26;

    // Bảng mặt hàng — hàng tiêu đề navy
    ctx.fillStyle = NAVY;
    ctx.fillRect(PADX, y, CW, 44);
    setF(ctx, `600 15px ${FONT}`);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText('STT', colX[0] + 28, y + 28);
    ctx.textAlign = 'left';
    ctx.fillText('Mặt hàng', colX[1] + 14, y + 28);
    ctx.textAlign = 'center';
    ctx.fillText('Đơn vị', colX[2] + 55, y + 28);
    ctx.textAlign = 'right';
    ctx.fillText('Số lượng', colX[4] - 14, y + 28);
    ctx.textAlign = 'left';
    ctx.fillText('Ghi chú', colX[4] + 14, y + 28);
    y += 44;
    rows.forEach((r, idx) => {
        if (idx % 2 === 1) {
            ctx.fillStyle = '#fafbfd';
            ctx.fillRect(PADX, y, CW, r.h);
        }
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADX, y + r.h);
        ctx.lineTo(PADX + CW, y + r.h);
        ctx.stroke();
        ctx.textAlign = 'center';
        setF(ctx, `16px ${FONT}`);
        ctx.fillStyle = '#1f2430';
        ctx.fillText(String(idx + 1), colX[0] + 28, y + 12 + 17);
        ctx.textAlign = 'left';
        r.nameLines.forEach((ln, li) => ctx.fillText(ln, colX[1] + 14, y + 12 + 17 + li * 22.4));
        ctx.textAlign = 'center';
        ctx.fillText(r.it.unit_name || '', colX[2] + 55, y + 12 + 17);
        ctx.textAlign = 'right';
        setF(ctx, `700 16px ${FONT}`);
        ctx.fillStyle = NAVY;
        ctx.fillText(fmtQty(r.it.quantity), colX[4] - 14, y + 12 + 17);
        ctx.textAlign = 'left';
        setF(ctx, `15px ${FONT}`);
        ctx.fillStyle = '#4b5563';
        r.noteLines.forEach((ln, li) => ctx.fillText(ln, colX[4] + 14, y + 12 + 16 + li * 22.4));
        setF(ctx, `16px ${FONT}`);
        ctx.fillStyle = '#1f2430';
        y += r.h;
    });

    // Tổng cộng
    y += 14;
    setF(ctx, `15px ${FONT}`);
    ctx.fillStyle = '#374151';
    const totLab = 'Tổng cộng: ';
    ctx.fillText(totLab, PADX, y + 16);
    const wTot = ctx.measureText(totLab).width;
    setF(ctx, `700 15px ${FONT}`);
    ctx.fillStyle = NAVY;
    ctx.fillText(`${(po.items || []).length} mặt hàng`, PADX + wTot, y + 16);
    y += 22;

    // Ghi chú chung
    if (po.note) {
        y += 18;
        ctx.fillStyle = '#fff7e8';
        ctx.fillRect(PADX, y, CW, noteH - 18);
        ctx.fillStyle = ORANGE;
        ctx.fillRect(PADX, y, 4, noteH - 18);
        setF(ctx, `15px ${FONT}`);
        ctx.fillStyle = '#1f2430';
        noteLines.forEach((ln, li) => ctx.fillText(ln, PADX + 20, y + 12 + 16 + li * 22.5));
        y += noteH - 18;
    }

    // Chân phiếu: dòng xác nhận trái · người đặt phải
    y += 34;
    setF(ctx, `14px ${FONT}`);
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Phiếu đặt hàng được tạo từ hệ thống quản lý Daybreak.', PADX, y + 14);
    ctx.fillText('Vui lòng xác nhận lại đơn đặt hàng với chi nhánh. Xin cảm ơn!', PADX, y + 14 + 21.7);
    const signX = PADX + CW - 240;
    ctx.textAlign = 'center';
    setF(ctx, `14px ${FONT}`);
    ctx.fillStyle = '#4b5563';
    ctx.fillText('Người đặt hàng', signX + 120, y + 14);
    setF(ctx, `700 17px ${FONT}`);
    ctx.fillStyle = NAVY;
    ctx.fillText(po.creator_name || '', signX + 120, y + 14 + 34 + 20);
    if (po.creator_role) {
        setF(ctx, `13px ${FONT}`);
        ctx.fillStyle = '#6b7280';
        ctx.fillText(po.creator_role, signX + 120, y + 14 + 34 + 20 + 19);
    }
    ctx.textAlign = 'left';

    // Tải xuống PNG
    const filename = `phieu-dat-hang-${po.code || 'DDH'}.png`;
    if (cv.toBlob) {
        cv.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        }, 'image/png');
    } else {
        const a = document.createElement('a');
        a.href = cv.toDataURL('image/png');
        a.download = filename;
        a.click();
    }
}
