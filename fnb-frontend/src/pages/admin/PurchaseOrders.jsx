import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layout/AdminLayout';
import SearchInput from '../../components/SearchInput';
import DateInput from '../../components/DateInput';
import { useBranch } from '../../contexts/BranchContext';
import { API } from '../../utils/api';
import { fmtDate } from '../../utils/format';
import { confirmInApp } from '../../utils/confirmInApp';
import { exportPurchaseOrderImage } from '../../utils/purchaseOrderImage';

// Spec Phiếu đặt hàng NCC (Đại Vương CHỐT 2026-11-08) — bề mặt Admin.
// Khuôn trang Nhập kho: danh sách có lọc + form tạo/sửa + chi tiết.
// Phiếu đặt KHÔNG qua duyệt, không động tồn kho/tiền; giá không có ở phiếu
// đặt (chỉ nhập ở bước nhập kho). Xuất ảnh dùng hàm vẽ chung với Hub.
const STATUS = {
    draft: { label: 'Nháp', cls: 'bg-amber-100 text-amber-700' },
    ordered: { label: 'Đã đặt', cls: 'bg-blue-100 text-blue-700' },
    received: { label: 'Đã nhận hàng', cls: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Đã hủy', cls: 'bg-gray-100 text-gray-500' },
};
const inp = 'border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:border-[#24305E]';
const fmtQty = (n) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 4 });
const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function PurchaseOrders() {
    const nav = useNavigate();
    const { branchId } = useBranch();
    const [branches, setBranches] = useState([]);
    const [materials, setMaterials] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [rows, setRows] = useState([]);
    const [page, setPage] = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState(false);
    const [fBranch, setFBranch] = useState('');
    const [fStatus, setFStatus] = useState('');
    const [fPartner, setFPartner] = useState('');
    const [search, setSearch] = useState('');
    const [formPo, setFormPo] = useState(undefined); // undefined = đóng · null = tạo mới · object = sửa nháp
    const [detail, setDetail] = useState(null);

    useEffect(() => {
        axios.get(`${API}/branches`).then((r) => setBranches(r.data?.data || [])).catch(() => {});
        axios.get(`${API}/materials`).then((r) => setMaterials(r.data?.data || [])).catch(() => {});
        axios.get(`${API}/partners`, { params: { type: 'supplier', is_active: 1 } })
            .then((r) => setSuppliers(r.data?.data || [])).catch(() => {});
    }, []);
    // Lọc mặc định theo chi nhánh đang chọn ở ngữ cảnh Admin
    useEffect(() => { if (branchId && branchId !== '0') setFBranch(String(branchId)); }, [branchId]);

    const fetchList = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API}/purchase-orders`, {
                params: {
                    page, per_page: 20,
                    branch_id: fBranch || undefined,
                    status: fStatus || undefined,
                    partner_id: fPartner || undefined,
                    search: search || undefined,
                },
            });
            const d = res.data?.data;
            setRows(d?.data || []);
            setLastPage(d?.last_page || 1);
            setLoadErr(false);
        } catch { setLoadErr(true); }
        setLoading(false);
    }, [page, fBranch, fStatus, fPartner, search]);
    useEffect(() => { fetchList(); }, [fetchList]);
    useEffect(() => { setPage(1); }, [fBranch, fStatus, fPartner, search]);

    const openDetail = async (id) => {
        try {
            const res = await axios.get(`${API}/purchase-orders/${id}`);
            setDetail(res.data?.data);
        } catch (e) { alert(e.response?.data?.message || 'Không tải được phiếu'); }
    };
    const markOrdered = async (po) => {
        if (!(await confirmInApp(`Chuyển phiếu ${po.code} sang Đã đặt?`))) return;
        try { await axios.post(`${API}/purchase-orders/${po.id}/mark-ordered`); setDetail(null); fetchList(); }
        catch (e) { alert(e.response?.data?.message || 'Không chuyển được trạng thái'); }
    };
    const cancelPo = async (po) => {
        if (!(await confirmInApp(`Hủy phiếu đặt hàng ${po.code}?`))) return;
        try { await axios.post(`${API}/purchase-orders/${po.id}/cancel`); setDetail(null); fetchList(); }
        catch (e) { alert(e.response?.data?.message || 'Không hủy được phiếu'); }
    };

    return (
        <AdminLayout>
            <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-[18px] font-bold text-[#24305E]">Đặt hàng nhà cung cấp</h1>
                        <div className="text-[13px] text-gray-500">Phiếu đặt hàng tới NCC — không qua duyệt, nhận hàng bằng phiếu nhập kho liên kết</div>
                    </div>
                    <button onClick={() => setFormPo(null)}
                        className="px-5 py-2.5 bg-[#24305E] text-white text-[13px] font-medium rounded hover:bg-[#1B2547] shrink-0 whitespace-nowrap">
                        ＋ Tạo phiếu đặt hàng
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 mt-4 mb-3">
                    <select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className={inp}>
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inp}>
                        <option value="">Mọi trạng thái</option>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select value={fPartner} onChange={(e) => setFPartner(e.target.value)} className={inp}>
                        <option value="">Mọi nhà cung cấp</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div style={{ minWidth: 200, flex: '0 1 260px' }}>
                        <SearchInput value={search} onChange={setSearch} placeholder="Tìm theo mã phiếu (DDH…)" />
                    </div>
                </div>

                {loading ? <div className="text-gray-400 text-[13px] py-8 text-center">Đang tải...</div> : (
                    <div className="border border-gray-100 rounded overflow-x-auto bg-white">
                        <table className="w-full text-[13px] min-w-[880px]">
                            <thead className="bg-gray-50">
                                <tr className="text-left text-gray-500 border-b border-gray-100">
                                    <th className="px-4 py-3 font-medium">Mã phiếu</th>
                                    <th className="px-2 py-3 font-medium">Ngày đặt</th>
                                    <th className="px-2 py-3 font-medium">Nhà cung cấp</th>
                                    <th className="px-2 py-3 font-medium">Chi nhánh</th>
                                    <th className="px-2 py-3 font-medium text-center">Số mặt hàng</th>
                                    <th className="px-2 py-3 font-medium">Trạng thái</th>
                                    <th className="px-2 py-3 font-medium">Người tạo</th>
                                    <th className="px-3 py-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                                        <td className="px-4 py-2.5 font-semibold text-[#24305E]">{r.code}</td>
                                        <td className="px-2 py-2.5">{fmtDate(r.order_date)}</td>
                                        <td className="px-2 py-2.5">{r.partner?.name || '—'}</td>
                                        <td className="px-2 py-2.5">{r.branch?.name || '—'}</td>
                                        <td className="px-2 py-2.5 text-center">{r.items_count}</td>
                                        <td className="px-2 py-2.5">
                                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label}</span>
                                        </td>
                                        <td className="px-2 py-2.5">{r.creator_name || '—'}</td>
                                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                            <button onClick={() => openDetail(r.id)} className="text-[#24305E] text-[12px] font-medium mr-3">Xem</button>
                                            {(r.status === 'ordered' || r.status === 'received') && (
                                                <button onClick={async () => { const res = await axios.get(`${API}/purchase-orders/${r.id}`); exportPurchaseOrderImage(res.data?.data); }}
                                                    className="text-[#24305E] text-[12px] font-medium mr-3">Xuất ảnh</button>
                                            )}
                                            {(r.status === 'draft' || r.status === 'ordered') && (
                                                <button onClick={() => cancelPo(r)} className="text-red-500 text-[12px]">Hủy</button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && (
                                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                                        {loadErr ? '⚠ Không tải được danh sách phiếu đặt.' : 'Chưa có phiếu đặt hàng nào.'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {lastPage > 1 && (
                    <div className="flex items-center gap-2 mt-3 text-[13px]">
                        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">‹ Trước</button>
                        <span>Trang {page}/{lastPage}</span>
                        <button disabled={page >= lastPage} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Sau ›</button>
                    </div>
                )}
            </div>

            {formPo !== undefined && (
                <PoForm
                    po={formPo} branches={branches} materials={materials} suppliers={suppliers}
                    defaultBranch={fBranch || (branchId !== '0' ? branchId : '')}
                    onClose={() => setFormPo(undefined)}
                    onDone={() => { setFormPo(undefined); fetchList(); }}
                />
            )}
            {detail && (
                <PoDetail
                    po={detail}
                    onClose={() => setDetail(null)}
                    onEdit={() => { setFormPo(detail); setDetail(null); }}
                    onMarkOrdered={() => markOrdered(detail)}
                    onCancel={() => cancelPo(detail)}
                    onCreateReceipt={() => nav(`/admin/inventory/inbound?po=${detail.id}`)}
                    onExport={() => exportPurchaseOrderImage(detail)}
                />
            )}
        </AdminLayout>
    );
}

// ---------- Form tạo / sửa (chỉ sửa khi Nháp) ----------
function PoForm({ po, branches, materials, suppliers, defaultBranch, onClose, onDone }) {
    const editing = !!po;
    const [branchId, setBranchId] = useState(po?.branch_id ? String(po.branch_id) : (defaultBranch ? String(defaultBranch) : ''));
    const [partnerId, setPartnerId] = useState(po?.partner_id ? String(po.partner_id) : '');
    const [orderDate, setOrderDate] = useState(po?.order_date || todayLocal());
    const [note, setNote] = useState(po?.note || '');
    const [lines, setLines] = useState(() => (po?.items || []).map((it) => ({
        material_id: it.material_id, name: it.material_name, base_unit: it.base_unit,
        unit_name: it.unit_name, quantity: String(it.quantity), note: it.note || '',
    })));
    const [lowRows, setLowRows] = useState([]);
    // Vá chớp-trống (2026-11-08): phân biệt ĐANG TẢI với TRỐNG THẬT ở mục sắp hết
    const [lowLoading, setLowLoading] = useState(false);
    const [lowChecked, setLowChecked] = useState({}); // material_id -> {checked, qty}
    const [matQuery, setMatQuery] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState('');

    // Khối sắp hết: nạp tồn kho của chi nhánh mỗi khi đổi chi nhánh (§2.3)
    useEffect(() => {
        if (!branchId) { setLowRows([]); setLowLoading(false); return; }
        let alive = true;
        setLowLoading(true);
        axios.get(`${API}/inventory/branch/${branchId}`)
            .then((r) => {
                if (!alive) return;
                const rows = (r.data?.data || []).filter((x) => x.is_low_stock && x.is_active);
                setLowRows(rows);
                const init = {};
                rows.forEach((x) => {
                    init[x.material_id] = { checked: false, qty: String(Math.max(1, Math.ceil((Number(x.minimum_stock) || 0) - (Number(x.current_stock) || 0)))) };
                });
                setLowChecked(init);
                setLowLoading(false);
            })
            .catch(() => { if (alive) { setLowRows([]); setLowLoading(false); } });
        return () => { alive = false; };
    }, [branchId]);

    const matById = (id) => materials.find((m) => m.id === Number(id));
    const unitOptions = (m) => {
        if (!m) return [];
        const names = [m.unit, ...((m.units || []).map((u) => u.unit_name))];
        return [...new Set(names)];
    };
    const addLine = (m, qty, unitName) => {
        setLines((prev) => {
            const unit = unitName || m.unit;
            const idx = prev.findIndex((l) => l.material_id === m.id && l.unit_name === unit);
            if (idx >= 0) {
                const cp = [...prev];
                cp[idx] = { ...cp[idx], quantity: String((Number(cp[idx].quantity) || 0) + (Number(qty) || 0)) };
                return cp;
            }
            return [...prev, {
                material_id: m.id, name: m.name, base_unit: m.unit,
                unit_name: unit, quantity: String(qty ?? ''), note: '',
            }];
        });
    };
    const addCheckedLow = () => {
        lowRows.forEach((x) => {
            const c = lowChecked[x.material_id];
            if (c?.checked && Number(c.qty) > 0) {
                const m = matById(x.material_id);
                if (m) addLine(m, Number(c.qty), m.unit);
            }
        });
    };
    const setLine = (i, field, value) => setLines((prev) => prev.map((l, li) => (li === i ? { ...l, [field]: value } : l)));
    const removeLine = (i) => setLines((prev) => prev.filter((_, li) => li !== i));
    const pickerResults = useMemo(() => {
        const q = matQuery.trim().toLowerCase();
        if (!q) return [];
        return materials.filter((m) => m.is_active !== false && m.name.toLowerCase().includes(q)).slice(0, 8);
    }, [matQuery, materials]);

    const submit = async (asStatus) => {
        const items = lines.filter((l) => Number(l.quantity) > 0);
        if (!branchId) return setErr('Chọn chi nhánh đặt hàng.');
        if (!partnerId) return setErr('Chọn nhà cung cấp.');
        if (!items.length) return setErr('Phiếu phải có ít nhất 1 dòng có số lượng.');
        setSubmitting(true); setErr('');
        try {
            const payload = {
                branch_id: Number(branchId),
                partner_id: Number(partnerId),
                order_date: orderDate,
                note: note || null,
                as_status: asStatus,
                items: items.map((l) => ({
                    material_id: l.material_id,
                    quantity: Number(l.quantity),
                    unit_name: l.unit_name,
                    note: l.note || null,
                })),
            };
            if (editing) await axios.patch(`${API}/purchase-orders/${po.id}`, payload);
            else await axios.post(`${API}/purchase-orders`, payload);
            onDone();
        } catch (e) {
            const data = e.response?.data;
            const first422 = data?.errors ? Object.values(data.errors)[0]?.[0] : null;
            setErr(first422 || data?.message || 'Lưu phiếu thất bại');
        }
        setSubmitting(false);
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[720px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 pb-3 shrink-0 flex items-center justify-between">
                    <h2 className="font-bold text-[16px]">{editing ? `Sửa phiếu đặt ${po.code}` : 'Tạo phiếu đặt hàng'}</h2>
                    <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Chi nhánh</div>
                            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inp + ' w-full'}>
                                <option value="">— Chọn chi nhánh —</option>
                                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Nhà cung cấp</div>
                            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className={inp + ' w-full'}>
                                <option value="">— Chọn NCC —</option>
                                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Ngày đặt</div>
                            <DateInput value={orderDate} onChange={setOrderDate} className={inp + ' w-full'} />
                        </label>
                        <label className="block">
                            <div className="text-[12px] text-gray-500 mb-1">Ghi chú chung</div>
                            <input value={note} onChange={(e) => setNote(e.target.value)} className={inp + ' w-full'} placeholder="VD: Giao trước 9h sáng mai" />
                        </label>
                    </div>

                    {/* Khối nguyên liệu sắp hết (§2.3) */}
                    <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3">
                        <div className="text-[13px] font-semibold text-[#24305E] mb-2">
                            Nguyên liệu sắp hết tại {branches.find((b) => String(b.id) === String(branchId))?.name || 'chi nhánh đã chọn'}
                        </div>
                        {!branchId ? (
                            <div className="text-[12.5px] text-gray-500">Chọn chi nhánh để xem nguyên liệu sắp hết.</div>
                        ) : lowLoading ? (
                            <div className="text-[12.5px] text-gray-500">Đang tải nguyên liệu sắp hết…</div>
                        ) : lowRows.length === 0 ? (
                            <div className="text-[12.5px] text-gray-500">Chi nhánh này chưa có nguyên liệu nào sắp hết.</div>
                        ) : (
                            <>
                                {lowRows.map((x) => {
                                    const c = lowChecked[x.material_id] || { checked: false, qty: '' };
                                    return (
                                        <div key={x.material_id} className="flex items-center gap-2 py-1.5 text-[13px]">
                                            <input type="checkbox" checked={!!c.checked} style={{ width: 18, height: 18, accentColor: '#24305E' }}
                                                onChange={(e) => setLowChecked({ ...lowChecked, [x.material_id]: { ...c, checked: e.target.checked } })} />
                                            <span className="flex-1 min-w-0">{x.name}
                                                <span className="text-gray-400"> · tồn {fmtQty(x.current_stock)} / tối thiểu {fmtQty(x.minimum_stock)} {x.unit}</span>
                                            </span>
                                            <input type="number" min="0" step="any" value={c.qty} style={{ width: 90 }}
                                                onChange={(e) => setLowChecked({ ...lowChecked, [x.material_id]: { ...c, qty: e.target.value } })}
                                                className={inp + ' text-right'} />
                                            <span className="w-[52px] shrink-0 text-gray-400 text-[12px]">{x.unit}</span>
                                        </div>
                                    );
                                })}
                                <button onClick={addCheckedLow} className="mt-2 px-4 py-2 bg-[#F5A623] text-white text-[13px] font-medium rounded">
                                    Thêm các dòng đã tích
                                </button>
                            </>
                        )}
                    </div>

                    {/* Bảng dòng đặt */}
                    <div>
                        <div className="text-[12px] text-gray-500 mb-1">Dòng đặt hàng ({lines.length})</div>
                        <div className="relative">
                            <input value={matQuery} onChange={(e) => setMatQuery(e.target.value)} className={inp + ' w-full'}
                                placeholder="🔍 Gõ tên nguyên liệu để thêm dòng…" />
                            {pickerResults.length > 0 && (
                                <div className="absolute left-0 right-0 top-full bg-white border border-gray-200 rounded-b-lg shadow-lg z-10 max-h-[220px] overflow-y-auto">
                                    {pickerResults.map((m) => (
                                        <button key={m.id} onClick={() => { addLine(m, ''); setMatQuery(''); }}
                                            className="block w-full text-left px-3 py-2.5 text-[13px] hover:bg-gray-50 min-h-[44px]">
                                            {m.name} <span className="text-gray-400">({m.unit})</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {lines.map((l, i) => {
                            const m = matById(l.material_id);
                            return (
                                <div key={i} className="border border-gray-200 rounded p-3 mt-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <b className="text-[13px]">{l.name}</b>
                                        <button onClick={() => removeLine(i)} className="text-red-400 text-lg leading-none">×</button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <label className="block">
                                            <div className="text-[11px] text-gray-400">Đơn vị</div>
                                            <select value={l.unit_name} onChange={(e) => setLine(i, 'unit_name', e.target.value)} className={inp + ' w-full'}>
                                                {unitOptions(m).map((u) => <option key={u} value={u}>{u}</option>)}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <div className="text-[11px] text-gray-400">Số lượng</div>
                                            <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className={inp + ' w-full text-right'} />
                                        </label>
                                        <label className="block">
                                            <div className="text-[11px] text-gray-400">Ghi chú dòng</div>
                                            <input value={l.note} onChange={(e) => setLine(i, 'note', e.target.value)} className={inp + ' w-full'} placeholder="VD: lấy date mới nhất" />
                                        </label>
                                    </div>
                                </div>
                            );
                        })}
                        {lines.length === 0 && <div className="text-[12.5px] text-gray-400 mt-2">Chưa có dòng nào — tích từ khối sắp hết hoặc gõ tìm nguyên liệu để thêm.</div>}
                    </div>
                    {err && <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
                </div>
                <div className="p-4 pt-2 shrink-0 flex gap-2 border-t border-gray-100">
                    <button onClick={() => submit('draft')} disabled={submitting}
                        className="flex-1 py-2.5 border border-[#24305E] text-[#24305E] text-[13px] font-semibold rounded disabled:opacity-50">Lưu nháp</button>
                    <button onClick={() => submit('ordered')} disabled={submitting}
                        className="flex-1 py-2.5 bg-[#24305E] text-white text-[13px] font-semibold rounded disabled:opacity-50">Đặt hàng</button>
                </div>
            </div>
        </div>
    );
}

// ---------- Chi tiết phiếu ----------
function PoDetail({ po, onClose, onEdit, onMarkOrdered, onCancel, onCreateReceipt, onExport }) {
    const st = STATUS[po.status];
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[680px] max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="p-5 pb-3 shrink-0 flex items-start justify-between">
                    <div>
                        <h2 className="font-bold text-[16px]">Phiếu đặt hàng {po.code}</h2>
                        <div className="text-[12.5px] text-gray-500 mt-0.5">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st?.cls}`}>{st?.label}</span>
                            {' · '}Ngày đặt {fmtDate(po.order_date)} · {po.branch?.name}
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3 text-[13px]">
                    <div className="grid grid-cols-2 gap-3">
                        <div><span className="text-gray-400">Nhà cung cấp:</span> <b>{po.partner?.name}</b>{po.partner?.phone && <div className="text-gray-500">{po.partner.phone}</div>}</div>
                        <div><span className="text-gray-400">Người tạo:</span> <b>{po.creator_name}</b><div className="text-gray-500">{po.creator_role}</div></div>
                    </div>
                    {po.note && <div className="bg-amber-50 border-l-4 border-[#F5A623] px-3 py-2"><b>Ghi chú:</b> {po.note}</div>}
                    <table className="w-full text-[13px]">
                        <thead>
                            <tr className="text-left text-gray-500 border-b">
                                <th className="py-2 font-medium">Mặt hàng</th>
                                <th className="py-2 font-medium text-center">Đơn vị</th>
                                <th className="py-2 font-medium text-right">Đặt</th>
                                <th className="py-2 font-medium text-right">Đã nhận</th>
                                <th className="py-2 font-medium">Ghi chú</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(po.items || []).map((it) => (
                                <tr key={it.id} className="border-b border-gray-50">
                                    <td className="py-2">{it.material_name}</td>
                                    <td className="py-2 text-center">{it.unit_name}</td>
                                    <td className="py-2 text-right font-semibold">{fmtQty(it.quantity)}</td>
                                    <td className="py-2 text-right">{po.status === 'received' || Number(it.received_quantity) > 0 ? fmtQty(it.received_quantity) : '—'}</td>
                                    <td className="py-2 text-gray-500">{it.note || ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {(po.inbound_receipts || []).length > 0 && (
                        <div>
                            <div className="text-[12px] text-gray-500 mb-1">Phiếu nhập liên kết</div>
                            {po.inbound_receipts.map((r) => (
                                <div key={r.id} className="flex justify-between py-1 border-b border-gray-50">
                                    <span className="font-semibold text-[#24305E]">{r.code}</span>
                                    <span className="text-gray-500">{fmtDate(r.receipt_date)} · {r.status === 'confirmed' ? 'Đã nhập' : r.status === 'draft' ? 'Nháp / chờ duyệt' : 'Đã hủy'}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="p-4 pt-2 shrink-0 flex flex-wrap gap-2 border-t border-gray-100">
                    {po.status === 'draft' && <>
                        <button onClick={onEdit} className="px-4 py-2.5 border border-[#24305E] text-[#24305E] text-[13px] font-semibold rounded">Sửa</button>
                        <button onClick={onMarkOrdered} className="px-4 py-2.5 bg-[#24305E] text-white text-[13px] font-semibold rounded">Đặt hàng</button>
                    </>}
                    {po.status === 'ordered' && (
                        <button onClick={onCreateReceipt} className="px-4 py-2.5 bg-[#F5A623] text-white text-[13px] font-semibold rounded">Tạo phiếu nhập từ phiếu này</button>
                    )}
                    {(po.status === 'ordered' || po.status === 'received') && (
                        <button onClick={onExport} className="px-4 py-2.5 border border-[#24305E] text-[#24305E] text-[13px] font-semibold rounded">Xuất ảnh</button>
                    )}
                    {(po.status === 'draft' || po.status === 'ordered') && (
                        <button onClick={onCancel} className="px-4 py-2.5 text-red-500 text-[13px] font-semibold">Hủy phiếu</button>
                    )}
                </div>
            </div>
        </div>
    );
}
