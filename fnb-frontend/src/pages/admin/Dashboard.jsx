import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';

// =====================================================================
// Gói 7d (2026-10-05): Dashboard theo phong cách B (Matcha).
// - Thẻ kem/trắng, bo 8px, kicker in hoa, số tabular
// - Biểu đồ xanh matcha
// =====================================================================

const fmtMoney = (v) => {
    if (v === null || v === undefined) return 'N/A';
    return `${Number(v).toLocaleString('vi-VN')} đ`;
};

const fmtNum = (v) => {
    if (v === null || v === undefined) return 'N/A';
    return Number(v).toLocaleString('vi-VN');
};

// Thẻ chỉ số (hàng 1)
const StatCell = ({ label, value, hot }) => (
    <div className="flex-1 px-5 py-4 min-w-0">
        <div className="m-kicker truncate">{label}</div>
        <div className={`mt-1.5 text-[22px] font-bold m-num truncate ${hot ? 'text-[var(--m-stamp)]' : 'text-[var(--m-ink)]'}`}>
            {value}
        </div>
    </div>
);

// Thẻ thống kê (hàng 2)
const StatCard = ({ label, value, sub }) => (
    <div className="m-card px-5 py-4">
        <div className="m-kicker">{label}</div>
        <div className="mt-1.5 text-[26px] font-bold m-num text-[var(--m-ink)]">{value}</div>
        {sub && <div className="mt-1 text-[12px] text-[var(--m-ink-faint)]">{sub}</div>}
    </div>
);

const RANGE_OPTIONS = [
    { value: 'today', label: 'Hôm nay' },
    { value: '7d', label: '7 ngày qua' },
    { value: '30d', label: '30 ngày qua' },
];

const Dashboard = () => {
    const [range, setRange] = useState('today');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    // Gói 24: lọc theo chi nhánh từ BranchContext ('0' = tất cả)
    const branchCtx = useBranch();
    const branchId = (branchCtx && branchCtx.branchId) || '0';

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const bq = branchId !== '0' ? `&branch_id=${branchId}` : '';
                const res = await axios.get(
                    `http://localhost/api/admin/dashboard/stats?range=${range}${bq}`
                );
                if (res.data?.success) {
                    setData(res.data.data.sapo || null);
                }
            } catch (err) {
                console.error('Lỗi tải số liệu tổng quan:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [range, branchId]);

    return (
        <AdminLayout>
            <div className="p-6 max-w-[1200px] mx-auto">
                {/* Tiêu đề */}
                <div className="flex items-center gap-3">
                    <h1 className="text-[22px] font-bold text-[var(--m-ink)]">
                        Tổng quan kinh doanh
                    </h1>
                    <span className="m-stamp">LIVE</span>
                </div>

                {/* Bộ lọc */}
                <div className="mt-3 flex items-center gap-2.5">
                    <select
                        value={range}
                        onChange={(e) => setRange(e.target.value)}
                        className="m-select"
                        style={{ width: 'auto' }}
                    >
                        {RANGE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>

                {loading ? (
                    <div className="mt-4 m-card p-12 text-center text-sm text-[var(--m-ink-faint)]">
                        Đang tải số liệu...
                    </div>
                ) : (
                    <>
                        {/* Hàng 1: 5 chỉ số tiền */}
                        <div className="mt-4 m-card flex divide-x overflow-x-auto" style={{ borderColor: 'var(--m-line)' }}>
                            <StatCell label="Tiền hàng" value={fmtMoney(data?.gross_sales)} />
                            <StatCell label="Hoàn hủy" value={fmtMoney(data?.cancelled_total)} />
                            <StatCell label="Giảm giá" value={fmtMoney(data?.discount_total)} />
                            <StatCell label="Thuế phí" value={fmtMoney(data?.tax_total)} />
                            <StatCell label="Doanh thu" value={fmtMoney(data?.revenue)} hot />
                        </div>

                        {/* Hàng 2: 4 thẻ thống kê */}
                        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <StatCard label="Khách hàng" value={fmtNum(data?.customers_count)} />
                            <StatCard label="Hóa đơn" value={fmtNum(data?.orders_count)} />
                            <StatCard label="TB món / hóa đơn" value={fmtNum(data?.avg_items_per_order)} />
                            <StatCard label="TB doanh thu / hóa đơn" value={fmtMoney(data?.avg_revenue_per_order)} />
                        </div>

                        {/* Biểu đồ */}
                        <div className="mt-6 flex items-baseline gap-2">
                            <h2 className="m-kicker" style={{ fontSize: 13 }}>Doanh thu tổng hợp</h2>
                        </div>
                        <div className="mt-2.5 m-card p-5">
                            <div className="h-[340px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={data?.chart || []}
                                        margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E8F0" />
                                        <XAxis
                                            dataKey="label"
                                            tick={{ fontSize: 11, fill: '#9AA0B4' }}
                                            interval={range === 'today' ? 0 : 'preserveStartEnd'}
                                            tickLine={false}
                                            axisLine={{ stroke: '#E9E7DD' }}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 11, fill: '#9AA0B4' }}
                                            tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}tr` : `${Math.round(v / 1000)}k`}
                                            tickLine={false}
                                            axisLine={false}
                                            width={60}
                                        />
                                        <Tooltip
                                            formatter={(v) => [`${Number(v).toLocaleString('vi-VN')} đ`, 'Doanh thu']}
                                            labelStyle={{ fontWeight: 600 }}
                                            contentStyle={{ fontSize: 13, borderRadius: 8, border: '1px solid #E4E8F0' }}
                                        />
                                        <Bar dataKey="revenue" fill="#24305E" radius={[4, 4, 0, 0]} maxBarSize={42} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="mt-3 flex items-center justify-center gap-2 text-[13px] text-[var(--m-ink-soft)]">
                                <span className="w-3.5 h-3.5 rounded inline-block" style={{ background: '#24305E' }} />
                                <span>
                                    Tổng doanh thu: <strong className="m-num">{fmtMoney(data?.revenue)}</strong>
                                </span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </AdminLayout>
    );
};

export default Dashboard;
