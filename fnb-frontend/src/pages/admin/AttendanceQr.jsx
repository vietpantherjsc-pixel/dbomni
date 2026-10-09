import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import AdminLayout from '../../components/layout/AdminLayout';
import { useAuth } from '../../contexts/AuthContext';

const API = 'http://localhost/api';

// Gói 35: Thiết lập QR chấm công theo chi nhánh — xem QR, copy URL, tạo lại mã, tải PNG.
export default function AttendanceQr() {
    const { can } = useAuth();
    const [branches, setBranches] = useState([]);
    const [branchId, setBranchId] = useState('');
    const [qr, setQr] = useState(null); // {branch_name, token, url}
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [baseUrl, setBaseUrl] = useState(''); // Gói 37e: địa chỉ máy chủ cho QR (IP LAN)
    const [baseSaved, setBaseSaved] = useState(false);
    const qrCanvasRef = useRef(null);

    const fetchBase = useCallback(async () => {
        try {
            const r = await axios.get(API + '/settings');
            setBaseUrl(r.data?.qr_base_url || '');
        } catch (e) { /* giữ trống */ }
    }, []);
    useEffect(() => { fetchBase(); }, [fetchBase]);

    const saveBase = async () => {
        const v = baseUrl.trim().replace(/\/+$/, '');
        if (v && !/^https?:\/\/.+/.test(v)) return alert('Địa chỉ phải bắt đầu bằng http:// hoặc https://\nVD: http://192.168.1.50:3000');
        try {
            await axios.post(API + '/settings', { settings: { qr_base_url: v } });
            setBaseSaved(true);
            setTimeout(() => setBaseSaved(false), 2000);
            fetchQr(); // QR tự sinh lại link theo địa chỉ mới
        } catch (e) { alert(e.response?.data?.message || 'Lưu địa chỉ thất bại'); }
    };

    const fetchBranches = useCallback(async () => {
        const b = await axios.get(API + '/branches');
        const list = b.data?.data || b.data || [];
        setBranches(list);
        if (!branchId && list.length) setBranchId(String(list[0].id));
    }, [branchId]);
    useEffect(() => { fetchBranches(); }, [fetchBranches]);

    const fetchQr = useCallback(async () => {
        if (!branchId) return;
        setLoading(true);
        try {
            const r = await axios.get(API + '/branches/' + branchId + '/attendance-qr');
            setQr(r.data?.data || null);
        } catch (e) { alert(e.response?.data?.message || 'Tải QR chấm công thất bại'); }
        setLoading(false);
    }, [branchId]);
    useEffect(() => { fetchQr(); }, [fetchQr]);

    if (!can('staff.view')) return (<AdminLayout><div className="p-8 text-center text-gray-500">Không có quyền xem mục Chấm công.</div></AdminLayout>);
    const editable = can('staff.edit');

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
        if (!window.confirm('Tạo lại mã QR chấm công cho chi nhánh này?\nMã cũ sẽ hết hiệu lực — cần in/dán lại QR.')) return;
        try { await axios.post(API + '/branches/' + branchId + '/attendance-qr/regenerate'); fetchQr(); }
        catch (e) { alert(e.response?.data?.message || 'Tạo lại mã thất bại'); }
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
        ctx.fillStyle = '#24305E'; ctx.fillRect(0, 0, W, 760);
        ctx.fillStyle = '#F5A623'; ctx.fillRect(0, 0, W, 8);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Arial, "Segoe UI", sans-serif';
        ctx.fillText('QUÉT ĐỂ CHẤM CÔNG', W / 2, 58);
        ctx.font = '20px Arial, "Segoe UI", sans-serif';
        ctx.fillStyle = '#F5A623';
        ctx.fillText(qr.branch_name || '', W / 2, 96);
        // Khung QR trắng
        ctx.fillStyle = '#ffffff';
        const qs = 440, qx = (W - qs) / 2, qy = 130;
        ctx.beginPath(); ctx.roundRect(qx - 16, qy - 16, qs + 32, qs + 32, 12); ctx.fill();
        ctx.drawImage(src, qx, qy, qs, qs);
        ctx.fillStyle = '#ffffff'; ctx.font = '13px Arial, "Segoe UI", sans-serif';
        ctx.fillText('Quét bằng camera thường hoặc Zalo → đăng nhập 1 lần → bấm chấm công', W / 2, qy + qs + 46);
        ctx.fillStyle = '#9fb0d8'; ctx.font = '12px Arial, "Segoe UI", monospace';
        ctx.fillText(qr.url, W / 2, qy + qs + 70);
        const a = document.createElement('a');
        a.download = 'qr-cham-cong.png';
        a.href = cv.toDataURL('image/png');
        a.click();
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <h1 className="text-xl font-bold">QR chấm công</h1>
                    <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-[13px]">
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                </div>
                <p className="text-[12px] text-gray-500 mb-4">Mỗi chi nhánh có 1 mã QR <b>cố định</b> — chỉ thay đổi khi bấm “Tạo lại mã”. Dán QR tại quán để nhân viên quét chấm công.</p>

                {/* Gói 37e: địa chỉ máy chủ để điện thoại quét QR được */}
                {editable && (
                    <div className="m-card p-4 mb-4 max-w-2xl">
                        <div className="font-bold text-[14px] text-[#24305E] mb-1">📡 Địa chỉ máy chủ <span className="font-normal text-gray-500">(để điện thoại quét QR mở được trang chấm công)</span></div>
                        <p className="text-[12px] text-gray-500 mb-3">Nhập địa chỉ IP trong mạng WiFi của máy chạy hệ thống + cổng 3000, VD: <b className="font-mono">http://192.168.1.50:3000</b>. Xem IP bằng lệnh <b className="font-mono">ipconfig</b> trên máy chủ (dòng “IPv4 Address”). Lưu xong, mọi mã QR tự sinh link theo địa chỉ này — không cần tạo lại mã.</p>
                        <div className="flex gap-2">
                            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.1.50:3000" className="border border-gray-300 rounded px-3 py-2 text-[13px] flex-1 font-mono" />
                            <button onClick={saveBase} className="px-4 py-2 rounded bg-[#24305E] text-white text-[13px] font-semibold whitespace-nowrap">{baseSaved ? '✓ Đã lưu' : 'Lưu'}</button>
                        </div>
                    </div>
                )}

                {loading ? <div className="text-gray-500 text-sm py-10 text-center">Đang tải...</div> : qr ? (
                    <div className="m-card p-6 max-w-2xl">
                        <div className="flex flex-col sm:flex-row gap-6 items-center">
                            {/* QR ẩn độ phân giải cao để tải PNG; QR hiện để xem trước */}
                            <QRCodeCanvas value={qr.url} size={640} level="M" includeMargin={false} style={{ display: 'none' }} ref={(el) => { if (el) qrCanvasRef.current = el; }} />
                            <QRCodeSVG value={qr.url} size={200} level="M" className="rounded shrink-0 border border-gray-100" />
                            <div className="min-w-0 w-full">
                                <div className="font-bold text-[16px]">{qr.branch_name}</div>
                                <div className="text-[12px] text-gray-400 mt-1 break-all font-mono">{qr.url}</div>
                                <div className="flex flex-wrap gap-2 mt-4">
                                    <button onClick={copyUrl} className="px-4 py-2 rounded border border-gray-300 text-[13px]">{copied ? '✓ Đã sao chép' : 'Sao chép URL'}</button>
                                    <button onClick={downloadPng} className="px-4 py-2 rounded bg-[#F5A623] text-[#24305E] text-[13px] font-semibold">⬇ Tải PNG</button>
                                    {editable && <button onClick={regen} className="px-4 py-2 rounded border border-red-300 text-red-600 text-[13px]">Tạo lại mã</button>}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-gray-400 text-[13px] py-10 text-center">Chọn chi nhánh để xem mã QR.</div>
                )}
            </div>
        </AdminLayout>
    );
}
