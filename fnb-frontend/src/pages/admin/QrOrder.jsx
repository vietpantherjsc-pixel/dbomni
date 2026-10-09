import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import AdminLayout from '../../components/layout/AdminLayout';

// Gói 28 (2026-10-09): QR Order theo chi nhánh + banner tải về.
// Demo: QR encode link local {baseUrl}/?branch={id}; baseUrl cấu hình được, lưu localStorage.

const BASEURL_KEY = 'dbomni_qrorder_baseurl';
const DEFAULT_BASE = 'http://localhost:3001';
const NAVY = '#24305E';
const ORANGE = '#F5A623';

const getBase = () => (localStorage.getItem(BASEURL_KEY) || DEFAULT_BASE).replace(/\/+$/, '');
const orderLink = (base, branchId) => `${(base || DEFAULT_BASE).replace(/\/+$/, '')}/?branch=${branchId}`;

// Bỏ dấu tiếng Việt để đặt tên file
const slugify = (s) => {
    const out = (s || 'chi-nhanh')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return out || 'chi-nhanh';
};

const copyText = async (text, done) => {
    try {
        await navigator.clipboard.writeText(text);
        done(true);
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(true); } catch (err) { done(false); }
        document.body.removeChild(ta);
    }
};

/* ---------- Vẽ banner 1080x1350 trên canvas (không cần thư viện ngoài) ---------- */
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; }
        else line = t;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
}

const FONT = '"Segoe UI", Arial, "Helvetica Neue", sans-serif'; // hỗ trợ đầy đủ tiếng Việt trên Windows

