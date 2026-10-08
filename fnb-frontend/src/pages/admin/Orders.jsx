import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { printBill, printLabels } from '../../utils/print';

// =====================================================================
// Gói 2 (2026-10-04): Trang Hóa đơn theo style Sapo.
// - Tabs trạng thái, tìm kiếm theo mã/tên KH, bảng hóa đơn, phân trang.
// - Bấm vào dòng -> xem chi tiết đơn. Nút "Xuất hóa đơn" -> tải CSV.
// =====================================================================

const TABS = [
    { key: 'all', label: 'Tất cả hóa đơn' },
    // Gói 11: đơn Zalo chờ xác nhận (xác nhận ở KDS xong mới vào Hóa đơn)
    { key: 'awaiting_confirm', label: '🕐 Chờ xác nhận (Zalo)' },
    { key: 'paid', label: 'Đã thanh toán' },
    { key: 'pending_payment', label: 'Chờ xác nhận thanh toán' },
    { key: 'cancelled', label: 'Đã hủy' },
];

const PAYMENT_LABELS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };
// Gói 3: nhãn loại đơn hàng
const ORDER_TYPE_LABELS = { takeaway: 'Mang đi', delivery: 'Giao hàng', dine_in: 'Tại bàn' };

const statusPill = (status) => {
    switch (status) {
        case 'completed':
            return <span className="px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-green-50 text-green-700 border border-green-200">Hoàn thành</span>;
        case 'cancelled':
            return <span className="px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-red-50 text-red-600 border border-red-200">Đã hủy</span>;
        case 'held':
            return <span className="px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-amber-50 text-amber-700 border border-amber-200">Đang lưu</span>;
        default:
            return <span className="px-2.5 py-1 rounded-full text-[11.5px] font-medium bg-blue-50 text-blue-700 border border-blue-200">Đang xử lý</span>;
    }
};

