import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { fmtDate as fmtDateShared } from '../../utils/format';

// =====================================================================
// Gói 29 (2026-10-09): Trang Đối tác — dùng chung toàn chuỗi.
// - 2 thẻ tổng: phải thu / phải trả.
// - Bảng đối tác + form thêm/sửa + drawer chi tiết: phiếu công nợ
//   (số tiền/đã trả/còn nợ) + form thanh toán trừ dần + lịch sử thanh toán.
// =====================================================================

const API = 'http://localhost/api';
const TYPE_LABEL = { supplier: 'Nhà cung cấp', customer: 'Khách hàng', other: 'Khác' };
const METHOD_LABEL = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };
const fmtMoney = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';
// Gói 36: dùng chung utils/format (giữ fallback '-')
const fmtDate = (iso) => fmtDateShared(iso) || '-';

const emptyForm = () => ({
    code: '', name: '', type: 'supplier', phone: '', email: '',
    address: '', tax_code: '', note: '', is_active: true,
});

const Partners = () => {
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({ receivable: 0, payable: 0 });
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [fType, setFType] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);

    // Drawer chi tiết
    const [detail, setDetail] = useState(null); // partner + vouchers
    const [payFor, setPayFor] = useState(null); // voucher đang thanh toán
    const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', note: '' });
    const [paying, setPaying] = useState(false);
    const [payHistory, setPayHistory] = useState([]);

    const fetchList = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (search.trim()) params.search = search.trim();
            if (fType) params.type = fType;
            const [r1, r2] = await Promise.all([
                axios.get(`${API}/partners`, { params }),
                axios.get(`${API}/partners/debt-summary`),
            ]);
            setRows(r1.data?.data || []);
            setSummary(r2.data?.data || { receivable: 0, payable: 0 });
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [search, fType]);

    useEffect(() => { fetchList(); }, [fetchList]);

    const openDetail = async (id) => {
        try {
            const [r1, r2] = await Promise.all([
                axios.get(`${API}/partners/${id}`),
                axios.get(`${API}/partners/${id}/payments`),
            ]);
            setDetail(r1.data?.data || null);
            setPayHistory(r2.data?.data || []);
            setPayFor(null);
        } catch {
            alert('Không tải được chi tiết đối tác.');
        }
    };

    const refreshDetail = async (id) => {
        const r1 = await axios.get(`${API}/partners/${id}`);
        setDetail(r1.data?.data || null);
        const r2 = await axios.get(`${API}/partners/${id}/payments`);
        setPayHistory(r2.data?.data || []);
    };

    const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
    const openEdit = (row) => {
        setEditing(row);
        setForm({
            code: row.code || '', name: row.name || '', type: row.type || 'supplier',
            phone: row.phone || '', email: row.email || '', address: row.address || '',
            tax_code: row.tax_code || '', note: row.note || '', is_active: !!row.is_active,
        });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return alert('Nhập tên đối tác.');
        setSaving(true);
        try {
            const body = { ...form, name: form.name.trim(), code: form.code.trim() || undefined };
            if (editing) await axios.put(`${API}/partners/${editing.id}`, body);
            else await axios.post(`${API}/partners`, body);
            setShowForm(false);
            fetchList();
        } catch (e) {
            alert(e.response?.data?.message || 'Lưu thất bại.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Xóa đối tác "${row.name}"?`)) return;
        try {
            await axios.delete(`${API}/partners/${row.id}`);
            fetchList();
        } catch (e) {
            alert(e.response?.data?.message || 'Xóa thất bại.');
        }
    };

    const startPay = (voucher) => {
        setPayFor(voucher);
        setPayForm({ amount: String(voucher.remaining || 0), payment_method: 'cash', note: '' });
    };

    const handlePay = async () => {
        if (!payFor) return;
        const amt = Number(payForm.amount);
        if (!amt || amt < 1) return alert('Nhập số tiền hợp lệ.');
        if (amt > payFor.remaining) return alert(`Số tiền vượt còn nợ (${fmtMoney(payFor.remaining)}).`);
        setPaying(true);
        try {
            await axios.post(`${API}/transactions/${payFor.id}/pay`, {
                amount: amt,
                payment_method: payForm.payment_method,
                note: payForm.note || null,
            });
            setPayFor(null);
            await refreshDetail(detail.id);
            fetchList(); // cập nhật tổng công nợ
        } catch (e) {
            alert(e.response?.data?.message || 'Thanh toán thất bại.');
        } finally {
            setPaying(false);
        }
    };

    return (
        <AdminLayout>
            <div className="p-5">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <h1 className="text-xl font-semibold">Đối tác</h1>
                    <button onClick={openAdd}
                        className="px-4 py-2.5 bg-[#24305E] text-white rounded-lg text-[13px] font-medium min-h-[44px]">
                        + Đối tác
                    </button>
                </div>
                <p className="text-[12.5px] text-gray-500 mb-4">Dùng chung toàn chuỗi. Công nợ trừ dần khi thanh toán.</p>

                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                        <div className="text-[12.5px] text-gray-500">Tổng phải thu</div>
                        <div className="text-xl font-semibold text-green-700 mt-1">{fmtMoney(summary.receivable)}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                        <div className="text-[12.5px] text-gray-500">Tổng phải trả</div>
                        <div className="text-xl font-semibold text-red-700 mt-1">{fmtMoney(summary.payable)}</div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex gap-2 flex-wrap">
                        <input value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm tên/mã/SĐT..."
                            className="flex-1 min-w-[180px] text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                        <select value={fType} onChange={(e) => setFType(e.target.value)}
                            className="text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]">
                            <option value="">Tất cả loại</option>
                            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px] min-w-[760px]">
                            <thead>
                                <tr className="text-left text-gray-500">
                                    <th className="px-4 py-3 font-medium">Đối tác</th>
                                    <th className="px-4 py-3 font-medium">Loại</th>
                                    <th className="px-4 py-3 font-medium">Liên hệ</th>
                                    <th className="px-4 py-3 font-medium text-right">Phải thu</th>
                                    <th className="px-4 py-3 font-medium text-right">Phải trả</th>
                                    <th className="px-4 py-3 font-medium text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Đang tải...</td></tr>
                                ) : rows.length === 0 ? (
                                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Chưa có đối tác.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.id} className="border-t border-gray-100">
                                        <td className="px-4 py-3">
                                            <div className="font-medium">{r.name}</div>
                                            <div className="text-[11.5px] text-gray-400">{r.code}</div>
                                            {!r.is_active && (
                                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Ngừng hợp tác</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">{TYPE_LABEL[r.type] || r.type}</td>
                                        <td className="px-4 py-3 text-[12.5px] text-gray-600">
                                            {r.phone || '-'}<br />{r.address || ''}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-green-700">{fmtMoney(r.receivable)}</td>
                                        <td className="px-4 py-3 text-right font-medium text-red-700">{fmtMoney(r.payable)}</td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            <button onClick={() => openDetail(r.id)}
                                                className="px-3 py-1.5 bg-[#24305E] text-white rounded-lg text-[12.5px] mr-2 min-h-[36px]">Chi tiết</button>
                                            <button onClick={() => openEdit(r)}
                                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-[12.5px] mr-2 min-h-[36px]">Sửa</button>
                                            <button onClick={() => handleDelete(r)}
                                                className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-[12.5px] min-h-[36px]">Xóa</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal thêm/sửa */}
            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
                    <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[16px] font-semibold mb-4">{editing ? 'Sửa đối tác' : 'Thêm đối tác'}</h3>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Mã (để trống = tự sinh)</label>
                                    <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Loại *</label>
                                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]">
                                        {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Tên đối tác *</label>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">SĐT</label>
                                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Email</label>
                                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Địa chỉ</label>
                                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Mã số thuế</label>
                                    <input value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div className="flex items-end pb-3">
                                    <label className="text-[13px] flex items-center gap-2">
                                        <input type="checkbox" checked={form.is_active}
                                            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                                            className="w-4 h-4" /> Đang hợp tác
                                    </label>
                                </div>
                            </div>
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Ghi chú</label>
                                <textarea value={form.note} rows={2} onChange={(e) => setForm({ ...form, note: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5" />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowForm(false)}
                                className="flex-1 py-3 border border-gray-300 rounded-lg text-[14px] min-h-[48px]">Hủy</button>
                            <button onClick={handleSave} disabled={saving}
                                className="flex-1 py-3 bg-[#24305E] text-white rounded-lg text-[14px] font-medium min-h-[48px] disabled:opacity-50">
                                {saving ? 'Đang lưu...' : 'Lưu'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Drawer chi tiết công nợ */}
            {detail && (
                <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDetail(null)}>
                    <div className="bg-white w-full sm:max-w-2xl h-full overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-1">
                            <div>
                                <h3 className="text-[16px] font-semibold">{detail.name}</h3>
                                <p className="text-[12.5px] text-gray-500">{detail.code} · {TYPE_LABEL[detail.type]} · {detail.phone || ''}</p>
                            </div>
                            <button onClick={() => setDetail(null)} className="text-2xl text-gray-400 px-2">×</button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 my-4">
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                                <div className="text-[12px] text-gray-500">Phải thu</div>
                                <div className="text-[16px] font-semibold text-green-700">{fmtMoney(detail.receivable)}</div>
                            </div>
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <div className="text-[12px] text-gray-500">Phải trả</div>
                                <div className="text-[16px] font-semibold text-red-700">{fmtMoney(detail.payable)}</div>
                            </div>
                        </div>

                        <h4 className="text-[14px] font-semibold mb-2">Phiếu công nợ</h4>
                        <div className="overflow-x-auto border border-gray-100 rounded-lg mb-4">
                            <table className="w-full text-[12.5px] min-w-[560px]">
                                <thead>
                                    <tr className="text-left text-gray-500 bg-gray-50">
                                        <th className="px-3 py-2 font-medium">Mã phiếu</th>
                                        <th className="px-3 py-2 font-medium">Ngày</th>
                                        <th className="px-3 py-2 font-medium text-right">Số tiền</th>
                                        <th className="px-3 py-2 font-medium text-right">Đã trả</th>
                                        <th className="px-3 py-2 font-medium text-right">Còn nợ</th>
                                        <th className="px-3 py-2 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(detail.vouchers || []).length === 0 && (
                                        <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Chưa có phiếu nào.</td></tr>
                                    )}
                                    {(detail.vouchers || []).map((v) => (
                                        <tr key={v.id} className="border-t border-gray-100">
                                            <td className="px-3 py-2 font-medium">{v.code}</td>
                                            <td className="px-3 py-2">{fmtDate(v.paid_at)}</td>
                                            <td className="px-3 py-2 text-right">{fmtMoney(v.amount)}</td>
                                            <td className="px-3 py-2 text-right">{fmtMoney(v.paid_amount)}</td>
                                            <td className="px-3 py-2 text-right font-semibold">
                                                {v.remaining > 0 ? <span className="text-red-700">{fmtMoney(v.remaining)}</span>
                                                    : <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Đã xong</span>}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {v.remaining > 0 && (
                                                    <button onClick={() => startPay(v)}
                                                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-[12px] min-h-[36px]">Thanh toán</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {payFor && (
                            <div className="border border-green-200 bg-green-50/50 rounded-lg p-4 mb-4">
                                <h4 className="text-[14px] font-semibold mb-3">Thanh toán {payFor.code} — còn nợ {fmtMoney(payFor.remaining)}</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[12.5px] text-gray-500 block mb-1">Số tiền *</label>
                                        <input type="number" min="1" max={payFor.remaining} value={payForm.amount}
                                            onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                    </div>
                                    <div>
                                        <label className="text-[12.5px] text-gray-500 block mb-1">Hình thức</label>
                                        <select value={payForm.payment_method}
                                            onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]">
                                            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Ghi chú</label>
                                    <input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                </div>
                                <div className="flex gap-2 mt-3">
                                    <button onClick={() => setPayFor(null)}
                                        className="flex-1 py-2.5 border border-gray-300 rounded-lg text-[13px] min-h-[44px]">Hủy</button>
                                    <button onClick={handlePay} disabled={paying}
                                        className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-[13px] font-medium min-h-[44px] disabled:opacity-50">
                                        {paying ? 'Đang xử lý...' : 'Xác nhận thanh toán'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <h4 className="text-[14px] font-semibold mb-2">Lịch sử thanh toán</h4>
                        <div className="space-y-2">
                            {payHistory.length === 0 && <p className="text-[12.5px] text-gray-400">Chưa có thanh toán nào.</p>}
                            {payHistory.map((p) => (
                                <div key={p.id} className="flex justify-between items-center border border-gray-100 rounded-lg px-3 py-2 text-[12.5px]">
                                    <div>
                                        <span className="font-medium">{p.transaction?.code}</span>
                                        <span className="text-gray-400 ml-2">{fmtDate(p.paid_at)} · {METHOD_LABEL[p.payment_method] || p.payment_method || ''}</span>
                                        {p.note && <div className="text-gray-500">{p.note}</div>}
                                    </div>
                                    <div className="font-semibold text-green-700">+{fmtMoney(p.amount)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default Partners;
