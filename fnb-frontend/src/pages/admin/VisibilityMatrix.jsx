// Gói 25 (2026-10-09): component ma trận Ẩn/Hiện theo chi nhánh dùng chung
// cho trang Quản lý hiển thị mặt hàng và Quản lý hiển thị thực đơn.
// Mặc định HIỆN ở tất cả CN — chỉ lưu override ẨN.
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';

const BASE = 'http://localhost/api';

const Switch = ({ checked, onChange, disabled }) => (
    <label className="visw-switch">
        <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
        <span className="visw-slider" />
    </label>
);

export default function VisibilityMatrix({
    title, desc, matrixUrl, toggleUrl, syncUrl,
    rowsKey, rowKey, syncIdsKey, countKey,
}) {
    const [branches, setBranches] = useState([]);
    const [rows, setRows] = useState([]);
    const [hidden, setHidden] = useState(new Set()); // "branchId:rowId"
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const r = await axios.get(`${BASE}${matrixUrl}`);
            const d = r.data.data || {};
            setBranches(d.branches || []);
            setRows(d[rowsKey] || []);
            setHidden(new Set((d.hidden || []).map(([b, id]) => `${b}:${id}`)));
        } catch (e) {
            console.error('Lỗi tải ma trận hiển thị:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s) return rows;
        return rows.filter((r) => (r.name || '').toLowerCase().includes(s));
    }, [rows, q]);

    const k = (b, id) => `${b}:${id}`;
    const isHidden = (b, id) => hidden.has(k(b, id));

    const doToggle = async (b, id) => {
        const h = !isHidden(b, id);
        const nk = new Set(hidden);
        if (h) nk.add(k(b, id)); else nk.delete(k(b, id));
        setHidden(nk); // optimistic
        try {
            await axios.post(`${BASE}${toggleUrl}`, { branch_id: b, [rowKey]: id, hidden: h });
        } catch (e) {
            console.error('Lỗi lưu hiển thị:', e);
            load(); // rollback
        }
    };

    // Bật/Tắt hết 1 cột chi nhánh (áp dụng trên các dòng đang lọc)
    const setColumn = async (branchId, hide) => {
        setBusy(true);
        try {
            const ids = hide ? filtered.map((r) => r.id) : [];
            await axios.post(`${BASE}${syncUrl}`, { branch_id: branchId, [syncIdsKey]: ids });
            const nk = new Set(hidden);
            filtered.forEach((r) => {
                if (hide) nk.add(k(branchId, r.id)); else nk.delete(k(branchId, r.id));
            });
            setHidden(nk);
        } catch (e) {
            console.error('Lỗi lưu hiển thị:', e);
            load();
        } finally {
            setBusy(false);
        }
    };

    const hiddenNames = (row) =>
        branches.filter((b) => isHidden(b.id, row.id)).map((b) => b.name);

    return (
        <AdminLayout>
            <style>{`
                .visw-switch { position: relative; width: 40px; height: 22px; display: inline-block; vertical-align: middle; }
                .visw-switch input { opacity: 0; width: 0; height: 0; }
                .visw-slider { position: absolute; inset: 0; background: #d1d5db; border-radius: 20px; transition: .2s; cursor: pointer; }
                .visw-slider:before { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
                .visw-switch input:checked + .visw-slider { background: #16a34a; }
                .visw-switch input:checked + .visw-slider:before { transform: translateX(18px); }
                .visw-switch input:disabled + .visw-slider { opacity: .5; cursor: not-allowed; }
            `}</style>
            <div className="p-5">
                <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
                <p className="text-sm text-gray-500 mt-1 mb-4">{desc}</p>

                <div className="m-card overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
                        <div className="relative flex-1 min-w-[200px] max-w-xs">
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Tìm kiếm theo tên..."
                                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <span className="text-xs text-gray-400">{filtered.length}/{rows.length}</span>
                    </div>

                    <div className="overflow-x-auto">
                        {loading ? (
                            <div className="p-8 text-center text-sm text-gray-400">Đang tải...</div>
                        ) : (
                            <table className="w-full text-sm" style={{ minWidth: 200 + branches.length * 150 }}>
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">{rowsKey === 'products' ? 'Món' : 'Thực đơn'}</th>
                                        {branches.map((b) => (
                                            <th key={b.id} className="px-4 py-3 font-medium text-gray-500 text-center whitespace-nowrap">
                                                <div>{b.name}</div>
                                                <div className="mt-1 text-[11px] font-normal">
                                                    <button
                                                        onClick={() => setColumn(b.id, false)}
                                                        disabled={busy}
                                                        className="text-blue-600 hover:underline disabled:opacity-40"
                                                    >Bật hết</button>
                                                    <span className="mx-1 text-gray-300">·</span>
                                                    <button
                                                        onClick={() => setColumn(b.id, true)}
                                                        disabled={busy}
                                                        className="text-blue-600 hover:underline disabled:opacity-40"
                                                    >Tắt hết</button>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((row) => {
                                        const hn = hiddenNames(row);
                                        return (
                                            <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-gray-800">
                                                        {row.name}
                                                        {countKey && row[countKey] != null && (
                                                            <span className="ml-2 text-xs text-gray-400 font-normal">({row[countKey]} món)</span>
                                                        )}
                                                    </div>
                                                    {hn.length === 0 ? (
                                                        <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                                                            Hiện ở tất cả CN
                                                        </span>
                                                    ) : (
                                                        <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                                                            Đang ẩn ở: {hn.join(', ')}
                                                        </span>
                                                    )}
                                                </td>
                                                {branches.map((b) => (
                                                    <td key={b.id} className="px-4 py-3 text-center">
                                                        <Switch
                                                            checked={!isHidden(b.id, row.id)}
                                                            onChange={() => doToggle(b.id, row.id)}
                                                            disabled={busy}
                                                        />
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={branches.length + 1} className="p-8 text-center text-sm text-gray-400">
                                            Không tìm thấy.
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
}
