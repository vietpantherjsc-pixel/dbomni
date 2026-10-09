import React, { useState, useRef } from 'react';
import axios from 'axios';

// =====================================================================
// Gói 23 (2026-10-09): Import đơn hàng từ Excel — wizard 4 bước.
// Spec: demo-import-excel-v2.html
//   B1 chọn file (kéo-thả) -> B2 map cột thủ công -> B3 preview+validate
//   -> B4 kết quả + tải CSV dòng lỗi.
// =====================================================================

const API = 'http://localhost/api';

const SYS_FIELDS = [
    { v: '', t: '— Bỏ qua cột này —' },
    { v: 'order_code', t: 'Mã hóa đơn *' },
    { v: 'source', t: 'Nguồn đơn' },
    { v: 'status', t: 'Trạng thái đơn hàng' },
    { v: 'order_date', t: 'Ngày tạo đơn' },
    { v: 'item_name', t: 'Tên mặt hàng *' },
    { v: 'qty', t: 'Số lượng *' },
    { v: 'unit', t: 'Đơn vị' },
    { v: 'price', t: 'Giá bán *' },
    { v: 'option', t: 'Tên lựa chọn (tùy chọn món)' },
    { v: 'payment', t: 'Phương thức thanh toán' },
    { v: 'customer', t: 'Tên khách hàng' },
    { v: 'phone', t: 'SĐT khách hàng' },
    { v: 'cashier', t: 'Thu ngân' },
    { v: 'note', t: 'Ghi chú' },
    { v: 'fee', t: 'Phí dịch vụ' },
];
const REQUIRED = ['order_code', 'item_name', 'qty', 'price'];
const REQ_LABEL = { order_code: 'Mã hóa đơn', item_name: 'Tên mặt hàng', qty: 'Số lượng', price: 'Giá bán' };

const norm = (s) =>
    (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// Tự nhận diện cột Excel -> trường hệ thống
function autoMap(headerName) {
    const n = ' ' + norm(headerName) + ' ';
    if (n.includes(' ma hoa don ')) return 'order_code';
    if (n.includes(' nguon don ')) return 'source';
    if (n.includes(' trang thai ')) return 'status';
    if (n.includes(' thoi gian tao ') || n.includes(' ngay tao ')) return 'order_date';
    if (n.includes(' ten mat hang ')) return 'item_name';
    if (n.includes(' so luong ')) return 'qty';
    if (n.includes(' don vi ')) return 'unit';
    if (n.includes(' gia ban ')) return 'price';
    if (n.includes(' ten lua chon ')) return 'option';
    if (n.includes(' phuong thuc ')) return 'payment';
    if (n.includes(' so dien thoai ') || n.includes(' sdt ')) return 'phone';
    if (n.includes(' khach hang ')) return 'customer';
    if (n.includes(' thu ngan ')) return 'cashier';
    if (n.includes(' phi dich vu ') || n.includes(' phi gh ')) return 'fee';
    if (n.includes(' ghi chu ')) return 'note';
    return '';
}

const fmtNum = (n) => Number(n || 0).toLocaleString('vi-VN');

function StepBar({ step }) {
    const items = [
        { n: 1, lbl: 'Chọn file', sub: 'Tải lên Excel' },
        { n: 2, lbl: 'Map cột', sub: 'Ghép cột thủ công' },
        { n: 3, lbl: 'Kiểm tra', sub: 'Preview & validate' },
        { n: 4, lbl: 'Kết quả', sub: 'Hoàn tất import' },
    ];
    return (
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden pb-1 mb-4">
            {items.map((s) => (
                <div
                    key={s.n}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] whitespace-nowrap shrink-0 ${
                        step === s.n
                            ? 'border-[#24305E] bg-[#24305E] text-white font-semibold'
                            : step > s.n
                            ? 'border-[#F5A623] bg-amber-50 text-gray-700'
                            : 'border-gray-200 text-gray-500'
                    }`}
                >
                    <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${
                            step === s.n ? 'bg-white text-[#24305E]' : step > s.n ? 'bg-[#F5A623] text-[#24305E]' : 'bg-gray-200 text-gray-500'
                        }`}
                    >
                        {step > s.n ? '✓' : s.n}
                    </span>
                    <span>
                        <span className="block font-semibold leading-tight">{s.lbl}</span>
                        <span className={`block text-[11px] leading-tight ${step === s.n ? 'text-gray-200' : 'text-gray-400'}`}>{s.sub}</span>
                    </span>
                </div>
            ))}
        </div>
    );
}

