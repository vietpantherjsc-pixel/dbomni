import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import AdminLayout from '../../components/layout/AdminLayout';
import { useBranch } from '../../contexts/BranchContext';
import { fmtDate as fmtDateShared } from '../../utils/format';
import DateInput from '../../components/DateInput';
import { API } from '../../utils/api';

// =====================================================================
// Gói 27 (2026-10-09): Trang Thu-Chi hoàn thiện.
// - Tabs Phiếu thu / Phiếu chi, lọc chi nhánh/danh mục/ngày/tìm kiếm.
// - Tổng kết Tổng thu / Tổng chi / Tồn quỹ theo bộ lọc.
// - Phiếu tự sinh từ nhập kho: badge "Tự động từ nhập kho", chỉ cho sửa
//   ghi chú, không cho xóa.
// =====================================================================

const TABS = [
    { key: 'expense', label: 'Phiếu chi' },
    { key: 'income', label: 'Phiếu thu' },
];
const STATUS_LABEL = { paid: 'Đã thanh toán', pending: 'Chờ thanh toán' };
const METHOD_LABEL = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };

const fmtMoney = (n) => new Intl.NumberFormat('vi-VN').format(n || 0) + 'đ';
// Gói 36: dùng chung utils/format (giữ fallback '-')
const fmtDate = (iso) => fmtDateShared(iso) || '-';
const todayISO = () => {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const emptyForm = (type) => ({
    type, category_id: '', branch_id: '', amount: '', paid_at: todayISO(),
    status: 'paid', payment_method: 'cash', note: '',
    partner_id: '', is_debt: false, // Gói 29: đối tác + ghi công nợ
    account_id: '', occurred_at: todayISO(), attachment: '', // Gói 56: quỹ + ngày thực chi + chứng từ
});

const Transactions = () => {
    const branchCtx = useBranch();
    const branchId = (branchCtx && branchCtx.branchId) || '0';
    const [tab, setTab] = useState('expense');
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, balance: 0 });
    const [pagination, setPagination] = useState(null);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState([]);
    const [branches, setBranches] = useState([]);
    const [fCat, setFCat] = useState('');
    const [fFrom, setFFrom] = useState('');
    const [fTo, setFTo] = useState('');
    const [fStatus, setFStatus] = useState('');
    // Gói "Chờ duyệt trên Hub" (2026-10-21): lọc theo trạng thái duyệt (Chờ duyệt/Đã duyệt/Đã từ chối)
    const [fApproval, setFApproval] = useState('');
    const [rejecting, setRejecting] = useState(null); // row đang mở hộp từ chối
    const [rejectReason, setRejectReason] = useState('');
    const [rejectBusy, setRejectBusy] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm('expense'));
    const [saving, setSaving] = useState(false);
    const [newCatName, setNewCatName] = useState('');
    const [showNewCat, setShowNewCat] = useState(false);

    const fetchCategories = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/transaction-categories`);
            if (res.data?.success) setCategories(res.data.data || []);
        } catch { /* bỏ qua */ }
    }, []);

    const fetchBranches = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/branches`);
            const list = res.data?.data || res.data || [];
            setBranches(Array.isArray(list) ? list : []);
        } catch { /* bỏ qua */ }
    }, []);

    // Gói 29: danh sách đối tác cho dropdown trong form phiếu.
    const [partners, setPartners] = useState([]);
    const fetchPartners = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/partners`);
            if (res.data?.success) setPartners(res.data.data || []);
        } catch { /* bỏ qua */ }
    }, []);

    // Gói 56: danh sách quỹ cho dropdown trong form phiếu.
    const [accounts, setAccounts] = useState([]);
    const fetchAccounts = useCallback(async () => {
        try {
            const res = await axios.get(`${API}/accounts`);
            if (res.data?.success) setAccounts(res.data.data || []);
        } catch { /* bỏ qua */ }
    }, []);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ type: tab, page, per_page: 20 });
            if (branchId !== '0') params.append('branch_id', branchId);
            if (fCat) params.append('category_id', fCat);
            if (fFrom) params.append('date_from', fFrom);
            if (fTo) params.append('date_to', fTo);
            if (fStatus) params.append('status', fStatus);
            if (fApproval) params.append('approval_status', fApproval); // Gói "Chờ duyệt trên Hub"
            if (search) params.append('search', search);
            const res = await axios.get(`${API}/transactions?${params}`);
            if (res.data?.success) {
                setRows(res.data.data || []);
                setPagination(res.data.pagination || null);
                setSummary(res.data.summary || { total_income: 0, total_expense: 0, balance: 0 });
            }
        } catch {
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [tab, page, branchId, fCat, fFrom, fTo, fStatus, fApproval, search]);

    useEffect(() => { fetchCategories(); fetchBranches(); fetchPartners(); fetchAccounts(); }, [fetchCategories, fetchBranches, fetchPartners, fetchAccounts]);
    useEffect(() => { fetchRows(); }, [fetchRows]);
    useEffect(() => { setPage(1); }, [tab, branchId, fCat, fFrom, fTo, fStatus, fApproval, search]);

    const openAdd = () => {
        setEditing(null);
        // C2 (2026-10-21): form tạo phiếu theo CN đang chọn ở sidebar — sidebar là 1 CN cụ thể
        // thì điền sẵn CN đó; sidebar = "Tất cả" thì để trống, người nhập PHẢI chọn tường minh
        // (1 CN cụ thể hoặc "Chung toàn chuỗi" = 'common'), không còn lưu trống âm thầm.
        setForm({ ...emptyForm(tab), branch_id: branchId !== '0' ? branchId : '' });
        setShowNewCat(false);
        setShowForm(true);
    };
    const openEdit = (row) => {
        setEditing(row);
        setForm({
            type: row.type,
            category_id: row.category_id || '',
            branch_id: row.branch_id ? String(row.branch_id) : 'common', // C2: phiếu không-CN hiện rõ là "Chung toàn chuỗi"
            amount: row.amount,
            paid_at: (row.paid_at || '').slice(0, 10),
            status: row.status,
            payment_method: row.payment_method || 'cash',
            note: row.note || '',
            partner_id: row.partner_id || '', // Gói 29
            is_debt: row.status === 'pending' && !!row.partner_id, // Gói 29
            account_id: row.account_id || '', // Gói 56
            occurred_at: (row.occurred_at || '').slice(0, 10) || todayISO(), // Gói 56
            attachment: row.attachment || '', // Gói 56
        });
        setShowNewCat(false);
        setShowForm(true);
    };

    const handleAddCategory = async () => {
        const name = newCatName.trim();
        if (!name) return;
        try {
            const res = await axios.post(`${API}/transaction-categories`, { name, type: tab });
            if (res.data?.success) {
                await fetchCategories();
                setForm((f) => ({ ...f, category_id: res.data.data.id }));
                setNewCatName('');
                setShowNewCat(false);
            }
        } catch (e) {
            alert(e.response?.data?.message || 'Không thêm được danh mục.');
        }
    };

    const handleSave = async () => {
        if (!form.category_id) return alert('Chọn danh mục.');
        if (!editing && (!form.amount || Number(form.amount) < 1)) return alert('Nhập số tiền hợp lệ.');
        // C2: phiếu thường (không phải phiếu tự sinh) bắt buộc có lựa chọn CN tường minh —
        // 'common' = Chung toàn chuỗi (lưu branch_id = null); trống = chưa chọn → chặn lưu.
        if (!editing?.related_type && !form.branch_id) return alert('Chọn chi nhánh cho phiếu — chọn 1 chi nhánh cụ thể, hoặc "Chung toàn chuỗi" nếu phiếu không thuộc riêng chi nhánh nào.');
        setSaving(true);
        try {
            const payload = {
                type: form.type,
                category_id: form.category_id,
                branch_id: form.branch_id === 'common' ? null : (form.branch_id || null), // C2: 'common' -> null
                partner_id: form.partner_id || null, // Gói 29
                is_debt: !!form.is_debt && !editing, // Gói 29: chỉ áp dụng khi tạo mới
                amount: Number(form.amount),
                paid_at: form.paid_at,
                status: form.is_debt && !editing ? 'pending' : form.status, // Gói 29: ghi nợ -> chờ thanh toán
                payment_method: form.payment_method,
                note: form.note || null,
                account_id: form.account_id || null, // Gói 56
                occurred_at: form.occurred_at || null, // Gói 56
                attachment: form.attachment || null, // Gói 56
            };
            if (editing) {
                // Gói 27: phiếu tự sinh chỉ cho sửa ghi chú.
                const body = editing.related_type ? { note: form.note || null } : payload;
                await axios.put(`${API}/transactions/${editing.id}`, body);
            } else {
                await axios.post(`${API}/transactions`, payload);
            }
            setShowForm(false);
            fetchRows();
        } catch (e) {
            alert(e.response?.data?.message || 'Lưu thất bại.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (row) => {
        if (!window.confirm(`Xóa phiếu ${row.code}?`)) return;
        try {
            await axios.delete(`${API}/transactions/${row.id}`);
            fetchRows();
        } catch (e) {
            alert(e.response?.data?.message || 'Xóa thất bại.');
        }
    };

    // Gói "Chờ duyệt trên Hub" (2026-10-21): duyệt/từ chối phiếu chờ ngay trong Admin (ngang hàng Hub)
    const handleApprove = async (row) => {
        if (!window.confirm(`Duyệt phiếu ${row.code} (${fmtMoney(row.amount)}đ)?`)) return;
        setActionBusy(true);
        try {
            await axios.post(`${API}/transactions/${row.id}/approve`);
            fetchRows();
        } catch (e) {
            alert(e.response?.data?.message || 'Duyệt thất bại.');
        } finally {
            setActionBusy(false);
        }
    };
    const openReject = (row) => { setRejecting(row); setRejectReason(''); };
    const handleReject = async () => {
        if (!rejecting || !rejectReason.trim() || rejectBusy) return;
        setRejectBusy(true);
        try {
            await axios.post(`${API}/transactions/${rejecting.id}/reject`, { reason: rejectReason.trim() });
            setRejecting(null);
            fetchRows();
        } catch (e) {
            alert(e.response?.data?.message || 'Từ chối thất bại.');
        } finally {
            setRejectBusy(false);
        }
    };

    const isAuto = editing && editing.related_type;
    const catsOfTab = categories.filter((c) => c.type === tab);

    return (
        <AdminLayout>
            <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h1 className="text-xl font-semibold">Thu chi</h1>
                    <button
                        onClick={openAdd}
                        className="px-4 py-2.5 rounded-lg bg-[#24305E] text-white text-sm font-medium min-h-[44px]"
                    >
                        + {tab === 'expense' ? 'Phiếu chi' : 'Phiếu thu'}
                    </button>
                </div>

                {/* Tổng kết kỳ */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white rounded-lg border border-gray-100 p-3 sm:p-4">
                        <div className="text-[12px] text-gray-500">Tổng thu</div>
                        <div className="text-lg sm:text-xl font-bold text-green-700">{fmtMoney(summary.total_income)}</div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-100 p-3 sm:p-4">
                        <div className="text-[12px] text-gray-500">Tổng chi</div>
                        <div className="text-lg sm:text-xl font-bold text-red-600">{fmtMoney(summary.total_expense)}</div>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-100 p-3 sm:p-4">
                        <div className="text-[12px] text-gray-500">Tồn quỹ</div>
                        <div className={`text-lg sm:text-xl font-bold ${summary.balance >= 0 ? 'text-[#24305E]' : 'text-red-600'}`}>
                            {fmtMoney(summary.balance)}
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-100">
                    {/* Tabs — Gói 24b: overflow-y-hidden chống scrollbar dọc ma */}
                    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-100 px-4">
                        {TABS.map((t) => (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={`px-3 py-3 text-[13px] whitespace-nowrap border-b-2 -mb-px shrink-0 transition-colors ${
                                    tab === t.key
                                        ? 'border-[#0d6efd] text-[#0d6efd] font-medium'
                                        : 'border-transparent text-gray-500 hover:text-gray-800'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Bộ lọc */}
                    <div className="flex flex-wrap gap-2.5 p-4">
                        <select value={fCat} onChange={(e) => setFCat(e.target.value)}
                            className="text-[13px] border border-gray-300 rounded px-3 py-2 min-h-[40px]">
                            <option value="">Tất cả danh mục</option>
                            {catsOfTab.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <DateInput value={fFrom} onChange={(v) => setFFrom(v)}
                            className="text-[13px] border border-gray-300 rounded px-3 py-2 min-h-[40px]" />
                        <span className="self-center text-gray-400 text-[13px]">→</span>
                        <DateInput value={fTo} onChange={(v) => setFTo(v)}
                            className="text-[13px] border border-gray-300 rounded px-3 py-2 min-h-[40px]" />
                        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}
                            className="text-[13px] border border-gray-300 rounded px-3 py-2 min-h-[40px]">
                            <option value="">Mọi trạng thái</option>
                            <option value="paid">Đã thanh toán</option>
                            <option value="pending">Chờ thanh toán</option>
                        </select>
                        {/* Gói "Chờ duyệt trên Hub" (2026-10-21): lọc theo trạng thái duyệt */}
                        <select value={fApproval} onChange={(e) => setFApproval(e.target.value)}
                            className="text-[13px] border border-gray-300 rounded px-3 py-2 min-h-[40px]">
                            <option value="">Duyệt: Tất cả</option>
                            <option value="pending">Chờ duyệt</option>
                            <option value="approved">Đã duyệt</option>
                            <option value="rejected">Đã từ chối</option>
                        </select>
                        <div className="flex-1 relative min-w-[200px]">
                            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && setSearch(searchInput)}
                                placeholder="Tìm theo mã phiếu / ghi chú"
                                className="w-full text-[13px] border border-gray-300 rounded pl-9 pr-3 py-2 min-h-[40px]" />
                            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M21 21l-4.35-4.35M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                            </svg>
                        </div>
                        <button onClick={() => setSearch(searchInput)}
                            className="px-4 py-2 rounded-lg bg-[#24305E] text-white text-[13px] min-h-[40px]">Tìm</button>
                    </div>

                    {/* Bảng */}
                    <div className="overflow-x-auto border-t border-gray-100">
                        <table className="w-full text-[13px] min-w-[1080px]">
                            <thead>
                                <tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="px-3 py-3 font-medium">Mã phiếu</th>
                                    <th className="px-3 py-3 font-medium">Ngày</th>
                                    <th className="px-3 py-3 font-medium">Danh mục</th>
                                    <th className="px-3 py-3 font-medium">Chi nhánh</th>
                                    <th className="px-3 py-3 font-medium">Đối tác</th> {/* Gói 29 */}
                                    <th className="px-3 py-3 font-medium">Quỹ</th> {/* Gói 56 */}
                                    <th className="px-3 py-3 font-medium text-right">Số tiền</th>
                                    <th className="px-3 py-3 font-medium text-right">Số dư lũy kế</th> {/* Gói 56 */}
                                    <th className="px-3 py-3 font-medium">Trạng thái</th>
                                    <th className="px-3 py-3 font-medium">Ghi chú</th>
                                    <th className="px-3 py-3 font-medium text-right">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Đang tải...</td></tr>
                                ) : rows.length === 0 ? (
                                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Chưa có phiếu nào.</td></tr>
                                ) : rows.map((r) => (
                                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="px-3 py-3 font-medium text-[#0d6efd] whitespace-nowrap">{r.code}</td>
                                        <td className="px-3 py-3 whitespace-nowrap">{fmtDate(r.paid_at)}</td>
                                        <td className="px-3 py-3">{r.category?.name || '-'}</td>
                                        <td className="px-3 py-3">{r.branch?.name || 'Chung toàn chuỗi'}</td>
                                        <td className="px-3 py-3">{r.partner?.name || '-'}</td> {/* Gói 29 */}
                                        <td className="px-3 py-3 whitespace-nowrap">{r.account?.name || '-'}</td> {/* Gói 56 */}
                                        <td className={`px-3 py-3 text-right font-semibold whitespace-nowrap ${r.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>
                                            {r.type === 'income' ? '+' : '-'}{fmtMoney(r.amount)}
                                        </td>
                                        <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600">{r.running_balance != null ? fmtMoney(r.running_balance) : '-'}</td> {/* Gói 56 */}
                                        <td className="px-3 py-3 whitespace-nowrap">
                                            <span className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border ${
                                                r.status === 'paid'
                                                    ? 'bg-green-50 text-green-700 border-green-200'
                                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                            }`}>{STATUS_LABEL[r.status]}</span>
                                            {/* Gói "Chờ duyệt trên Hub" (2026-10-21): badge trạng thái duyệt — đủ 3 badge theo spec §4.3 */}
                                            {r.is_rejected ? (
                                                <span className="ml-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium border bg-red-50 text-red-700 border-red-200">Đã từ chối</span>
                                            ) : r.is_approved ? (
                                                <span className="ml-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium border bg-green-50 text-green-700 border-green-200">Đã duyệt</span>
                                            ) : (
                                                <span className="ml-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium border bg-amber-50 text-amber-700 border-amber-200">Chờ duyệt</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 max-w-[220px]">
                                            {r.related_type === 'inbound' && (
                                                <span className="inline-block mb-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                                    Tự động từ nhập kho
                                                </span>
                                            )}
                                            {r.is_rejected && r.reject_reason && (
                                                <div className="text-red-700 text-[12px] font-medium">Từ chối: {r.reject_reason}</div>
                                            )}
                                            <div className="text-gray-600 truncate">{r.note || '-'}</div>
                                            {r.attachment && ( // Gói 56
                                                <a href={r.attachment} target="_blank" rel="noreferrer"
                                                    className="text-[11.5px] text-[#0d6efd] hover:underline">📎 Xem chứng từ</a>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-right whitespace-nowrap">
                                            {/* Gói "Chờ duyệt trên Hub" (2026-10-21): phiếu chờ → Duyệt/Từ chối;
                                                phiếu đã từ chối = hồ sơ đóng → không Sửa/duyệt lại (giữ Xóa để dọn dữ liệu) */}
                                            {!r.is_rejected && !r.is_approved && (
                                                <>
                                                    <button onClick={() => handleApprove(r)} disabled={actionBusy}
                                                        className="text-green-700 hover:underline mr-3 disabled:opacity-50">Duyệt</button>
                                                    <button onClick={() => openReject(r)}
                                                        className="text-red-600 hover:underline mr-3">Từ chối</button>
                                                </>
                                            )}
                                            {!r.is_rejected && (
                                                <button onClick={() => openEdit(r)} className="text-[#0d6efd] hover:underline mr-3">Sửa</button>
                                            )}
                                            {!r.related_type && (
                                                <button onClick={() => handleDelete(r)} className="text-red-600 hover:underline">Xóa</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {pagination && pagination.last_page > 1 && (
                        <div className="flex items-center justify-center gap-2 p-4">
                            <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                                className="px-3 py-2 border rounded text-[13px] disabled:opacity-40 min-h-[40px]">‹ Trước</button>
                            <span className="text-[13px] text-gray-500">Trang {pagination.current_page}/{pagination.last_page}</span>
                            <button disabled={page >= pagination.last_page} onClick={() => setPage(page + 1)}
                                className="px-3 py-2 border rounded text-[13px] disabled:opacity-40 min-h-[40px]">Sau ›</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Modal thêm/sửa */}
            {showForm && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowForm(false)}>
                    <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl p-5 max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[16px] font-semibold mb-4">
                            {editing ? `Sửa phiếu ${editing.code}` : (tab === 'expense' ? 'Thêm phiếu chi' : 'Thêm phiếu thu')}
                        </h3>
                        {isAuto && (
                            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12.5px] text-amber-800">
                                Phiếu tự động từ nhập kho — chỉ được sửa ghi chú, không sửa số tiền và không được xóa.
                            </div>
                        )}
                        <div className="space-y-3">
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Danh mục *</label>
                                <div className="flex gap-2">
                                    <select value={form.category_id} disabled={isAuto}
                                        onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                                        className="flex-1 text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px] disabled:bg-gray-100">
                                        <option value="">-- Chọn --</option>
                                        {catsOfTab.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    {!isAuto && (
                                        <button onClick={() => setShowNewCat(!showNewCat)}
                                            className="px-3 py-2 border border-gray-300 rounded-lg text-[13px] min-h-[44px] whitespace-nowrap">
                                            + Mới
                                        </button>
                                    )}
                                </div>
                                {showNewCat && (
                                    <div className="flex gap-2 mt-2">
                                        <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                                            placeholder="Tên danh mục mới"
                                            className="flex-1 text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                        <button onClick={handleAddCategory}
                                            className="px-4 py-2 bg-[#24305E] text-white rounded-lg text-[13px] min-h-[44px]">Thêm</button>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Số tiền *</label>
                                    <input type="number" min="1" value={form.amount} disabled={isAuto}
                                        onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px] disabled:bg-gray-100" />
                                </div>
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Ngày</label>
                                    <DateInput value={form.paid_at} disabled={isAuto}
                                        onChange={(v) => setForm({ ...form, paid_at: v })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px] disabled:bg-gray-100" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Chi nhánh{!editing && <span className="text-red-600"> *</span>}</label>
                                    <select value={form.branch_id} disabled={isAuto}
                                        onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px] disabled:bg-gray-100">
                                        {/* C2: chưa chọn (khi sidebar = Tất cả) -> placeholder bắt chọn; "Chung toàn chuỗi" là lựa chọn tường minh = branch_id null */}
                                        {!editing && branchId === '0' && <option value="">— Chọn chi nhánh —</option>}
                                        <option value="common">Chung toàn chuỗi</option>
                                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Hình thức</label>
                                    <select value={form.payment_method} disabled={isAuto}
                                        onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                                        className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px] disabled:bg-gray-100">
                                        {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                    </select>
                                </div>
                            </div>
                            {/* Gói 56: quỹ + ngày thực chi */}
                            {!isAuto && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[12.5px] text-gray-500 block mb-1">Quỹ</label>
                                        <select value={form.account_id}
                                            onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]">
                                            <option value="">-- Chọn quỹ --</option>
                                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[12.5px] text-gray-500 block mb-1">Ngày thực chi</label>
                                        <DateInput value={form.occurred_at}
                                            onChange={(v) => setForm({ ...form, occurred_at: v })}
                                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]" />
                                    </div>
                                </div>
                            )}
                            {/* Gói 56: đính kèm ảnh chứng từ */}
                            {!isAuto && (
                                <div>
                                    <label className="text-[12.5px] text-gray-500 block mb-1">Chứng từ (ảnh)</label>
                                    <div className="flex items-center gap-3">
                                        <label className="px-4 py-2.5 border border-gray-300 rounded-lg text-[13px] cursor-pointer min-h-[44px] flex items-center hover:bg-gray-50">
                                            📎 Chọn ảnh
                                            <input type="file" accept="image/*" className="hidden"
                                                onChange={async (e) => {
                                                    const f = e.target.files?.[0];
                                                    if (!f) return;
                                                    if (f.size > 2 * 1024 * 1024) { alert('Ảnh tối đa 2MB'); return; }
                                                    const fd = new FormData();
                                                    fd.append('image', f);
                                                    try {
                                                        const res = await axios.post(`${API}/uploads/product-image`, fd, {
                                                            headers: { 'Content-Type': 'multipart/form-data' },
                                                        });
                                                        const url = res.data?.data?.url;
                                                        if (url) setForm({ ...form, attachment: url });
                                                        else alert('Upload thất bại');
                                                    } catch (err) {
                                                        alert(err.response?.data?.message || 'Upload thất bại');
                                                    }
                                                    e.target.value = '';
                                                }} />
                                        </label>
                                        {form.attachment && (
                                            <div className="flex items-center gap-2">
                                                <img src={form.attachment} alt="Chứng từ"
                                                    className="w-12 h-12 object-cover rounded-lg border"
                                                    onError={(e) => { e.target.style.display = 'none'; }} />
                                                <button type="button" onClick={() => setForm({ ...form, attachment: '' })}
                                                    className="text-red-600 text-[12px]">Xóa</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Trạng thái</label>
                                <select value={form.status} disabled={isAuto || form.is_debt}
                                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                                    className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px] disabled:bg-gray-100">
                                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </div>
                            {/* Gói 29: đối tác + ghi công nợ */}
                            {!isAuto && (
                                <>
                                    <div>
                                        <label className="text-[12.5px] text-gray-500 block mb-1">Đối tác</label>
                                        <select value={form.partner_id}
                                            onChange={(e) => setForm({ ...form, partner_id: e.target.value })}
                                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5 min-h-[44px]">
                                            <option value="">-- Không --</option>
                                            {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                    {!editing && (
                                        <label className="flex items-center gap-2 text-[13px] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                                            <input type="checkbox" checked={form.is_debt} className="w-4 h-4"
                                                onChange={(e) => setForm({ ...form, is_debt: e.target.checked })} />
                                            Ghi công nợ (chưa thanh toán ngay)
                                        </label>
                                    )}
                                </>
                            )}
                            <div>
                                <label className="text-[12.5px] text-gray-500 block mb-1">Ghi chú</label>
                                <textarea value={form.note} rows={2}
                                    onChange={(e) => setForm({ ...form, note: e.target.value })}
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

            {/* Gói "Chờ duyệt trên Hub" (2026-10-21): hộp từ chối phiếu thu/chi — lý do BẮT BUỘC */}
            {rejecting && (
                <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onClick={() => setRejecting(null)}>
                    <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-[15px] font-semibold text-[#24305E] mb-1">Từ chối phiếu {rejecting.code}</h3>
                        <p className="text-[13px] text-gray-600 mb-3">
                            Phiếu bị từ chối là <b>hồ sơ đóng</b> — không sửa, không duyệt lại được. Muốn xử lý lại thì tạo phiếu mới.
                        </p>
                        <label className="text-[12.5px] text-gray-500 block mb-1">Lý do từ chối <span className="text-red-600">(bắt buộc)</span></label>
                        <textarea value={rejectReason} rows={3} maxLength={500}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Nhập lý do từ chối..."
                            className="w-full text-[14px] border border-gray-300 rounded-lg px-3 py-2.5" />
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setRejecting(null)}
                                className="flex-1 py-3 border border-gray-300 rounded-lg text-[14px] min-h-[48px]">Hủy bỏ</button>
                            <button onClick={handleReject} disabled={rejectBusy || !rejectReason.trim()}
                                className="flex-1 py-3 bg-red-600 text-white rounded-lg text-[14px] font-medium min-h-[48px] disabled:opacity-50">
                                {rejectBusy ? 'Đang xử lý...' : 'Xác nhận từ chối'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    );
};

export default Transactions;