function drawBanner(canvas, { branchName, address, link, qrCanvas }) {
    const W = 1080, H = 1350;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Nền navy
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, W, H);

    // Trang trí: tròn cam góc trên-phải + chấm tròn góc dưới-trái
    ctx.fillStyle = ORANGE;
    ctx.beginPath(); ctx.arc(W - 40, -60, 280, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.arc(120, H - 140, 180, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.10;
    ctx.beginPath(); ctx.arc(W - 180, 420, 90, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Thương hiệu
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 38px ${FONT}`;
    ctx.fillText('D B O M N I', W / 2, 110);

    // Tiêu đề
    ctx.font = `800 70px ${FONT}`;
    const hl = wrapText(ctx, 'QUÉT MÃ ĐỂ ĐẶT MÓN', W - 160);
    hl.forEach((l, i) => ctx.fillText(l, W / 2, 225 + i * 82));
    let y = 225 + hl.length * 82 + 26;

    // Tên chi nhánh (cam)
    ctx.fillStyle = ORANGE;
    ctx.font = `700 56px ${FONT}`;
    const bn = wrapText(ctx, String(branchName || '').toUpperCase(), W - 140);
    bn.forEach((l, i) => ctx.fillText(l, W / 2, y + i * 68));
    y += bn.length * 68 + 12;

    // Địa chỉ (trắng mờ)
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `400 33px ${FONT}`;
    const ad = wrapText(ctx, address || '', W - 200);
    ad.slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, y + i * 43));
    y += Math.min(ad.length, 2) * 43 + 44;

    // Thẻ trắng chứa QR (kích thước co giãn theo chỗ còn lại)
    const maxCardBottom = 1140;
    let cardSize = Math.max(480, Math.min(640, maxCardBottom - y));
    const cx = (W - cardSize) / 2;
    const cy = y;
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, cx, cy, cardSize, cardSize, 36);
    ctx.fill();
    const pad = Math.round(cardSize * 0.09);
    if (qrCanvas) {
        ctx.drawImage(qrCanvas, cx + pad, cy + pad, cardSize - pad * 2, cardSize - pad * 2);
    }
    y = cy + cardSize + 52;

    // Link (cắt ngắn nếu quá dài)
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `400 29px ${FONT}`;
    let linkText = link;
    while (ctx.measureText(linkText).width > W - 160 && linkText.length > 24) {
        linkText = linkText.slice(0, -2);
    }
    if (linkText !== link) linkText = linkText.slice(0, -1) + '…';
    ctx.fillText(linkText, W / 2, y);

    // Chân banner
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText('Mở camera / Zalo để quét mã', W / 2, H - 64);
    ctx.fillStyle = ORANGE;
    ctx.fillRect(0, H - 16, W, 16);
}

const QrOrder = () => {
    const [searchParams] = useSearchParams();
    const [tab, setTab] = useState(searchParams.get('tab') === 'tao' ? 'tao' : 'list');
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [baseUrl, setBaseUrl] = useState(getBase());
    const [baseInput, setBaseInput] = useState(getBase());
    const [savedMsg, setSavedMsg] = useState('');
    const [copiedId, setCopiedId] = useState(null);
    const [createBranchId, setCreateBranchId] = useState('');
    const qrRefMap = useRef(new Map());

    useEffect(() => {
        setTab(searchParams.get('tab') === 'tao' ? 'tao' : 'list');
    }, [searchParams]);

    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const res = await axios.get('http://localhost/api/branches');
                const list = res.data?.data || [];
                setBranches(list);
                if (list.length && !createBranchId) setCreateBranchId(String(list[0].id));
            } catch (e) { /* bỏ qua */ }
            setLoading(false);
        };
        fetchBranches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveBase = () => {
        const v = (baseInput || '').trim().replace(/\/+$/, '') || DEFAULT_BASE;
        localStorage.setItem(BASEURL_KEY, v);
        setBaseUrl(v);
        setBaseInput(v);
        setSavedMsg('Đã lưu Base URL.');
        setTimeout(() => setSavedMsg(''), 2500);
    };

    const handleCopy = (branch) => {
        copyText(orderLink(baseUrl, branch.id), (ok) => {
            if (ok) {
                setCopiedId(branch.id);
                setTimeout(() => setCopiedId(null), 1800);
            }
        });
    };

    const downloadBanner = (branch) => {
        const qrCanvas = qrRefMap.current.get(branch.id);
        if (!qrCanvas) return;
        const c = document.createElement('canvas');
        drawBanner(c, {
            branchName: branch.name,
            address: branch.address || '',
            link: orderLink(baseUrl, branch.id),
            qrCanvas,
        });
        const a = document.createElement('a');
        a.download = `${slugify(branch.code || branch.name)}-qr-banner.png`;
        a.href = c.toDataURL('image/png');
        a.click();
    };

    const downloadQrOnly = (branch) => {
        const qrCanvas = qrRefMap.current.get(branch.id);
        if (!qrCanvas) return;
        const S = 1024;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, S, S);
        ctx.drawImage(qrCanvas, 0, 0, S, S);
        const a = document.createElement('a');
        a.download = `${slugify(branch.code || branch.name)}-qr.png`;
        a.href = c.toDataURL('image/png');
        a.click();
    };

    const createBranch = branches.find((b) => String(b.id) === String(createBranchId)) || branches[0];

    return (
        <AdminLayout>
            <div className="p-4 sm:p-5">
                <h1 className="text-xl font-semibold mb-1">QR Order</h1>
                <p className="text-[13px] text-gray-500 mb-4">
                    Mỗi chi nhánh có 1 mã QR dẫn tới link đặt món Zalo Mini App. In banner dán tại quầy để khách quét gọi món.
                </p>

                {/* Cấu hình Base URL */}
                <div className="bg-white border border-gray-100 rounded-lg p-4 mb-4">
                    <div className="font-medium text-[14px] mb-1">Base URL của Mini App</div>
                    <p className="text-[12.5px] text-gray-500 mb-3">
                        Demo: dùng link local <code className="bg-gray-100 px-1 rounded">http://localhost:3001</code>.
                        Khi có APP_ID Zalo thật, đổi thành link mini app chính thức (VD: <code className="bg-gray-100 px-1 rounded">https://mini.zalo.me/apps/APP_ID</code>).
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            value={baseInput}
                            onChange={(e) => setBaseInput(e.target.value)}
                            placeholder="https://..."
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-[14px]"
                        />
                        <button
                            onClick={saveBase}
                            className="bg-[#24305E] text-white rounded-lg px-5 py-2.5 text-[14px] font-medium whitespace-nowrap"
                        >
                            Lưu
                        </button>
                    </div>
                    {savedMsg && <div className="text-green-600 text-[13px] mt-2">{savedMsg}</div>}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200 mb-4">
                    {[
                        { key: 'list', label: 'Danh sách QR' },
                        { key: 'tao', label: 'Tạo QR' },
                    ].map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-4 py-2.5 text-[13.5px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                                tab === t.key
                                    ? 'border-[#0d6efd] text-[#0d6efd] font-medium'
                                    : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="text-gray-500 text-[13px] py-10 text-center">Đang tải danh sách chi nhánh...</div>
                ) : tab === 'list' ? (
                    /* ---------- TAB: DANH SÁCH QR ---------- */
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        {branches.map((b) => {
                            const link = orderLink(baseUrl, b.id);
                            return (
                                <div key={b.id} className="bg-white border border-gray-100 rounded-lg p-4 flex flex-col items-center">
                                    {/* QR ẩn độ phân giải cao để vẽ banner; QR hiện để xem trước */}
                                    <QRCodeCanvas
                                        value={link}
                                        size={640}
                                        level="M"
                                        includeMargin={false}
                                        style={{ display: 'none' }}
                                        ref={(el) => {
                                            if (el) qrRefMap.current.set(b.id, el);
                                            else qrRefMap.current.delete(b.id);
                                        }}
                                    />
                                    <QRCodeSVG value={link} size={168} level="M" className="rounded" />
                                    <div className="font-semibold text-[15px] mt-3 text-center">{b.name}</div>
                                    {b.address && <div className="text-[12.5px] text-gray-500 text-center mt-0.5">{b.address}</div>}
                                    {!b.is_active && (
                                        <span className="text-[11px] mt-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Đang tạm đóng</span>
                                    )}
                                    <div className="text-[12px] text-[#0d6efd] break-all text-center mt-2">{link}</div>
                                    <div className="flex flex-wrap justify-center gap-2 mt-3 w-full">
                                        <button
                                            onClick={() => handleCopy(b)}
                                            className="flex-1 min-w-[110px] border border-gray-300 rounded-lg px-3 py-2 text-[13px] hover:bg-gray-50"
                                        >
                                            {copiedId === b.id ? '✓ Đã sao chép' : 'Sao chép link'}
                                        </button>
                                        <button
                                            onClick={() => downloadQrOnly(b)}
                                            className="flex-1 min-w-[110px] border border-gray-300 rounded-lg px-3 py-2 text-[13px] hover:bg-gray-50"
                                        >
                                            Tải QR
                                        </button>
                                        <button
                                            onClick={() => downloadBanner(b)}
                                            className="flex-1 min-w-[110px] bg-[#F5A623] text-[#24305E] font-semibold rounded-lg px-3 py-2 text-[13px] hover:brightness-95"
                                        >
                                            Tải banner
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {branches.length === 0 && (
                            <div className="text-gray-500 text-[13px] col-span-full py-8 text-center">
                                Chưa có chi nhánh. Thêm chi nhánh trong <b>Thiết lập → Chi nhánh</b>.
                            </div>
                        )}
                    </div>
                ) : (
                    /* ---------- TAB: TẠO QR ---------- */
                    <div className="bg-white border border-gray-100 rounded-lg p-4 sm:p-6 max-w-2xl">
                        <div className="font-medium text-[14px] mb-3">Tạo QR cho chi nhánh</div>
                        <label className="text-[13px] text-gray-600 block mb-1">Chi nhánh</label>
                        <select
                            value={createBranchId}
                            onChange={(e) => setCreateBranchId(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[14px] mb-4"
                        >
                            {branches.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                        {createBranch && (
                            <>
                                <QRCodeCanvas
                                    value={orderLink(baseUrl, createBranch.id)}
                                    size={640}
                                    level="M"
                                    includeMargin={false}
                                    style={{ display: 'none' }}
                                    ref={(el) => {
                                        if (el) qrRefMap.current.set(createBranch.id, el);
                                    }}
                                />
                                <div className="flex flex-col sm:flex-row gap-4 items-center border border-gray-100 rounded-lg p-4 mb-4">
                                    <QRCodeSVG value={orderLink(baseUrl, createBranch.id)} size={180} level="M" className="rounded shrink-0" />
                                    <div className="min-w-0">
                                        <div className="font-semibold text-[15px]">{createBranch.name}</div>
                                        {createBranch.address && <div className="text-[12.5px] text-gray-500">{createBranch.address}</div>}
                                        <div className="text-[12.5px] text-[#0d6efd] break-all mt-1">
                                            {orderLink(baseUrl, createBranch.id)}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => handleCopy(createBranch)}
                                        className="border border-gray-300 rounded-lg px-4 py-2.5 text-[13.5px] hover:bg-gray-50"
                                    >
                                        {copiedId === createBranch.id ? '✓ Đã sao chép' : 'Sao chép link'}
                                    </button>
                                    <button
                                        onClick={() => downloadQrOnly(createBranch)}
                                        className="border border-gray-300 rounded-lg px-4 py-2.5 text-[13.5px] hover:bg-gray-50"
                                    >
                                        Tải QR PNG
                                    </button>
                                    <button
                                        onClick={() => downloadBanner(createBranch)}
                                        className="bg-[#F5A623] text-[#24305E] font-semibold rounded-lg px-4 py-2.5 text-[13.5px] hover:brightness-95"
                                    >
                                        Tải banner 1080×1350
                                    </button>
                                </div>
                                <p className="text-[12px] text-gray-400 mt-3">
                                    Banner: nền navy #24305E + cam #F5A623 theo brand, tên + địa chỉ chi nhánh, QR ở giữa, file PNG{' '}
                                    <code className="bg-gray-100 px-1 rounded">{slugify(createBranch.code || createBranch.name)}-qr-banner.png</code>
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </AdminLayout>
    );
};

export default QrOrder;