export default function ImportExcelModal({ onClose, onDone }) {
    const [step, setStep] = useState(1);
    const [fileName, setFileName] = useState('');
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState(null); // {token, headers, samples, total_rows}
    const [mapping, setMapping] = useState({}); // idx -> field
    const [skipped, setSkipped] = useState({}); // idx -> true
    const [valid, setValid] = useState(null); // {rows, summary}
    const [validating, setValidating] = useState(false);
    const [options, setOptions] = useState({ skip_errors: true, create_products: true, no_deduct_stock: true, add_points: true });
    const [result, setResult] = useState(null);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const fileRef = useRef();

    // ---------- B1: upload ----------
    const doUpload = async (f) => {
        if (!f) return;
        setError('');
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', f);
            const res = await axios.post(API + '/orders/import-excel', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (res.data?.success) {
                const d = res.data.data;
                setPreview(d);
                setFileName(f.name);
                // auto map
                const m = {};
                const sk = {};
                d.headers.forEach((h) => {
                    const auto = autoMap(h.name);
                    m[h.index] = auto;
                    if (!auto) sk[h.index] = true;
                });
                setMapping(m);
                setSkipped(sk);
                setStep(2);
            } else {
                setError(res.data?.message || 'Tải file thất bại.');
            }
        } catch (e) {
            setError(e.response?.data?.message || 'Tải file thất bại. Kiểm tra đã chạy "composer require phpoffice/phpspreadsheet" chưa.');
        }
        setUploading(false);
    };

    // ---------- B2: map cột ----------
    const setMap = (idx, field) => {
        setMapping((p) => ({ ...p, [idx]: field }));
        setSkipped((p) => {
            const n = { ...p };
            if (!field) n[idx] = true;
            else delete n[idx];
            return n;
        });
    };
    const remapAuto = () => {
        const m = {};
        const sk = {};
        preview.headers.forEach((h) => {
            const auto = autoMap(h.name);
            m[h.index] = auto;
            if (!auto) sk[h.index] = true;
        });
        setMapping(m);
        setSkipped(sk);
    };
    const gotoValidate = async () => {
        const vals = Object.values(mapping).filter(Boolean);
        const missing = REQUIRED.filter((r) => !vals.includes(r));
        if (missing.length) {
            setError('Thiếu trường bắt buộc: ' + missing.map((m) => REQ_LABEL[m]).join(', '));
            return;
        }
        setError('');
        setValidating(true);
        try {
            const res = await axios.post(API + '/orders/import-excel/validate', {
                token: preview.token,
                mapping,
                create_products: options.create_products,
            });
            if (res.data?.success) {
                setValid(res.data.data);
                setStep(3);
            } else {
                setError(res.data?.message || 'Kiểm tra dữ liệu thất bại.');
            }
        } catch (e) {
            setError(e.response?.data?.message || 'Kiểm tra dữ liệu thất bại.');
        }
        setValidating(false);
    };

    // ---------- B4: confirm ----------
    const doImport = async () => {
        setError('');
        setImporting(true);
        setResult(null);
        try {
            const res = await axios.post(API + '/orders/import-excel/confirm', {
                token: preview.token,
                mapping,
                skip_errors: options.skip_errors,
                create_products: options.create_products,
                deduct_stock: !options.no_deduct_stock,
                add_points: options.add_points,
            });
            if (res.data?.success) {
                setResult(res.data.data);
                setStep(4);
            } else {
                setError(res.data?.message || 'Import thất bại.');
            }
        } catch (e) {
            setError(e.response?.data?.message || 'Import thất bại.');
        }
        setImporting(false);
    };

    const downloadCsv = () => {
        const rows = result?.error_rows || [];
        const lines = ['Dòng,Mã hóa đơn,Tên mặt hàng,Lý do lỗi'];
        rows.forEach((r) => {
            lines.push([r.n, r.order_code, '"' + String(r.item_name).replace(/"/g, '""') + '"', '"' + String(r.message).replace(/"/g, '""') + '"'].join(','));
        });
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'bao-cao-loi-import-hoa-don.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 500);
    };

    const statusBadge = (st, msg) => {
        if (st === 'ok') return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">✓ Hợp lệ</span>;
        if (st === 'error') return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white">✕ {msg}</span>;
        return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">⚠ {msg}</span>;
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full h-full sm:h-auto sm:rounded-lg sm:max-w-5xl sm:max-h-[92vh] shadow-xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-gray-100 shrink-0">
                    <h3 className="font-semibold text-gray-800 text-[15px]">Import đơn hàng từ Excel</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2">×</button>
                </div>

                {/* Body */}
                <div className="px-4 sm:px-5 py-4 overflow-y-auto grow">
                    <StepBar step={step} />
                    {error && (
                        <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px]">⚠ {error}</div>
                    )}

                    {/* ===== B1 ===== */}
                    {step === 1 && (
                        <div>
                            <p className="text-[13px] text-gray-500 mb-3">
                                Kéo-thả file vào khung bên dưới hoặc bấm để chọn. Hỗ trợ <b>.xlsx</b>, <b>.xls</b>, <b>.csv</b> (tối đa 5.000 dòng).
                            </p>
                            <div
                                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                                    dragOver ? 'border-[#F5A623] bg-amber-50' : 'border-gray-300 bg-gray-50 hover:border-[#24305E]'
                                }`}
                                onClick={() => fileRef.current?.click()}
                                onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                                onDrop={(e) => { e.preventDefault(); setDragOver(false); doUpload(e.dataTransfer.files?.[0]); }}
                            >
                                <div className="text-4xl mb-2">📄</div>
                                <p className="text-[14px] font-semibold text-gray-700">Kéo file Excel vào đây</p>
                                <p className="text-[13px] text-gray-400 mb-3">hoặc bấm để chọn file từ máy</p>
                                <span className="inline-block px-4 py-2.5 bg-[#24305E] text-white text-[13px] font-semibold rounded-lg">Chọn file</span>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    className="hidden"
                                    onChange={(e) => doUpload(e.target.files?.[0])}
                                />
                            </div>
                            {fileName && (
                                <div className="mt-3 px-3 py-2.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-[13px] font-semibold">
                                    ✅ Đã phân tích: <b>{fileName}</b>
                                </div>
                            )}
                            {uploading && <p className="mt-3 text-[13px] text-gray-500">Đang đọc file, vui lòng chờ…</p>}
                        </div>
                    )}

                    {/* ===== B2 ===== */}
                    {step === 2 && preview && (
                        <div>
                            <p className="text-[13px] text-gray-500 mb-1">
                                Hệ thống đã tự nhận diện. <b>Hãy kiểm tra và sửa tay</b> các cột nhận diện sai, <b>bỏ</b> các cột dư không cần import.
                            </p>
                            <p className="text-[13px] text-gray-500 mb-3">
                                Trường bắt buộc: <b>Mã hóa đơn</b>, <b>Tên mặt hàng</b>, <b>Số lượng</b>, <b>Giá bán</b>.
                            </p>
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                <table className="w-full text-[13px] min-w-[640px]">
                                    <thead>
                                        <tr className="bg-[#24305E] text-white text-left">
                                            <th className="px-3 py-2.5 font-semibold">Cột trong Excel</th>
                                            <th className="px-3 py-2.5 font-semibold">Giá trị mẫu</th>
                                            <th className="px-3 py-2.5 font-semibold">Map tới trường hệ thống</th>
                                            <th className="px-3 py-2.5"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.headers.map((h) => {
                                            const isSkip = !!skipped[h.index];
                                            const sample = preview.samples[0]?.[h.index] ?? '';
                                            return (
                                                <tr key={h.index} className={`border-t border-gray-100 ${isSkip ? 'bg-gray-50 opacity-60' : ''}`}>
                                                    <td className="px-3 py-2.5 font-semibold text-[#24305E]">{h.name}</td>
                                                    <td className="px-3 py-2.5 text-gray-400 text-[12px]">{sample || '—'}</td>
                                                    <td className="px-3 py-2.5">
                                                        <select
                                                            className="w-full min-w-[170px] px-2.5 py-2 border border-gray-300 rounded-lg text-[13px] bg-white min-h-[40px]"
                                                            value={mapping[h.index] || ''}
                                                            disabled={isSkip}
                                                            onChange={(e) => setMap(h.index, e.target.value)}
                                                        >
                                                            {SYS_FIELDS.map((f) => (
                                                                <option key={f.v} value={f.v}>{f.t}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                                        {isSkip ? (
                                                            <button
                                                                className="px-2.5 py-1.5 text-[12px] border border-gray-300 rounded-lg hover:border-[#24305E]"
                                                                onClick={() => {
                                                                    setSkipped((p) => { const n = { ...p }; delete n[h.index]; return n; });
                                                                    setMapping((p) => ({ ...p, [h.index]: autoMap(h.name) }));
                                                                }}
                                                            >
                                                                ↩ Khôi phục
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="px-2.5 py-1.5 text-[12px] border border-gray-300 rounded-lg hover:border-red-500 hover:text-red-600"
                                                                onClick={() => setMap(h.index, '')}
                                                            >
                                                                ✕ Bỏ cột này
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex flex-wrap justify-between gap-2 mt-4">
                                <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] hover:border-[#24305E]" onClick={() => setStep(1)}>
                                    ← Quay lại
                                </button>
                                <div className="flex gap-2">
                                    <button
                                        className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] hover:border-[#24305E]"
                                        onClick={() => {
                                            const m = {};
                                            const sk = {};
                                            preview.headers.forEach((h) => {
                                                const auto = autoMap(h.name);
                                                m[h.index] = auto;
                                                if (!auto) sk[h.index] = true;
                                            });
                                            setMapping(m);
                                            setSkipped(sk);
                                        }}
                                    >
                                        🔄 Tự động nhận diện lại
                                    </button>
                                    <button
                                        className="px-4 py-2.5 bg-[#24305E] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
                                        disabled={validating}
                                        onClick={gotoValidate}
                                    >
                                        {validating ? 'Đang kiểm tra…' : 'Tiếp tục →'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ===== B3 ===== */}
                    {step === 3 && valid && (
                        <div>
                            <div className="flex flex-wrap gap-2 mb-3">
                                <span className="px-3 py-1.5 rounded-full border border-[#24305E] text-[#24305E] text-[13px] font-bold">🧾 {valid.summary.total_orders} đơn</span>
                                <span className="px-3 py-1.5 rounded-full border border-[#24305E] text-[#24305E] text-[13px] font-bold">📄 {valid.summary.total_rows} dòng</span>
                                <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-[13px] font-bold">⚠ {valid.summary.warnings} cảnh báo</span>
                                <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-700 text-[13px] font-bold">✕ {valid.summary.errors} lỗi</span>
                            </div>
                            <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-[320px] overflow-y-auto">
                                <table className="w-full text-[13px] min-w-[680px]">
                                    <thead className="sticky top-0">
                                        <tr className="bg-[#24305E] text-white text-left">
                                            <th className="px-3 py-2.5 font-semibold">Dòng</th>
                                            <th className="px-3 py-2.5 font-semibold">Mã HĐ</th>
                                            <th className="px-3 py-2.5 font-semibold">Mặt hàng</th>
                                            <th className="px-3 py-2.5 font-semibold">SL</th>
                                            <th className="px-3 py-2.5 font-semibold">Giá bán</th>
                                            <th className="px-3 py-2.5 font-semibold">Ngày tạo</th>
                                            <th className="px-3 py-2.5 font-semibold">Trạng thái</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {valid.rows.slice(0, 200).map((r) => (
                                            <tr key={r.n} className={`border-t border-gray-100 ${r.status === 'error' ? 'bg-red-50' : r.status === 'warning' ? 'bg-amber-50' : ''}`}>
                                                <td className="px-3 py-2">{r.n}</td>
                                                <td className="px-3 py-2 font-semibold">{r.order_code}</td>
                                                <td className="px-3 py-2">{r.item_name}</td>
                                                <td className="px-3 py-2">{r.qty}</td>
                                                <td className="px-3 py-2">{fmtNum(r.price)}đ</td>
                                                <td className="px-3 py-2">{r.order_date || '—'}</td>
                                                <td className="px-3 py-2">{statusBadge(r.status, r.message)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {valid.rows.length > 200 && (
                                <p className="text-[12px] text-gray-400 mt-1">Hiển thị 200/{valid.rows.length} dòng đầu.</p>
                            )}

                            <h4 className="font-semibold text-gray-800 mt-4 mb-2 text-[14px]">Tùy chọn import</h4>
                            <div className="grid sm:grid-cols-2 gap-2.5">
                                {[
                                    { k: 'skip_errors', t: 'Bỏ qua dòng lỗi và tiếp tục', d: 'Dòng lỗi sẽ không được import, dòng hợp lệ vẫn chạy.' },
                                    { k: 'create_products', t: 'Tự động tạo món mới', d: 'Món chưa có sẽ được tạo vào danh mục "Món import" (ẩn khỏi menu).' },
                                    { k: 'no_deduct_stock', t: 'Không trừ kho khi import', d: 'Chỉ ghi nhận doanh thu, không trừ nguyên liệu (dùng cho đơn lịch sử).' },
                                    { k: 'add_points', t: 'Cộng điểm thành viên', d: 'Tự cộng điểm cho các đơn có SĐT khách hàng theo hạng thẻ.' },
                                ].map((o) => (
                                    <label key={o.k} className="flex gap-3 items-start border border-gray-200 rounded-lg p-3 cursor-pointer hover:border-[#24305E]">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 mt-0.5 accent-[#24305E] shrink-0"
                                            checked={!!options[o.k]}
                                            onChange={(e) => setOptions((p) => ({ ...p, [o.k]: e.target.checked }))}
                                        />
                                        <span>
                                            <span className="block font-semibold text-[13px]">{o.t}</span>
                                            <span className="block text-[12px] text-gray-500">{o.d}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>

                            <div className="flex flex-wrap justify-between gap-2 mt-4">
                                <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] hover:border-[#24305E]" onClick={() => setStep(2)}>
                                    ← Quay lại
                                </button>
                                <button
                                    className="px-5 py-2.5 bg-[#F5A623] text-[#24305E] rounded-lg text-[13px] font-bold disabled:opacity-50"
                                    disabled={importing}
                                    onClick={doImport}
                                >
                                    {importing ? 'Đang import…' : '⚡ Bắt đầu import'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ===== B4 ===== */}
                    {step === 4 && result && (
                        <div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                                <div className="border border-gray-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-extrabold text-[#24305E]">{result.created_orders}</div>
                                    <div className="text-[12px] text-gray-500">Đơn được tạo</div>
                                </div>
                                <div className="border border-gray-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-extrabold text-green-600">{result.created_items}</div>
                                    <div className="text-[12px] text-gray-500">Dòng món</div>
                                </div>
                                <div className="border border-gray-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-extrabold text-gray-400">{result.skipped_existing}</div>
                                    <div className="text-[12px] text-gray-500">Bỏ qua (đã có)</div>
                                </div>
                                <div className="border border-gray-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-extrabold text-red-600">{(result.error_rows || []).length}</div>
                                    <div className="text-[12px] text-gray-500">Dòng lỗi</div>
                                </div>
                            </div>
                            {(result.warnings || []).length > 0 && (
                                <div className="mb-3 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[13px]">
                                    {(result.warnings || []).map((w, i) => <div key={i}>⚠ {w}</div>)}
                                </div>
                            )}
                            {(result.error_rows || []).length > 0 && (
                                <div className="overflow-x-auto border border-gray-200 rounded-lg mb-3">
                                    <table className="w-full text-[13px] min-w-[520px]">
                                        <thead>
                                            <tr className="bg-[#24305E] text-white text-left">
                                                <th className="px-3 py-2.5 font-semibold">Dòng</th>
                                                <th className="px-3 py-2.5 font-semibold">Mã HĐ</th>
                                                <th className="px-3 py-2.5 font-semibold">Mặt hàng</th>
                                                <th className="px-3 py-2.5 font-semibold">Lý do lỗi</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.error_rows.map((r) => (
                                                <tr key={r.n} className="border-t border-gray-100 bg-red-50">
                                                    <td className="px-3 py-2">{r.n}</td>
                                                    <td className="px-3 py-2 font-semibold">{r.order_code}</td>
                                                    <td className="px-3 py-2">{r.item_name}</td>
                                                    <td className="px-3 py-2 text-red-600">{r.message}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div className="flex flex-wrap justify-between gap-2">
                                <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px]" onClick={() => { setStep(1); setPreview(null); setValid(null); setResult(null); setFileName(''); }}>
                                    ↺ Import file khác
                                </button>
                                <div className="flex gap-2">
                                    {(result.error_rows || []).length > 0 && (
                                        <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] hover:border-[#24305E]" onClick={downloadCsv}>
                                            ⬇ Tải báo cáo lỗi (.csv)
                                        </button>
                                    )}
                                    <button className="px-5 py-2.5 bg-[#24305E] text-white rounded-lg text-[13px] font-semibold" onClick={onDone}>
                                        Hoàn tất
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
