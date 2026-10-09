import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import AdminLayout from '../../components/layout/AdminLayout';
import { fmtDate, fmtDateTime } from '../../utils/format';
import DateInput from '../../components/DateInput';

const API = 'http://localhost/api';

// =====================================================================
// Gói 5 (2026-10-05): Khách hàng — tìm theo SĐT/tên/mã TV, thêm mới,
// chi tiết (điểm, hạng, tổng tiền, đơn hàng, lịch sử điểm), mã QR thành viên.
// =====================================================================
export default function Customers() {
    const [list, setList] = useState([]);
    const [page, setPage] = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [search, setSearch] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', birthday: '', note: '' });
    const [detail, setDetail] = useState(null);
    const [adjust, setAdjust] = useState({ change: '', note: '' });

    const fetchList = async (p = 1, s = search) => {
        try {
            const res = await axios.get(`${API}/customers`, { params: { page: p, search: s, per_page: 20 } });
            if (res.data?.success) {
                setList(res.data.data.data || []);
                setPage(res.data.data.current_page || 1);
                setLastPage(res.data.data.last_page || 1);
            }
        } catch (err) { console.error('Lỗi tải khách hàng:', err); }
    };
    useEffect(() => { fetchList(1, ''); }, []);

    const handleSearch = (e) => {
        e.preventDefault();
        fetchList(1, search);
    };

    const handleAdd = async () => {
        if (!form.name.trim() || !form.phone.trim()) return alert('Nhập tên và SĐT');
        try {
            const res = await axios.post(`${API}/customers`, form);
            if (res.data?.success) {
                setShowAdd(false);
                setForm({ name: '', phone: '', birthday: '', note: '' });
                fetchList(1, '');
                alert(`Đã thêm khách hàng. Mã TV: ${res.data.data.member_code}`);
            }
        } catch (err) { alert(err.response?.data?.message || 'Thêm thất bại (SĐT có thể đã tồn tại)'); }
    };

    const openDetail = async (id) => {
        try {
            const res = await axios.get(`${API}/customers/${id}`);
            if (res.data?.success) setDetail(res.data.data);
        } catch (err) { alert('Tải chi tiết thất bại'); }
    };

    const handleAdjust = async () => {
        const change = parseInt(adjust.change, 10);
        if (!change) return alert('Nhập số điểm (âm để trừ)');
        try {
            const res = await axios.post(`${API}/customers/${detail.id}/adjust-points`, { change, note: adjust.note });
            if (res.data?.success) {
                setAdjust({ change: '', note: '' });
                openDetail(detail.id);
                fetchList(page, search);
            }
        } catch (err) { alert(err.response?.data?.message || 'Điều chỉnh thất bại'); }
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-800">Khách hàng</h1>
                        <p className="text-[13px] text-[#6b7280] mt-0.5">SĐT là mã định danh. Mã TV dùng cho QR quét tích điểm.</p>
                    </div>
                    <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">
                        + Khách hàng
                    </button>
                </div>

                <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                    <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="Tìm theo SĐT / tên / mã TV..."
                        className="w-80 px-3 py-2 text-[13px] border border-gray-300 rounded focus:outline-none focus:border-[#0d6efd]" />
                    <button className="px-4 py-2 bg-gray-100 text-[13px] rounded hover:bg-gray-200">Tìm</button>
                </form>

                <div className="bg-white rounded shadow-sm overflow-x-auto">
                    <table className="w-full text-[13px] min-w-[800px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-100">
                                <th className="px-4 py-3 font-medium">Mã TV</th>
                                <th className="px-3 py-3 font-medium">Tên</th>
                                <th className="px-3 py-3 font-medium">SĐT</th>
                                <th className="px-3 py-3 font-medium">Hạng</th>
                                <th className="px-3 py-3 font-medium text-right">Điểm</th>
                                <th className="px-3 py-3 font-medium text-right">Tổng đã mua</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.map((c) => (
                                <tr key={c.id} className="border-b border-gray-50 hover:bg-blue-50/40">
                                    <td className="px-4 py-3 font-mono text-xs">{c.member_code}</td>
                                    <td className="px-3 py-3 font-medium">{c.name}</td>
                                    <td className="px-3 py-3">{c.phone}</td>
                                    <td className="px-3 py-3"><span className="px-2 py-0.5 rounded-full text-[11px] bg-violet-50 text-violet-700 border border-violet-200">{c.tier?.name || '—'}</span></td>
                                    <td className="px-3 py-3 text-right font-bold text-amber-600">{Number(c.points).toLocaleString('vi-VN')}</td>
                                    <td className="px-3 py-3 text-right">{Number(c.total_spent).toLocaleString('vi-VN')}đ</td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => openDetail(c.id)} className="text-[#0d6efd] hover:underline">Chi tiết</button>
                                    </td>
                                </tr>
                            ))}
                            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có khách hàng nào.</td></tr>}
                        </tbody>
                    </table>
                </div>

                {lastPage > 1 && (
                    <div className="flex justify-center gap-2 mt-4">
                        <button disabled={page <= 1} onClick={() => fetchList(page - 1, search)} className="px-3 py-1.5 border rounded text-[13px] disabled:opacity-40">‹ Trước</button>
                        <span className="text-[13px] text-gray-500 py-1.5">{page} / {lastPage}</span>
                        <button disabled={page >= lastPage} onClick={() => fetchList(page + 1, search)} className="px-3 py-1.5 border rounded text-[13px] disabled:opacity-40">Sau ›</button>
                    </div>
                )}

                {/* Modal thêm */}
                {showAdd && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
                        <div className="bg-white rounded-lg p-6 w-[420px]" onClick={(e) => e.stopPropagation()}>
                            <h3 className="font-semibold mb-4">Thêm khách hàng</h3>
                            <div className="space-y-3">
                                <div><label className="text-xs text-gray-500">Tên *</label>
                                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                                <div><label className="text-xs text-gray-500">SĐT * (định danh)</label>
                                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                                <div><label className="text-xs text-gray-500">Sinh nhật</label>
                                    <DateInput value={form.birthday} onChange={(v) => setForm({ ...form, birthday: v })} className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                                <div><label className="text-xs text-gray-500">Ghi chú</label>
                                    <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full mt-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" /></div>
                            </div>
                            <div className="flex gap-2 mt-5">
                                <button onClick={handleAdd} className="px-4 py-2 bg-[#0d6efd] text-white text-[13px] font-medium rounded hover:bg-[#0b5ed7]">Lưu</button>
                                <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-[13px] text-gray-500">Hủy</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal chi tiết */}
                {detail && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
                        <div className="bg-white rounded-lg p-6 w-[640px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-semibold text-[16px]">{detail.name}</h3>
                                    <div className="text-[13px] text-gray-500">{detail.phone} · Mã TV: <span className="font-mono">{detail.member_code}</span></div>
                                </div>
                                <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                            </div>

                            <div className="flex gap-6 mb-5">
                                <div className="flex-1 grid grid-cols-2 gap-3 text-[13px]">
                                    <div className="bg-gray-50 rounded p-3"><div className="text-gray-500 text-xs">Hạng thành viên</div><div className="font-semibold text-violet-700">{detail.tier?.name || '—'}</div></div>
                                    <div className="bg-gray-50 rounded p-3"><div className="text-gray-500 text-xs">Điểm hiện tại</div><div className="font-bold text-amber-600 text-lg">{Number(detail.points).toLocaleString('vi-VN')}</div></div>
                                    <div className="bg-gray-50 rounded p-3"><div className="text-gray-500 text-xs">Tổng đã mua</div><div className="font-semibold">{Number(detail.total_spent).toLocaleString('vi-VN')}đ</div></div>
                                    <div className="bg-gray-50 rounded p-3"><div className="text-gray-500 text-xs">Sinh nhật</div><div className="font-medium">{fmtDate(detail.birthday) || '—'}</div></div>
                                </div>
                                <div className="text-center">
                                    <QRCodeSVG value={detail.member_code} size={120} />
                                    <div className="text-[11px] text-gray-500 mt-1">QR tích điểm</div>
                                </div>
                            </div>

                            <div className="border-t pt-4 mb-4">
                                <h4 className="font-medium text-[14px] mb-2">Điều chỉnh điểm thủ công</h4>
                                <div className="flex gap-2">
                                    <input type="number" value={adjust.change} onChange={(e) => setAdjust({ ...adjust, change: e.target.value })}
                                        placeholder="+/- điểm" className="w-32 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" />
                                    <input value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
                                        placeholder="Lý do" className="flex-1 px-3 py-2 text-[13px] border rounded focus:outline-none focus:border-[#0d6efd]" />
                                    <button onClick={handleAdjust} className="px-4 py-2 bg-gray-800 text-white text-[13px] rounded hover:bg-gray-700">Áp dụng</button>
                                </div>
                            </div>

                            <div className="border-t pt-4 mb-4">
                                <h4 className="font-medium text-[14px] mb-2">Lịch sử điểm</h4>
                                {(detail.pointTransactions || []).map((t) => (
                                    <div key={t.id} className="flex justify-between text-[13px] border-b border-gray-50 py-1.5">
                                        <span className="text-gray-600">{t.note || t.type} <span className="text-gray-400 text-xs">· {fmtDateTime(t.created_at)}</span></span>
                                        <span className={`font-bold ${t.change > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{t.change > 0 ? '+' : ''}{t.change}</span>
                                    </div>
                                ))}
                                {(detail.pointTransactions || []).length === 0 && <p className="text-xs text-gray-400">Chưa có giao dịch điểm.</p>}
                            </div>

                            <div className="border-t pt-4">
                                <h4 className="font-medium text-[14px] mb-2">Đơn hàng đã mua</h4>
                                {(detail.orders || []).map((o) => (
                                    <div key={o.id} className="flex justify-between text-[13px] border-b border-gray-50 py-1.5">
                                        <span className="font-medium">{o.code} <span className="text-gray-400 text-xs">· {fmtDateTime(o.created_at)}</span></span>
                                        <span className="font-semibold">{Number(o.total_amount).toLocaleString('vi-VN')}đ</span>
                                    </div>
                                ))}
                                {(detail.orders || []).length === 0 && <p className="text-xs text-gray-400">Chưa có đơn hàng.</p>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AdminLayout>
    );
}
