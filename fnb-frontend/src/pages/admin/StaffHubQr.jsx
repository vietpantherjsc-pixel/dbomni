import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { API } from '../../utils/api';

// Gói 59: QR trang hub nhân viên (/nhan-vien) — xem, copy URL, tải PNG, tạo lại mã.
export default function StaffHubQr() {
    const [qr, setQr] = useState(null); // {token, url}
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const qrCanvasRef = useRef(null);

    const fetchQr = useCallback(async () => {
        setLoading(true);
        try {
            const r = await axios.get(API + '/staff-hub-qr');
            setQr(r.data?.data || r.data || null);
        } catch (e) {
            setQr(null);
        }
        setLoading(false);
    }, []);
    useEffect(() => { fetchQr(); }, [fetchQr]);

    const copyUrl = async () => {
        if (!qr?.url) return;
        try { await navigator.clipboard.writeText(qr.url); }
        catch (e) {
            const ta = document.createElement('textarea');
            ta.value = qr.url; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const regen = async () => {
        if (!window.confirm('QR cũ sẽ hết hiệu lực ngay. Tiếp tục?')) return;
        try {
            await axios.post(API + '/staff-hub-qr/regenerate');
            fetchQr();
        } catch (e) { alert(e.response?.data?.message || 'Tạo lại mã thất bại'); }
    };

    const downloadPng = () => {
        const src = qrCanvasRef.current;
        if (!qr?.url || !src || !(src instanceof HTMLCanvasElement)) return;
        const scale = 2, W = 640, H = 760;
        const cv = document.createElement('canvas');
        cv.width = W * scale; cv.height = H * scale;
        const ctx = cv.getContext('2d');
        ctx.scale(scale, scale);
        // Nền banner brand
        ctx.fillStyle = '#24305E'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#F5A623'; ctx.fillRect(0, 0, W, 8);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Arial, "Segoe UI", sans-serif';
        ctx.fillText('TRANG NHÂN VIÊN', W / 2, 58);
        ctx.font = '20px Arial, "Segoe UI", sans-serif';
        ctx.fillStyle = '#F5A623';
        ctx.fillText('Quét để mở hub làm việc', W / 2, 96);
        // Khung QR trắng
        ctx.fillStyle = '#ffffff';
        const qs = 440, qx = (W - qs) / 2, qy = 130;
        ctx.beginPath(); ctx.roundRect(qx - 16, qy - 16, qs + 32, qs + 32, 12); ctx.fill();
        ctx.drawImage(src, qx, qy, qs, qs);
        ctx.fillStyle = '#ffffff'; ctx.font = '13px Arial, "Segoe UI", sans-serif';
        ctx.fillText('Quét bằng camera thường hoặc Zalo → nhập PIN → làm việc', W / 2, qy + qs + 46);
        ctx.fillStyle = '#9fb0d8'; ctx.font = '12px Arial, "Segoe UI", monospace';
        ctx.fillText(qr.url, W / 2, qy + qs + 70);
        const a = document.createElement('a');
        a.download = 'qr-nhan-vien.png';
        a.href = cv.toDataURL('image/png');
        a.click();
    };

    if (loading) return <div className="text-gray-400 text-sm py-6 text-center">Đang tải...</div>;
    if (!qr?.url) return <div className="text-gray-400 text-sm py-6 text-center">Chưa tạo được mã QR. Thử tải lại trang.</div>;

    return (
        <div className="flex flex-col sm:flex-row gap-6 items-center">
            {/* QR ẩn độ phân giải cao để tải PNG; QR hiện để xem trước */}
            <QRCodeCanvas value={qr.url} size={640} level="M" includeMargin={false} style={{ display: 'none' }} ref={(el) => { if (el) qrCanvasRef.current = el; }} />
            <QRCodeSVG value={qr.url} size={200} level="M" className="rounded shrink-0 border border-gray-100" />
            <div className="min-w-0 w-full">
                <div className="text-[12px] text-gray-400 break-all font-mono">{qr.url}</div>
                <div className="flex flex-wrap gap-2 mt-4">
                    <button onClick={copyUrl} className="px-4 py-2 rounded border border-gray-300 text-[13px]">{copied ? '✓ Đã sao chép' : 'Sao chép link'}</button>
                    <button onClick={downloadPng} className="px-4 py-2 rounded bg-[#F5A623] text-[#24305E] text-[13px] font-semibold">⬇ Tải QR (PNG)</button>
                    <button onClick={regen} className="px-4 py-2 rounded border border-red-300 text-red-600 text-[13px]">Tạo lại mã</button>
                </div>
                <p className="text-[12px] text-gray-400 mt-3">1 QR chung cho mọi chi nhánh. Tạo lại mã khi nghi QR bị lộ.</p>
            </div>
        </div>
    );
}
