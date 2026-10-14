import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import DateInput from '../../components/DateInput';
import { fmtDateTime } from '../../utils/format';
import { API } from '../../utils/api';

const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const thisMonth = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
// Danh sách tháng: 12 tháng gần nhất
const monthOptions = () => {
    const out = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
        const y = d.getFullYear(), m = d.getMonth() + 1;
        out.push(y + '-' + String(m).padStart(2, '0'));
        d.setMonth(d.getMonth() - 1);
    }
    return out;
};

// Gói 46: Affiliate Zalo Mini App — tab Top thành viên + tab Lịch sử đơn giới thiệu.
export default function Affiliate() {
    const [tab, setTab] = useState(0);
    return (
        <AdminLayout>
            <div className="p-5">
                <h1 className="text-xl font-bold mb-1">Affiliate — Zalo Mini App</h1>
                <p className="text-sm text-gray-500 mb-4">Thống kê thành viên giới thiệu và lịch sử đơn hàng affiliate.</p>
                <div className="flex gap-2 mb-4">
                    <button onClick={() => setTab(0)} className={`px-4 py-2 rounded-lg text-[13px] font-medium border ${tab === 0 ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300'}`}>🏆 Top thành viên</button>
                    <button onClick={() => setTab(1)} className={`px-4 py-2 rounded-lg text-[13px] font-medium border ${tab === 1 ? 'bg-[#24305E] text-white border-[#24305E]' : 'bg-white text-gray-600 border-gray-300'}`}>📜 Lịch sử đơn Affiliate</button>
                </div>
                {tab === 0 ? <TopTab /> : <HistoryTab />}
            </div>
        </AdminLayout>
    );
}

function TopTab() {
    const [month, setMonth] = useState(thisMonth());
    const [limit, setLimit] = useState(20);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchTop = useCallback(async () => {
        setLoading(true);
        try {
            const r = await axios.get(API + '/affiliate/top', { params: { month, limit } });
            setRows(r.data?.data || []);
        } catch (e) { alert(e.response?.data?.message || 'Tải top affiliate thất bại'); }
        setLoading(false);
    }, [month, limit]);
    useEffect(() => { fetchTop(); }, [fetchTop]);

    return (
        <div className="m-card p-4">
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div>
                    <label className="m-label">Tháng</label>
                    <select value={month} onChange={(e) => setMonth(e.target.value)} className="m-input" style={{ width: 140 }}>
                        {monthOptions().map((m) => <option key={m} value={m}>{m.slice(5) + '/' + m.slice(0, 4)}</option>)}
                    </select>
                </div>
            </div>
            {loading ? <div className="text-gray-500 text-sm py-8 text-center">Đang tải...</div> : (
                <>
                    <div className="overflow-x-auto">
                        <table className="m-table min-w-[720px]">
                            <thead><tr>
                                <th>#</th><th>Thành viên</th><th>SĐT</th>
                                <th className="text-right">Số đơn GT</th>
                                <th className="text-right">Tổng tiền đơn GT</th>
                                <th className="text-right">Điểm đã thưởng</th>
                            </tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={r.member_code}>
                                        <td className="font-bold">{i + 1}</td>
                                        <td className="font-medium">{r.name}<div className="text-[11px] text-gray-400">{r.member_code}</div></td>
                                        <td>{r.phone || '—'}</td>
                                        <td className="text-right font-bold">{r.order_count}</td>
                                        <td className="text-right font-bold">{vnd(r.total_amount)}</td>
                                        <td className="text-right">{Number(r.points_awarded).toLocaleString('vi-VN')}</td>
                                    </tr>
                                ))}
                                {rows.length === 0 && <tr><td colSpan={6} className="text-center text-gray-400 py-8">Chưa có dữ liệu tháng này.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    {rows.length >= limit && (
                        <div className="text-center mt-3">
                            <button onClick={() => setLimit(limit + 20)} className="m-btn">Xem thêm ↓</button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function HistoryTab() {
    const [f, setF] = useState({ code: '', referrer: '', from: '', to: '' });
    const [rows, setRows] = useState([]);
    const [page, setPage] = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);

    const fetchOrders = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const r = await axios.get(API + '/affiliate/orders', {
                params: { code: f.code || undefined, referrer: f.referrer || undefined, from: f.from || undefined, to: f.to || undefined, page: p, per_page: 20 },
            });
            const d = r.data?.data;
            setRows(d?.data || []);
            setPage(d?.current_page || 1);
            setLastPage(d?.last_page || 1);
            setTotal(d?.total || 0);
        } catch (e) { alert(e.response?.data?.message || 'Tải lịch sử thất bại'); }
        setLoading(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => { fetchOrders(1); }, []);

    const search = () => fetchOrders(1);

    return (
        <div className="m-card p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div><label className="m-label">Mã đơn hàng</label>
                    <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="VD: DH-20261011" className="m-input w-full" /></div>
                <div><label className="m-label">Người giới thiệu (tên/SĐT)</label>
                    <input value={f.referrer} onChange={(e) => setF({ ...f, referrer: e.target.value })} placeholder="Tên hoặc SĐT" className="m-input w-full" /></div>
                <div><label className="m-label">Từ ngày</label>
                    <DateInput value={f.from} onChange={(v) => setF({ ...f, from: v })} className="m-input w-full" /></div>
                <div><label className="m-label">Đến ngày</label>
                    <DateInput value={f.to} onChange={(v) => setF({ ...f, to: v })} className="m-input w-full" /></div>
            </div>
            <button onClick={search} className="m-btn m-btn-primary mb-4">Tìm kiếm</button>
            {loading ? <div className="text-gray-500 text-sm py-8 text-center">Đang tải...</div> : (
                <>
                    <div className="text-[13px] text-gray-500 mb-2">Tìm thấy <b>{total}</b> đơn.</div>
                    <div className="overflow-x-auto">
                        <table className="m-table min-w-[860px]">
                            <thead><tr>
                                <th>Ngày giờ</th><th>Mã đơn GT</th><th className="text-right">Giá trị đơn</th>
                                <th>Người giới thiệu</th><th>Khách mua</th><th className="text-right">Điểm thưởng</th>
                            </tr></thead>
                            <tbody>
                                {rows.map((o) => (
                                    <tr key={o.id}>
                                        <td className="whitespace-nowrap">{fmtDateTime(o.created_at)}</td>
                                        <td className="font-medium">{o.code}</td>
                                        <td className="text-right font-bold">{vnd(o.total_amount)}</td>
                                        <td>{o.referrer_name}<div className="text-[11px] text-gray-400">{o.referrer_phone} · {o.referred_by}</div></td>
                                        <td>{o.customer?.name || '—'}<div className="text-[11px] text-gray-400">{o.customer?.phone || ''}</div></td>
                                        <td className="text-right text-emerald-600 font-medium">+{Number(o.points_awarded).toLocaleString('vi-VN')}</td>
                                    </tr>
                                ))}
                                {rows.length === 0 && <tr><td colSpan={6} className="text-center text-gray-400 py-8">Không tìm thấy đơn nào.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    {lastPage > 1 && (
                        <div className="flex items-center justify-center gap-3 mt-4 text-[13px]">
                            <button disabled={page <= 1} onClick={() => fetchOrders(page - 1)} className="m-btn m-btn-sm" >‹ Trước</button>
                            <span>Trang {page}/{lastPage}</span>
                            <button disabled={page >= lastPage} onClick={() => fetchOrders(page + 1)} className="m-btn m-btn-sm">Sau ›</button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