const fmtDateTime = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const Orders = () => {
    const [tab, setTab] = useState('all');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [orders, setOrders] = useState([]);
    const [pagination, setPagination] = useState(null);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);

    // Gói 3: tách/gộp đơn
    const [checked, setChecked] = useState({}); // {orderId: true}
    const [splitOrder, setSplitOrder] = useState(null); // đơn đang tách
    const [splitQty, setSplitQty] = useState({}); // {orderItemId: qty}

    const toggleCheck = (id) => {
        setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const checkedIds = Object.keys(checked).filter((k) => checked[k]).map(Number);
    const checkedOrders = orders.filter((o) => checkedIds.includes(o.id));

    const handleMerge = async () => {
        if (checkedIds.length < 2) return alert('Chọn ít nhất 2 đơn để gộp.');
        const target = checkedOrders[0];
        if (!window.confirm(`Gộp ${checkedIds.length} đơn vào đơn ${target.code}? Các đơn còn lại sẽ bị hủy (không hoàn kho).`)) return;
        try {
            const res = await axios.post('http://localhost/api/orders/merge', {
                target_order_id: target.id,
                order_ids: checkedIds,
            });
            if (res.data?.success) {
                alert(res.data.message);
                setChecked({});
                fetchOrders();
            } else {
                alert(res.data?.message || 'Gộp đơn thất bại');
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Gộp đơn thất bại');
        }
    };

    const openSplit = (order) => {
        const init = {};
        (order.items || []).forEach((it) => { init[it.id] = 0; });
        setSplitQty(init);
        setSplitOrder(order);
    };

    const handleSplit = async () => {
        const items = Object.entries(splitQty)
            .filter(([, q]) => Number(q) > 0)
            .map(([order_item_id, quantity]) => ({ order_item_id: Number(order_item_id), quantity: Number(quantity) }));
        if (items.length === 0) return alert('Chọn ít nhất 1 món để tách.');
        try {
            const res = await axios.post(`http://localhost/api/orders/${splitOrder.id}/split`, { items });
            if (res.data?.success) {
                alert(`${res.data.message}. Đơn mới: ${res.data.data.new_order.code}`);
                setSplitOrder(null);
                setSelected(null);
                fetchOrders();
            } else {
                alert(res.data?.message || 'Tách đơn thất bại');
            }
        } catch (err) {
            alert(err.response?.data?.message || 'Tách đơn thất bại');
        }
    };

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ tab, page, per_page: 15 });
            if (search) params.append('search', search);
            const res = await axios.get(`http://localhost/api/orders?${params}`);
            if (res.data?.success) {
                setOrders(res.data.data.data || []);
                const { data: _d, ...pg } = res.data.data;
                setPagination(pg);
            }
        } catch (err) {
            console.error('Lỗi tải hóa đơn:', err);
        } finally {
            setLoading(false);
        }
    }, [tab, page, search]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    const handleTab = (key) => { setTab(key); setPage(1); };
    const handleSearch = () => { setSearch(searchInput.trim()); setPage(1); };

    const exportCsv = () => {
        const header = ['Ma', 'Thoi gian', 'Thu ngan', 'Khach hang', 'Thanh toan', 'Tong tien', 'Trang thai'];
        const rows = orders.map((o) => [
            o.code,
            fmtDateTime(o.created_at),
            o.user?.name || '',
            o.customer_name || 'Khach le',
            PAYMENT_LABELS[o.payment_method] || o.payment_method,
            o.total_amount,
            o.status,
        ]);
        const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hoa-don-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <AdminLayout>
            <div className="p-5">
                {/* Tiêu đề + nút xuất */}
                <div className="flex items-center justify-between">
                    <h1 className="text-xl font-semibold text-gray-800">Hóa đơn</h1>
                    <button
                        onClick={exportCsv}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-green-700 border border-green-600 rounded px-3 py-2 hover:bg-green-50"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                        </svg>
                        Xuất hóa đơn
                    </button>
                </div>

                <div className="mt-3 bg-white rounded shadow-sm">
                    {/* Tabs */}
                    <div className="flex items-center justify-between border-b border-gray-100 px-4">
                        <div className="flex gap-1 overflow-x-auto">
                            {TABS.map((t) => (
                                <button
                                    key={t.key}
                                    onClick={() => handleTab(t.key)}
                                    className={`px-3 py-3 text-[13px] whitespace-nowrap border-b-2 -mb-px transition-colors ${
                                        tab === t.key
                                            ? 'border-[#0d6efd] text-[#0d6efd] font-medium'
                                            : 'border-transparent text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <button className="text-[13px] text-[#0d6efd] hover:underline whitespace-nowrap ml-4 hidden sm:block">
                            Tùy chỉnh hiển thị
                        </button>
                    </div>

                    {/* Bộ lọc */}
                    <div className="flex gap-2.5 p-4">
                        <select
                            disabled
                            className="text-[13px] border border-gray-300 rounded px-3 py-2 bg-gray-50 text-gray-400 cursor-not-allowed"
                        >
                            <option>Lọc hóa đơn</option>
                        </select>
                        <div className="flex-1 relative">
                            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M21 21l-4.35-4.35M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                            </svg>
                            <input
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder="Tìm kiếm qua mã tham chiếu / tên đơn"
                                className="w-full text-[13px] border border-gray-300 rounded pl-9 pr-3 py-2 focus:outline-none focus:border-[#0d6efd]"
                            />
                        </div>
                        <button
                            onClick={handleSearch}
                            className="text-[13px] border border-gray-300 rounded px-4 py-2 text-gray-600 hover:bg-gray-50"
                        >
                            Tìm kiếm
                        </button>
                        {/* Gói 3: gộp đơn */}
                        {checkedIds.length >= 2 && (
                            <button
                                onClick={handleMerge}
                                className="text-[13px] bg-[#7c3aed] text-white rounded px-4 py-2 font-medium hover:bg-[#6d28d9]"
                            >
                                Gộp {checkedIds.length} đơn
                            </button>
                        )}
                    </div>

                    {/* Bảng */}
                    <div className="overflow-x-auto border-t border-gray-100">
                        <table className="w-full text-[13px] min-w-[1000px]">
                            <thead>
                                <tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="px-4 py-3 w-10">
                                        <input
                                            type="checkbox"
                                            className="accent-[#0d6efd]"
                                            checked={orders.length > 0 && orders.every((o) => checked[o.id])}
                                            onChange={(e) => {
                                                const next = {};
                                                if (e.target.checked) orders.forEach((o) => { next[o.id] = true; });
                                                setChecked(next);
                                            }}
                                        />
                                    </th>
                                    <th className="px-3 py-3 font-medium">Thời gian thanh toán</th>
                                    <th className="px-3 py-3 font-medium">Mã tham chiếu</th>
                                    <th className="px-3 py-3 font-medium">Thu ngân</th>
                                    <th className="px-3 py-3 font-medium">Chi nhánh</th>
                                    <th className="px-3 py-3 font-medium">Thông tin KH</th>
                                    <th className="px-3 py-3 font-medium">Thanh toán</th>
                                    <th className="px-3 py-3 font-medium text-right">Tổng tiền</th>
                                    <th className="px-4 py-3 font-medium">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Đang tải...</td></tr>
                                ) : orders.length === 0 ? (
                                    <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Chưa có hóa đơn nào.</td></tr>
                                ) : (
                                    orders.map((o) => (
                                        <tr
                                            key={o.id}
                                            onClick={() => setSelected(o)}
                                            className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer"
                                        >
                                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    className="accent-[#0d6efd]"
                                                    checked={!!checked[o.id]}
                                                    onChange={() => toggleCheck(o.id)}
                                                />
                                            </td>
                                            <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{fmtDateTime(o.created_at)}</td>
                                            <td className="px-3 py-3 text-[#0d6efd] font-medium">
                                                {o.code}
                                                {o.online_channel === 'zalo' && (
                                                    <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">ZALO</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3">{o.user?.name || '-'}</td>
                                            <td className="px-3 py-3">{o.branch?.name || '-'}</td>
                                            <td className="px-3 py-3">{o.customer_name || 'Khách lẻ'}</td>
                                            <td className="px-3 py-3">{PAYMENT_LABELS[o.payment_method] || o.payment_method}</td>
                                            <td className="px-3 py-3 text-right font-bold whitespace-nowrap">
                                                {Number(o.total_amount).toLocaleString('vi-VN')} đ
                                            </td>
                                            <td className="px-4 py-3">{statusPill(o.status)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Phân trang */}
                    {pagination && pagination.last_page > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-[13px] text-gray-500">
                            <span>
                                Hiển thị {pagination.from}–{pagination.to} / {pagination.total} hóa đơn
                            </span>
                            <div className="flex gap-1.5">
                                <button
                                    disabled={page <= 1}
                                    onClick={() => setPage(page - 1)}
                                    className="px-3 py-1.5 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
                                >
                                    ‹ Trước
                                </button>
                                <span className="px-3 py-1.5 font-medium text-gray-800">
                                    {page} / {pagination.last_page}
                                </span>
                                <button
                                    disabled={page >= pagination.last_page}
                                    onClick={() => setPage(page + 1)}
                                    className="px-3 py-1.5 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
                                >
                                    Sau ›
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal chi tiết */}
            {selected && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
                    <div className="bg-white rounded-lg w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                            <h3 className="font-semibold text-gray-800">
                                Hóa đơn <span className="text-[#0d6efd]">{selected.code}</span>
                            </h3>
                            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
                        </div>
                        <div className="px-5 py-4 space-y-2 text-[13px]">
                            <div className="flex justify-between"><span className="text-gray-500">Thời gian:</span><span>{fmtDateTime(selected.created_at)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Thu ngân:</span><span>{selected.user?.name || '-'}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Khách hàng:</span><span>{selected.customer_name || 'Khách lẻ'}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Thanh toán:</span><span>{PAYMENT_LABELS[selected.payment_method] || selected.payment_method}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">Trạng thái:</span><span>{statusPill(selected.status)}</span></div>
                            {/* Gói 3: loại đơn + chiết khấu */}
                            {selected.order_type && (
                                <div className="flex justify-between"><span className="text-gray-500">Loại đơn:</span><span>{ORDER_TYPE_LABELS[selected.order_type] || selected.order_type}</span></div>
                            )}
                            {Number(selected.discount_amount) > 0 && (
                                <div className="flex justify-between"><span className="text-gray-500">Chiết khấu:</span><span className="text-emerald-600">-{Number(selected.discount_amount).toLocaleString('vi-VN')} đ</span></div>
                            )}
                            {selected.cancel_reason && (
                                <div className="flex justify-between"><span className="text-gray-500">Lý do hủy:</span><span className="text-red-600">{selected.cancel_reason}</span></div>
                            )}
                            <div className="pt-2 border-t border-gray-100">
                                <div className="font-medium text-gray-700 mb-2">Mặt hàng:</div>
                                <div className="space-y-1.5">
                                    {(selected.items || []).map((it) => (
                                        <div key={it.id} className="flex justify-between">
                                            <span>
                                                {it.product?.name || it.product_name} × {it.quantity}
                                                {it.option?.name && <span className="text-gray-400 text-xs"> ({it.option.name})</span>}
                                            </span>
                                            <span className="font-medium">{Number(it.price * it.quantity).toLocaleString('vi-VN')} đ</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex justify-between pt-2 border-t border-gray-100 text-[15px] font-bold">
                                <span>Tổng cộng:</span>
                                <span>{Number(selected.total_amount).toLocaleString('vi-VN')} đ</span>
                            </div>
                            {/* Gói 6: xác nhận đơn online (đã nhận tiền -> trừ kho, vào KDS) */}
                            {selected.online_channel === 'zalo' && selected.payment_status === 'pending' && selected.status !== 'cancelled' && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(`Xác nhận đã nhận tiền đơn ${selected.code}? Đơn sẽ trừ kho và vào KDS.`)) return;
                                        try {
                                            const res = await axios.post(`http://localhost/api/orders/${selected.id}/confirm-payment`);
                                            if (res.data?.success) { alert(res.data.message); setSelected(null); fetchOrders(); }
                                            else alert(res.data?.message || 'Lỗi');
                                        } catch (e) { alert(e.response?.data?.message || 'Lỗi'); }
                                    }}
                                    className="w-full py-2.5 bg-green-600 text-white rounded text-[13px] font-bold hover:bg-green-700"
                                >
                                    ✅ Xác nhận đã nhận tiền (vào KDS)
                                </button>
                            )}
                            {/* Gói 3: tách đơn + in lại */}
                            <div className="flex gap-2 pt-2">
                                {!['cancelled', 'completed'].includes(selected.status) && (
                                    <button
                                        onClick={() => openSplit(selected)}
                                        className="flex-1 py-2 bg-[#7c3aed] text-white rounded text-[13px] font-medium hover:bg-[#6d28d9]"
                                    >
                                        Tách đơn
                                    </button>
                                )}
                                <button
                                    onClick={() => printBill({
                                        code: selected.code,
                                        date: fmtDateTime(selected.created_at),
                                        customer_name: selected.customer_name,
                                        order_type: selected.order_type,
                                        subtotal: selected.subtotal_amount,
                                        discount: selected.discount_amount,
                                        total: selected.total_amount,
                                        payment_method: selected.payment_method,
                                        items: (selected.items || []).map((it) => ({
                                            product_name: it.product?.name || it.product_name,
                                            quantity: it.quantity,
                                            unit_price: it.unit_price ?? it.price,
                                            note: it.option?.name || it.note,
                                        })),
                                    })}
                                    className="flex-1 py-2 bg-slate-700 text-white rounded text-[13px] font-medium hover:bg-slate-800"
                                >
                                    In bill
                                </button>
                                <button
                                    onClick={() => printLabels({
                                        code: selected.code,
                                        items: (selected.items || []).map((it) => ({
                                            product_name: it.product?.name || it.product_name,
                                            quantity: it.quantity,
                                            note: it.option?.name || it.note,
                                        })),
                                    })}
                                    className="flex-1 py-2 bg-amber-600 text-white rounded text-[13px] font-medium hover:bg-amber-700"
                                >
                                    In tem
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Gói 3: Modal tách đơn */}
            {splitOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSplitOrder(null)}>
                    <div className="bg-white rounded-lg w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                            <h3 className="font-semibold text-gray-800">
                                Tách món từ đơn <span className="text-[#0d6efd]">{splitOrder.code}</span>
                            </h3>
                            <button onClick={() => setSplitOrder(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
                        </div>
                        <div className="px-5 py-4 space-y-2 text-[13px] max-h-[50vh] overflow-y-auto">
                            <p className="text-gray-500 text-xs mb-2">Nhập số lượng cần tách sang đơn mới (0 = không tách). Kho không thay đổi.</p>
                            {(splitOrder.items || []).map((it) => (
                                <div key={it.id} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2">
                                    <span className="flex-1">
                                        {it.product?.name || it.product_name} × {it.quantity}
                                        {it.option?.name && <span className="text-gray-400 text-xs"> ({it.option.name})</span>}
                                    </span>
                                    <input
                                        type="number"
                                        min="0"
                                        max={it.quantity}
                                        value={splitQty[it.id] ?? 0}
                                        onChange={(e) => setSplitQty((prev) => ({
                                            ...prev,
                                            [it.id]: Math.max(0, Math.min(it.quantity, Number(e.target.value) || 0)),
                                        }))}
                                        className="w-16 px-2 py-1 text-[13px] border border-gray-300 rounded text-center"
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
                            <button
                                onClick={() => setSplitOrder(null)}
                                className="flex-1 py-2 text-gray-500 text-[13px]"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSplit}
                                className="flex-1 py-2 bg-[#7c3aed] text-white rounded text-[13px] font-medium hover:bg-[#6d28d9]"
                            >
                                Xác nhận tách
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default Orders;
